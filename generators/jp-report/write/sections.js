'use strict';
// generators/jp-report/write/sections.js
// 일본판 월간 리포트 섹션 정의 — 선언형.
//
// 구성은 한국판 월간 리포트와 같은 모드별이다(해운·항공·철도·항만·무역).
// 지수별로 나누면 독자가 "우리 화물이 어느 모드냐"로 찾지 못한다.
//
// 각 모드 섹션은 두 축을 함께 받는다:
//   세계 스팟(주간, 최신) + 일본 SPPI(월간, 약 2개월 지연)
// 이 대비가 리포트의 핵심이고, 공표 시차가 전망의 근거가 된다.

/**
 * sppiCategories — SPPI 계열을 모드로 나눈다. 13계열을 모든 섹션에 넣으면
 * 프롬프트가 커지고 본문이 계열 나열로 흐른다.
 */

const { okuInt } = require('./tables');

const SECTIONS = [
  {
    id: 'overview',
    no: '01',
    title: '総論',
    axes: [],
    generateLast: true, // 다른 섹션이 확정한 사실을 종합해야 한다
    focus:
      '本号を貫く単一のフレームを示す。各セクションの要旨(digest)を統合する。'
      + '世界のスポット運賃が今どの局面にあり、日本の指数・物量がその中でどこにいるかを述べる — '
      + 'これが本レポートの骨格である。'
      + '基準月が軸ごとに異なる場合は冒頭で必ず断る。'
      + '数値は各セクションが確定したものだけを引用し、新たな数値を持ち込まない。'
      + '各セクションの再要約にならないよう引用は最小限にし、軸をまたいで何が対照的かを述べる。'
      + '軸をまたぐ記述は「同時に観測された」までであり、一方が他方を押し上げたとは書かない。'
      + '【今月の芯】signals の fx_exposure_gap を必ず扱う。外貨建て契約の系列(外航・国際航空)と'
      + '円建て契約の系列(陸上・港湾運送・倉庫・国内航空)で伸びが十数倍に分かれている。'
      + '理由は契約通貨である — 国際の系列は円安がそのまま上乗せされ、国内の系列は上乗せされない。'
      + '荷主が最も知りたいのは「なぜ国際の運賃だけこれほど上がるのか」であり、その答えがこれである。'
      + '各セクションに散らばった数字を、ここで一度だけ束ねる。'
      + '見出しは今月を一言で表すヘッドラインとする(全角20字以内)。',
  },
  {
    id: 'ocean',
    no: '02',
    title: '海運',
    axes: ['global', 'sppi', 'supply'],
    sppiCategories: ['ocean'],
    subsections: [
      '02-1. 世界のスポット指数 ― SCFI・CCFI・WCI・FBX',
      '02-2. 日本の外航運賃 ― 円ベースと契約通貨ベース',
      '02-3. 内航・バルク・燃料と供給',
    ],
    focus:
      '海上コンテナを中心に、世界のスポットと日本の価格を突き合わせる。本レポートの中心セクションである。'
      + '(1) 世界のスポット: containerUp / containerTotal で局面を一言で述べる — 個別系列を数え直さない。'
      + '方向が割れている場合はその事実を書く。基準日(asOf)を必ず明示する。'
      + '(2) 日本の外航運賃: 円ベースと契約通貨ベースを必ず区別する。円ベースには為替要因が入っており、'
      + '契約通貨ベースが運賃そのものの動きに近い。混同すると解釈が逆になる。'
      + '【為替の内訳】fxYoyPct が「前年同月比のうち為替の寄与」である。算出済みなので自分で計算しない。'
      + '「円ベース+52.8%のうち為替が+11.2%、運賃そのものは+37.4%」の形で必ず分けて書く。'
      + 'これが荷主にとって最も実用的な一行である — 為替ぶんは相手の原価が上がったわけではない。'
      + 'signals にある系列(契約通貨ベースが基準年を下回るもの)は必ず扱う。'
      + '(3) 両者の突き合わせ: 同時に観測された事実として並べ、差があるならその理由がデータ上'
      + '明らかな範囲で述べる(円ベースには為替が含まれる、など)。'
      + '週次と月次で基準日が揃わないことを断る。一方が他方を押し上げたとは書かない。'
      + '内航・バルク(BDI)・バンカー(VLSFO/HSFO)は最後の小見出しでまとめる。'
      + '(4) 供給: supply 軸に Drewry の欠航便数がある。最後の小見出しで必ず触れる。'
      + '【単位】blankedSailings / plannedSailings は「便数」である。TEU ではない。'
      + '「58便が欠航」と書く。「58TEU」は誤りである。'
      + '【範囲】scope のとおり主要East-West航路であって日本発着ではない。その範囲を一度明示する。'
      + '【使い方】recent に直近数週が入っている。欠航が増えたか減ったかを言い、'
      + 'スポット運賃の方向と並べて述べる。ただし欠航が運賃を動かしたとは書かない — 因果は主張しない。',
  },
  {
    id: 'air',
    no: '03',
    title: '航空',
    axes: ['sppi'],
    sppiCategories: ['air'],
    subsections: ['03-1. 国際航空 ― 契約通貨ベースの水準', '03-2. 国内航空'],
    focus:
      '航空貨物の価格指数。国際線と国内線で方向が分かれることがあるため、必ず分けて述べる。'
      + '契約通貨ベースが基準年(2020年=100)を下回る系列は、その事実を明記する — '
      + '円ベースが100を上回っていても、運賃そのものは基準年以下ということになる。'
      + '【為替の内訳】fxYoyPct が「前年同月比のうち為替の寄与」である。算出済みで、自分で計算しない。'
      + '国際航空は円ベースの伸びが大きく見えるが、そのうち為替がいくらかを必ず示す。'
      + '航空のスポット指数(IATA・TAC など)は本レポートのデータに無い。断るのは一文だけにする — '
      + '「無い」を三文続けた回があった。無いものを繰り返し断るより、有る数字で言えることを増やす。',
  },
  {
    id: 'rail',
    no: '04',
    title: '鉄道',
    axes: ['rail', 'sppi'],
    sppiCategories: ['land'],
    subsections: ['04-1. ユーラシア鉄道 ― ERAI', '04-2. 日本国内の陸上輸送'],
    focus:
      '中国–欧州のユーラシア鉄道(ERAI)と、日本国内の陸上貨物輸送を扱う。'
      + 'ERAI は日本発着ではない。アジア–欧州の代替ルートとして参照する位置づけであることを明記する。'
      + '輸送日数(ERAI_TRANSIT_DAYS)は運賃と別の指標なので混同しない。'
      + '日本国内は陸上・道路・鉄道貨物輸送の指数を述べる。'
      + '系列間の親子関係(「うち道路貨物輸送」など)は書かない — ファクトシートにその情報は無い。',
  },
  {
    id: 'port',
    no: '05',
    title: '港湾',
    axes: ['port', 'sppi'],
    sppiCategories: ['port', 'warehouse'],
    subsections: ['05-1. 主要6港 総括', '05-2. 港別動向', '05-3. 港湾運送・倉庫の価格'],
    focus:
      '主要6港の外国貿易コンテナ取扱量と、港湾運送・倉庫の価格指数。'
      + '速報値であることを必ず明示する(確報とは確定度が異なる)。'
      + '合計と港別を分けて述べ、前年同月比の増減が分かれた港を対比する。'
      + '合計値は主要6港の合計であって全国計ではない。'
      + 'periodMismatch が true のとき、総論だけでなく本文でも対象月が他セクションと'
      + '異なることを断る — 読者は総論を読み飛ばす。'
      + '物量(TEU)と価格(指数)は別の指標であり、一方から他方を説明しない。',
  },
  {
    id: 'trade',
    no: '06',
    title: '貿易',
    axes: ['trade', 'commodity'],
    subsections: ['06-1. 国別輸出入', '06-2. 品目別構成'],
    focus:
      '国別の輸出入と品目別の構成。金額はファクトシートの億円の値をそのまま使う。'
      + '輸出上位国と伸び率上位国は別物なので分けて述べる。'
      + '品目構成は上位品目の構成比を示すが、構成比から伸びの寄与を語らない — 別のデータである。',
  },
  {
    id: 'closing',
    no: '07',
    title: '見通し',
    // 見通しの根拠は「世界のスポットは週次で先に出る」ことにある。
    // 総論と違い、この節は global 軸を直接見る必要がある。
    axes: ['global'],
    generateLast: true,
    keepTitle: true, // 月ごとにラベルが変わると読者が見つけられない
    focus:
      '来月に向けた見通しだけを述べる。ここが記事の締めである。'
      // 총론과 전망이 둘 다 「今月を一言で表す」를 하면 같은 말이 두 번 나온다.
      // 2026-06호가 그랬다 — 01과 07이 4계열 방향·공표시차·관전포인트를 그대로 반복했다.
      + '【重複の禁止】今月の総括は 01. 総論 の仕事である。ここで繰り返さない。'
      + '今月何が起きたかを述べ直さず、「だから次に何を見るか」から始める。'
      + '4系列の方向・為替と契約通貨の差など、総論が述べたフレームを言い換えて再掲しない。'
      + '【見通しの根拠】世界のスポット指数は週次で直近まで公表される。日本の企業向けサービス'
      + '価格指数は月次で約2か月遅れる。したがって、すでに分かっているスポットの動きは、'
      + 'まだ公表されていない日本の指数がどちらを向くかを考える材料になる。これは推測ではなく'
      + '公表時差にもとづく推論であり、factsheet の publicationLag に根拠がある。'
      + '【書き方】「〜と考えられる。ただし〜は特定できない」の形で、根拠と限界を必ず添える。'
      + '数値の予測はしない(「来月は240に達する」は不可)。転嫁の時差の長さも特定しない。'
      + '最後に、来月に確認すべき指標を2〜3点挙げる。'
      + '新たな数値は持ち込まず、各セクションが確定した数値だけを引用する。'
      + '400字以内。見出しは来月の論点を名詞止めで表す。',
  },
];

