'use strict';
// generators/jp-report/write/sections.js
// 일본판 월간 리포트 섹션 정의 — 선언형. 한국판 sections.config.js와 같은 패턴.
//
// 섹션은 4개다. 확보한 데이터 축이 4개(운임·항만·무역국가·무역품목)이고,
// 억지로 늘리면 내용 없는 섹션이 생긴다.

/** 섹션이 참조하는 팩트시트 축. 여기 없는 축은 프롬프트에 넣지 않는다. */
const SECTIONS = [
  {
    id: 'overview',
    no: '01',
    title: '総論',
    axes: [],
    generateLast: true, // 다른 섹션이 확정한 사실을 종합해야 한다
    focus:
      '本レポート全体を貫く単一のフレームを示す。各セクションの要旨(digest)を統合し、'
      + '運賃・港湾・貿易のあいだの連関(モード間の波及)を最低1つ述べる。'
      + '基準月が軸ごとに異なる場合は冒頭で必ず断る。'
      + '数値は各セクションが確定したものだけを引用し、新たな数値を持ち込まない。'
      + '各セクションの再要約にならないよう、引用する数値は最小限にとどめ、'
      + '軸をまたいで何が対照的かを述べる。読者が今月何を知っておくべきかを示す。'
      + 'ただし軸をまたぐ記述は「同時に観測された」までである — 一方が他方に'
      + '先行する・波及するといった時間的・因果的な解釈は書かない。'
      + '基準月が異なる軸どうしはとくに慎重に扱う。'
      + '見出しは今月を一言で表すヘッドラインとする(全角20字以内)。',
  },
  {
    id: 'freight',
    no: '02',
    title: '海上・航空運賃',
    axes: ['sppi'],
    // 소섹션은 한 번의 생성 안에서 만든다. 소섹션마다 호출하면 실행이 배로 길어진다.
    subsections: [
      '02-1. 外航海上 — 円ベースと契約通貨ベースの乖離',
      '02-2. 国際航空 — 契約通貨ベースの水準',
      '02-3. 国内輸送・港湾運送・倉庫',
    ],
    focus:
      '企業向けサービス価格指数(2020年=100)の月次動向。'
      + '円ベースと契約通貨ベースを必ず区別して書く — 円ベースには為替要因が入っており、'
      + '契約通貨ベースが運賃そのものの動きに近い。混同すると解釈が逆になる。'
      + 'signals にある系列(契約通貨ベースが基準年を下回るもの)は必ず本文で扱う。'
      + '海上・航空・陸上・港湾運送・倉庫の順に触れ、外航と国内セグメントの対照を示す。'
      + '同一系列の円ベースと契約通貨ベースを併記するときは、ファクトシートの同じ系列の'
      + '値を対応させる — 両者が同一値になることは通常ない。'
      + '全系列を機械的に並べず、水準差の大きい系列に紙幅を割く。',
  },
  {
    id: 'port',
    no: '03',
    title: '港湾',
    axes: ['port'],
    subsections: ['03-1. 主要6港 総括', '03-2. 港別動向'],
    focus:
      '主要6港の外国貿易コンテナ取扱量。速報値であることを必ず明示する(確報とは確定度が異なる)。'
      + '合計と港別を分けて述べ、前年同月比の増減が分かれた港を対比する。'
      + '合計値は主要6港の合計であって全国計ではない点に注意する。'
      + 'periodMismatch が true のとき、総論だけでなくこのセクション本文でも'
      + '対象月が他セクションと異なることを断る — 読者は総論を読み飛ばす。',
  },
  {
    id: 'trade',
    no: '04',
    title: '貿易',
    axes: ['trade', 'commodity'],
    subsections: ['04-1. 国別輸出入', '04-2. 品目別構成'],
    focus:
      '国別の輸出入と品目別の輸出構成。金額は兆・億円で表記する。'
      + '輸出上位国と伸び率上位国は別物なので分けて述べる。'
      + '品目構成は上位品目の構成比を示し、輸出全体の伸びとの関係に触れる。',
  },
  {
    id: 'closing',
    no: '05',
    title: '今月のフレーム',
    axes: [],
    generateLast: true, // 총론과 마찬가지로 앞 섹션을 받아야 한다
    keepTitle: true, // 맺음말 라벨은 달마다 바뀌면 안 된다 — 헤드라인은 뒤에 붙인다
    focus:
      '本号を一言で表すフレームを示し、来月に向けて何を見るべきかを述べる。'
      + '各セクションの要旨を受け、今月の市況を貫く見方を一つ提示する。'
      + '新たな数値は持ち込まない。予測は書かない — 「次に確認すべき指標」までである。'
      + '300字以内。見出しはそのフレームを名詞止めで表す。',
  },
];

const byId = (id) => SECTIONS.find((s) => s.id === id);

/** 생성 순서 — 총론이 마지막. 앞 섹션의 요지를 받아야 한다. */
function generationOrder() {
  return [...SECTIONS.filter((s) => !s.generateLast), ...SECTIONS.filter((s) => s.generateLast)];
}

/** 출력 순서 — 번호대로. 독자는 총론을 맨 앞에서 읽는다. */
function outputOrder() {
  return [...SECTIONS].sort((a, b) => a.no.localeCompare(b.no));
}

/**
 * 섹션이 쓰는 축만 남긴다.
 * 팩트시트 전량(6.9KB)을 넣으면 thinking이 예산을 잠식해 본문이 비는 일이 실제로 있었다.
 * periods·periodMismatch·gaps는 어느 섹션이든 지켜야 하는 제약이라 항상 포함한다.
 */
function slimFactsheet(factsheet, sectionId) {
  const section = byId(sectionId);
  if (!section) throw new Error(`알 수 없는 섹션: ${sectionId}`);

  const base = {
    periods: factsheet.periods,
    periodMismatch: factsheet.periodMismatch,
    gaps: factsheet.gaps,
  };

  if (section.axes.length === 0) {
    // 총론·맺음말은 원자료가 아니라 앞 섹션의 요지를 받는다. 숫자를 다시 굴리면 어긋난다.
    return { ...base, signals: factsheet.sppi ? factsheet.sppi.signals : [] };
  }

  const out = { ...base };
  for (const axis of section.axes) if (factsheet[axis]) out[axis] = factsheet[axis];
  return out;
}

module.exports = { SECTIONS, byId, generationOrder, outputOrder, slimFactsheet };
