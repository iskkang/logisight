'use strict';
// generators/report/lib/report-lint.js
// 월간 리포트 최종 조립본 기계 린트 — 금지 패턴(critical) + 본문 수치 대조(warn).
// 순수 함수: lintReport(md, injectedNumbers) → { findings: [{rule, severity, excerpt}] }

const EXCERPT_MAX = 120;

// 발췌는 매치 지점을 중심으로 — 600자 문단의 앞 120자가 아니라, 위반 지점이 보이게.
function truncate(line, matchIndex = 0) {
  const s = String(line || '').trim();
  if (s.length <= EXCERPT_MAX) return s;
  const start = Math.max(0, Math.min(matchIndex - Math.floor(EXCERPT_MAX / 2), s.length - EXCERPT_MAX));
  const slice = s.slice(start, start + EXCERPT_MAX);
  return (start > 0 ? '…' : '') + slice + (start + EXCERPT_MAX < s.length ? '…' : '');
}

// ── ① 금지 패턴 (critical) — 문서 전체 라인 대상 ──────────────────────────────
const CRITICAL_RULES = [
  { rule: 'forbidden-arrow', re: /[➔☞]/ },
  { rule: 'ops-leak',        re: /(미수집|수집\s*실패|접속\s*실패|다음\s*호\s*업데이트)/ },
  // 스타일 가이드 §2 금지 어미 전체: 경어체(~습니다/입니다) + 평서체(~했다/이다/한다/됐다/된다/인다/온다 종결)
  { rule: 'formal-ending',   re: /(습니다|입니다|(?:했|이|한|됐|된|인|온|간)다\.)/ },
  { rule: 'flat-with-arrow', re: /[▲▼]\s*0\.0%/ },
  // §8 직역 금지: 중국어식 분수 축약(근 1/5·近1/5)과 금지 조어 — 가이드 표와 동기 유지
  { rule: 'calque',          re: /(근\s*\d+\s*\/\s*\d+|주간선|능력 방출|万吨|逾\d|超\d)/ },
];

// §13-1-3 고유명사 표기 통일 — 같은 문서에서 두 표기가 함께 쓰이면 critical.
const NAME_VARIANT_PAIRS = [
  ['호르무즈', '오르무즈'],
  ['튀르키예', '터키'],   // 정책상 하나로 통일 필요(어느 쪽이든 단일 사용)
];

function stripFrontmatter(md) {
  const m = String(md).match(/^---\n[\s\S]*?\n---\n/);
  return m ? md.slice(m[0].length) : md;
}

function isNonProseLine(line) {
  const t = line.trim();
  if (!t) return true;
  if (t.startsWith('|')) return true;       // 표 행
  if (t.startsWith('#')) return true;       // 제목
  if (/^-{3,}$/.test(t)) return true;       // 구분선
  if (t.startsWith('<!--')) return true;    // HTML 주석
  if (t.startsWith('[[')) return true;       // [[STATS:]]/[[OGIMG:]]/[[CHART:]] 시스템 토큰
  if (/^https?:\/\//.test(t)) return true;  // 단독 URL 라인
  return false;
}

// ── ② 본문 수치 대조 (warn) ──────────────────────────────────────────────────

// 문자열에서 숫자 토큰을 그대로 추출(표 셀 등 단순 텍스트용, 제외 로직 없음).
function extractNumbers(text) {
  const out = [];
  const matches = String(text).match(/\d[\d,]*(\.\d+)?%?/g) || [];
  for (const m of matches) {
    const n = parseFloat(m.replace(/,/g, '').replace(/%$/, ''));
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}

// 본문(prose) 전용 — 연도·날짜·주차·페이지·%p·분기 등 제외 후 숫자 추출.
function proseNumberTokens(line) {
  let s = line;
  s = s.replace(/https?:\/\/\S+/g, '');                          // URL
  s = s.replace(/\d{4}-\d{2}(-\d{2})?/g, '');                     // ISO 날짜/년월
  s = s.replace(/\bW\d{2}\b/gi, '');                              // 주차(W24)
  s = s.replace(/\d+(\.\d+)?%p/g, '');                            // %p(퍼센트포인트)
  s = s.replace(/\d+\s*(페이지|쪽)|(페이지|쪽)\s*\d+/g, '');        // 페이지
  s = s.replace(/\d{1,2}분기/g, '');                               // 분기(quarter)
  s = s.replace(/\d{1,2}월(\s*\d{1,2}일)?/g, '');                  // 월/일(한국어 날짜)
  s = s.replace(/\b(19\d{2}|20\d{2})\b/g, '');                    // 연도
  s = s.replace(/\d+\s*(?:중|차|단계|가지|배|곳|명|회|종|개국|개(?!월)|건(?!당)|척|대|기|편|주)(?=[\s.,·)의를이가은는도와과]|$)/g, '');  // 서수·조수사(3중·13개 항로·2배 등) — 한글엔 \b 미작동
  return extractNumbers(s);
}

function roundKey(n) {
  return Math.round(n * 10) / 10;
}

function buildInjectedSet(injectedNumbers) {
  const set = new Set();
  for (const raw of injectedNumbers || []) {
    const v = Number(raw);
    if (!Number.isNaN(v)) set.add(roundKey(v));
  }
  return set;
}

function lintReport(md, injectedNumbers) {
  const findings = [];
  const lines = stripFrontmatter(String(md || '')).split('\n');

  // ① 금지 패턴 — 표/제목 포함 전체 라인 대상 (발췌는 매치 지점 중심)
  for (const line of lines) {
    for (const { rule, re } of CRITICAL_RULES) {
      const m = line.match(re);
      if (m) {
        findings.push({ rule, severity: 'critical', excerpt: truncate(line, m.index ?? 0) });
      }
    }
  }

  // ①-b 고유명사 표기 혼용 — 문서 전체에서 변형 표기가 함께 등장하면 critical
  const fullText = lines.join('\n');
  for (const [a, b] of NAME_VARIANT_PAIRS) {
    if (fullText.includes(a) && fullText.includes(b)) {
      findings.push({
        rule: 'inconsistent-name', severity: 'critical',
        excerpt: `표기 혼용: "${a}" ↔ "${b}" — 리포트 전체 단일 표기로 통일 필요(§13-1-3)`,
      });
    }
  }

  // ② 본문 수치 대조 — 표/제목/URL 라인 제외
  const injectedSet = buildInjectedSet(injectedNumbers);
  for (const line of lines) {
    if (isNonProseLine(line)) continue;
    // 기사 귀속 문장은 제외 — 기사 인용 수치의 검증은 Claude 교차검증이 담당(표 재진술 오류가 이 규칙의 타깃)
    if (/에 따르면|보도에|통계에서|보고서는|조사에서/.test(line)) continue;
    const nums = proseNumberTokens(line);
    const missing = nums.filter((n) => !injectedSet.has(roundKey(n)));
    if (missing.length) {
      findings.push({
        rule: 'number-mismatch', severity: 'warn',
        excerpt: `[미매칭: ${missing.slice(0, 4).join(', ')}] ` + truncate(line),
      });
    }
  }

  return { findings };
}

module.exports = { lintReport, extractNumbers, proseNumberTokens };