const byId = (id) => SECTIONS.find((s) => s.id === id);

/** 생성 순서 — 총론·전망이 마지막. 앞 섹션의 요지를 받아야 한다. */
function generationOrder() {
  return [...SECTIONS.filter((s) => !s.generateLast), ...SECTIONS.filter((s) => s.generateLast)];
}

/** 출력 순서 — 번호대로. 독자는 총론을 맨 앞에서 읽는다. */
function outputOrder() {
  return [...SECTIONS].sort((a, b) => a.no.localeCompare(b.no));
}

/**
 * 섹션이 쓰는 축만 남긴다.
 * 팩트시트 전량을 넣으면 thinking이 예산을 잠식해 본문이 비는 일이 실제로 있었다.
 * periods·periodMismatch·gaps·publicationLag는 어느 섹션이든 지켜야 하는 제약이라 항상 포함한다.
 */
/** 千円 필드를 億円 정수로 바꾼다. 표와 같은 okuInt를 쓴다. */
function okuizeAmounts(obj, keys) {
  const out = { ...obj };
  for (const k of keys) {
    if (!(k in out)) continue;
    out[k.replace(/Jpy$/, 'Oku')] = okuInt(out[k]);
    delete out[k];
  }
  return out;
}

const MONEY_KEYS = ['exportJpy', 'importJpy', 'balanceJpy'];

