// 순수 함수. 네트워크/IO 없음.
function textOf(article) {
  return [
    article.title || '',
    article.summary || article.description || '',
    article.content || '',
  ].join(' ').toLowerCase();
}

// 짧은 ASCII 약어(EU·US·UK·EV·CIS·IRA 등)는 부분문자열 매칭 시 일반어를 오탐한다
// (US→"customs"·"Russia", EU→"euro"·"Deutsche", IRA→"admiral", CIS→"decision").
// → 길이 ≤3의 순수 영숫자 토큰만 단어경계(\b)로, 나머지(한글·긴 영문·기호 포함)는 부분문자열로 매칭.
const ACRONYM = /^[a-z0-9]{1,3}$/;
function matches(text, term) {
  const t = String(term).toLowerCase();
  if (!t) return false;
  if (ACRONYM.test(t)) return new RegExp('\\b' + t + '\\b').test(text);
  return text.includes(t);
}

function scoreArticle(article, cfg) {
  const text = textOf(article);
  const count = (terms) =>
    (terms || []).reduce((n, t) => n + (matches(text, t) ? 1 : 0), 0);

  const regionScore = count(cfg.geoKeywords);
  const koreaScore  = count(cfg.koreaAnchors);
  const policyScore = count(cfg.policyAnchors);
  const tradeScore  = count(cfg.tradeAnchors);
  const excluded    = (cfg.excludeKeywords || []).some(
    (t) => text.includes(String(t).toLowerCase())
  );

  const hook = koreaScore > 0 || policyScore > 0 || tradeScore > 0;
  const pass = !excluded && regionScore >= 1 && hook;

  // 단일 primary type. 우선순위 news(korea) > policy > trade.
  // (korea+policy 동시 기사는 news로 두고, 정책 차원은 LLM이 prose에서 다룸)
  let type = null;
  if (koreaScore > 0) type = 'news';
  else if (policyScore > 0) type = 'policy';
  else if (tradeScore > 0) type = 'trade';

  const relevance =
    regionScore + koreaScore * 2 + policyScore * 1.5 + tradeScore * 1.5;

  return { regionScore, koreaScore, policyScore, tradeScore, type, relevance, pass };
}

// 통과 기사에 briefType 부여, relevance 내림차순, 상위 limit
function filterByRegion(articles, cfg, limit = 14) {
  return articles
    .map((a) => ({ a, s: scoreArticle(a, cfg) }))
    .filter((x) => x.s.pass)
    .sort((x, y) => y.s.relevance - x.s.relevance)
    .slice(0, limit)
    .map((x) =>
      Object.assign({}, x.a, {
        briefType: x.s.type,
        _scores: {
          region: x.s.regionScore, korea: x.s.koreaScore,
          policy: x.s.policyScore, trade: x.s.tradeScore,
        },
      })
    );
}

// 편집 규칙 — promptFocus 뒤에 항상 붙인다.
const SHARED_TYPE_RULES = [
  '항목은 briefType별로 다룬다.',
  'news = 운영 동향(한국 화주·제조사 영향 중심).',
  'policy = 정책/거시 변화. 반드시 한국 또는 해당 권역에 미치는 함의를 1~2문장으로 서술하고, 함의가 없으면 제외한다.',
  'trade = 무역량/물동량 동향. 기사에 보고된 수치만 문맥상 인용하고 표는 만들지 않는다.',
  '해당 항목이 없는 type은 블록 자체를 생략한다(억지 생성 금지).',
].join(' ');

module.exports = { scoreArticle, filterByRegion, SHARED_TYPE_RULES, matches };