function okuizeTrade(trade) {
  return {
    ...trade,
    unit: 'oku_jpy',
    total: trade.total ? okuizeAmounts(trade.total, MONEY_KEYS) : trade.total,
    countries: (trade.countries || []).map((c) => okuizeAmounts(c, MONEY_KEYS)),
  };
}

function okuizeCommodity(commodity) {
  const conv = (list) => (list || []).map((x) => okuizeAmounts(x, ['valueJpy']));
  return {
    ...commodity,
    unit: 'oku_jpy',
    export: conv(commodity.export),
    import: conv(commodity.import),
  };
}

function slimFactsheet(factsheet, sectionId) {
  const section = byId(sectionId);
  if (!section) throw new Error(`알 수 없는 섹션: ${sectionId}`);

  const base = {
    periods: factsheet.periods,
    periodMismatch: factsheet.periodMismatch,
    gaps: factsheet.gaps,
    // 公表時差は見通しの根拠。どの節でも同じ前提を守らせる。
    publicationLag: factsheet.publicationLag,
  };

  if (section.axes.length === 0) {
    // 총론은 원자료가 아니라 앞 섹션의 요지를 받는다. 숫자를 다시 굴리면 어긋난다.
    // 다만 signals는 넘긴다 — fx_exposure_gap이 이 절의 뼈대다.
    return { ...base, signals: factsheet.sppi ? factsheet.sppi.signals : [] };
  }

  const out = { ...base };
  for (const axis of section.axes) if (factsheet[axis]) out[axis] = factsheet[axis];

  // history는 차트 전용이다. 프롬프트에 들어가면 본문이 시계열 수치를 인용하기 시작하고,
  // 「단월의 단면」이라는 전제(STYLE §7)가 무너진다. 게다가 프롬프트가 크게 부푼다.
  for (const axis of ['sppi', 'global']) {
    if (out[axis] && out[axis].history) {
      const { history, ...rest } = out[axis];
      out[axis] = rest;
    }
  }

  // 금액은 億円으로 바꿔서 넘긴다. 千円 원자료를 주면 모델이 스스로 환산하는데,
  // 표는 반올림하고 모델은 버림해서 같은 금액이 1억엔 어긋났다
  // (総輸入 표 113,365 vs 본문 11兆3364억). 모델에게서 산수를 뺏는다.
  if (out.trade) out.trade = okuizeTrade(out.trade);
  if (out.commodity) out.commodity = okuizeCommodity(out.commodity);

  // SPPI는 모드별로 잘라 넣는다. 13계열을 모든 섹션에 넣으면 본문이 계열 나열로 흐른다.
  if (out.sppi && section.sppiCategories) {
    const series = out.sppi.series.filter((s) => section.sppiCategories.includes(s.category));
    out.sppi = {
      ...out.sppi,
      series,
      signals: (out.sppi.signals || []).filter((sig) => series.some((s) => s.name === sig.series)),
    };
  }
  return out;
}

module.exports = { SECTIONS, byId, generationOrder, outputOrder, slimFactsheet };
