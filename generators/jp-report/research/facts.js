'use strict';
// generators/jp-report/research/facts.js
// 일본판 월간 리포트 팩트시트 — DB 행 → 구조화 사실.
// 순수 함수만 둔다(I/O 없음). DB 조회는 build-factsheet.js가 한다.
//
// 설계 근거는 실제 LLM 샘플에서 나온 실패다:
//  - 계약통화 지수가 100 미만인데(달러 기준 2020년 수준 이하) 언급하지 않았다 → signals로 강제 노출
//  - 환율 데이터가 없는데 "円安"를 논했다 → gaps로 결측을 명시
//  - 무역 6월과 항만 5월을 섞으면서 그 사실을 감췄다 → periodMismatch로 표시

const PORT_NAMES = {
  JPTYO: '東京港',
  JPKWS: '川崎港',
  JPYOK: '横浜港',
  JPNGO: '名古屋港',
  JPOSA: '大阪港',
  JPUKB: '神戸港',
};

/**
 * 재무성 무역통계의 국가명은 영문 약어다('HG KONG' 'SNGAPOR' 'AUSTRAL').
 * 그대로 두면 표만 영문이 되고, 본문 번역을 모델에 맡기게 되어 오역 위험이 남는다.
 * 매핑에 없는 이름은 원문을 그대로 쓴다 — 새 상대국이 들어와도 표가 비지 않는다.
 */
const COUNTRY_NAMES_JA = {
  USA: '米国',
  CHINA: '中国',
  TAIWAN: '台湾',
  'R KOREA': '韓国',
  'HG KONG': '香港',
  THAILND: 'タイ',
  SNGAPOR: 'シンガポール',
  VIETNAM: 'ベトナム',
  INDIA: 'インド',
  AUSTRAL: 'オーストラリア',
  MALYSIA: 'マレーシア',
  GERMANY: 'ドイツ',
  CANADA: 'カナダ',
  MEXICO: 'メキシコ',
  'U KING': '英国',
  INDNSIA: 'インドネシア',
  PHILPIN: 'フィリピン',
  FRANCE: 'フランス',
  ITALY: 'イタリア',
  NETHRLD: 'オランダ',
  BRAZIL: 'ブラジル',
  RUSSIA: 'ロシア',
  'SAUDI A': 'サウジアラビア',
  UAE: 'アラブ首長国連邦',
  'S AFRICA': '南アフリカ',
};

const countryJa = (name) => COUNTRY_NAMES_JA[name] || name;

/** 지수의 기준연도 값. 계약통화 기준이 이보다 낮으면 실질 운임이 기준연도 이하라는 뜻이다. */
const INDEX_BASE = 100;

/**
 * 축별 출처. 팩트시트에 없으면 본문이 기관명을 써도 검수자가 확인할 수 없어
 * 「出典名を断定的に付与している」으로 반려된다(실제로 그렇게 걸렸다).
 */
const SOURCES = {
  sppi: '日本銀行 企業向けサービス価格指数(SPPI)',
  port: '国土交通省 港湾統計',
  trade: '財務省貿易統計',
  commodity: '財務省貿易統計 概況品別国別表',
  global: '各指数の公表機関(SSE・Drewry・Freightos・Baltic Exchange ほか)',
};

/**
 * 世界のスポット運賃指数。日本版レポートに載せる系列。
 *
 * KCCI(韓国発)・KITA は韓国発着が基準なので入れない。日本の荷主にとって
 * 意味を持つのは、発表元が世界共通の SCFI・CCFI・WCI・FBX・BDI とバンカーである。
 *
 * SPPI は「日本国内の価格」、これらは「世界のスポット」。並べて初めて
 * 日本の動きが世界の流れの中でどこにあるかが読める — それがこの軸の目的である。
 */
const GLOBAL_SERIES = [
  { code: 'SCFI', label: 'SCFI 総合' },
  { code: 'SCFI_EU', label: 'SCFI 上海→欧州' },
  { code: 'SCFI_USWC', label: 'SCFI 上海→米西岸' },
  { code: 'SCFI_USEC', label: 'SCFI 上海→米東岸' },
  { code: 'CCFI', label: 'CCFI 総合' },
  { code: 'WCI', label: 'WCI 総合' },
  { code: 'FBX', label: 'FBX 総合' },
  { code: 'BDI', label: 'BDI(バルク)' },
  { code: 'VLSFO', label: 'VLSFO(低硫黄C重油)' },
  { code: 'HSFO', label: 'HSFO(高硫黄C重油)' },
];

/** ユーラシア鉄道。ERAI(Eurasian Rail Alliance Index)の公開値。 */
const RAIL_SERIES = [
  { code: 'ERAI', label: 'ERAI 総合' },
  { code: 'ERAI_WEST', label: 'ERAI 西航(中国→欧州)' },
  { code: 'ERAI_EAST', label: 'ERAI 東航(欧州→中国)' },
  { code: 'ERAI_TRANSIT_DAYS', label: 'ERAI 平均輸送日数', unit: '日' },
];

const GLOBAL_CODES = [...GLOBAL_SERIES, ...RAIL_SERIES].map((s) => s.code);

/** 系列定義 → 最新行を当てはめる共通処理。系列ごとに公表日が違う。 */
function pickLatest(rows, defs) {
  const latest = new Map();
  for (const r of rows || []) if (!latest.has(r.index_code)) latest.set(r.index_code, r);
  return defs.map(({ code, label, unit }) => {
    const r = latest.get(code);
    return {
      code,
      label,
      unit: unit ?? null,
      value: r && r.value !== null && r.value !== undefined ? Number(r.value) : null,
      changePct: r && r.change_pct !== null && r.change_pct !== undefined ? Number(r.change_pct) : null,
      asOf: r ? r.week_date : null,
    };
  });
}

/** ユーラシア鉄道の指数。海運・航空と同じ形にそろえる。 */
function buildRailFacts(rows) {
  const indices = pickLatest(rows, RAIL_SERIES);
  return {
    source: 'ERAI (Eurasian Rail Alliance Index)',
    asOf: indices.map((i) => i.asOf).filter(Boolean).sort().pop() ?? null,
    indices,
    // changePct の基準を明記する。collectors/erai.ts が index1520 の「最新月の変化」列を
    // そのまま入れており、前月比である。ラベルが無いと本文が基準を推測する —
    // 2026-05号が「前年同月比+0.2%」と書いて誤り、2026-06号は基準を書けず
    // 「変化率+0.19%」とだけ書いて読者が解釈できなくなった。
    changeBasis: '前月比',
    note: '中国–欧州の鉄道運賃と輸送日数。日本発着ではないが、アジア–欧州の代替ルートとして参照する。'
      + '変化率は前月比である。前年同月比ではない。',
  };
}

/**
 * 世界のスポット指数を1軸にまとめる。
 *
 * 系列ごとに公表日が違うので、系列ごとの最新行を拾う。
 * 週次であり、日本の統計(月次)とは基準日が揃わない — その事実を asOfNote に持たせ、
 * 本文が同一時点として扱わないようにする。
 */
function buildGlobalFacts(rows) {
  const indices = pickLatest(rows, GLOBAL_SERIES);

  const withChange = indices.filter((i) => i.changePct !== null);
  const container = withChange.filter((i) => !['BDI', 'VLSFO', 'HSFO'].includes(i.code));

  return {
    source: SOURCES.global,
    unit: 'index / USD',
    asOf: indices.map((i) => i.asOf).filter(Boolean).sort().pop() ?? null,
    indices,
    // 局面を一言で言うための集計。個別系列を数え直させない。
    containerUp: container.filter((i) => i.changePct > 0).length,
    containerDown: container.filter((i) => i.changePct < 0).length,
    containerTotal: container.length,
    asOfNote:
      '世界のスポット指数は週次、日本の統計は月次で基準日が揃わない。'
      + '両者を同一時点の動きとして比較してはならない。同時期に観測された事実として並べるまでである。',
  };
}

/**
 * 시계열은 차트 전용이다. 본문은 단면 수치만 쓴다.
 *
 * 단면만으로는 「今がどの局面か」を示せない — 前年同月比が正でも、それは前年より高い
 * という意味しかなく、上がってきたのか下げ止まったのかは分からない。その形は
 * 図でしか渡せない。ただし本文が時系列の数値を引用し始めると単月の断面という
 * 前提が崩れるので、sections.slimFactsheet が history をプロンプトから外す。
 */
const TREND_CODES = ['SCFI', 'CCFI', 'WCI', 'FBX'];
const SPPI_TREND_SERIES = ['外航貨物輸送', '国際航空貨物輸送'];

/** 週次スポットの推移。系列ごとに公表日が違う。 */
function buildGlobalHistory(rows, { weeks = 26 } = {}) {
  const byCode = new Map();
  for (const r of rows || []) {
    if (!TREND_CODES.includes(r.index_code) || r.value === null || r.value === undefined) continue;
    if (!byCode.has(r.index_code)) byCode.set(r.index_code, new Map());
    byCode.get(r.index_code).set(r.week_date, Number(r.value));
  }

  // 축이 될 날짜는 가장 촘촘한 계열의 공표일로 잡는다.
  // 전 계열의 합집합을 쓰면, 한 계열만 요일이 어긋난 날(WCI가 화요일에 공표한 주가 있다)이
  // 축에 끼어들고, 그 자리에서 다른 모든 계열의 선이 통째로 끊긴다.
  let grid = null;
  for (const at of byCode.values()) if (!grid || at.size > grid.size) grid = at;
  if (!grid) return null;
  const window = [...grid.keys()].sort().slice(-weeks);
  if (window.length < 2) return null;

  const series = TREND_CODES.filter((c) => byCode.has(c)).map((code) => ({
    code,
    label: GLOBAL_SERIES.find((s) => s.code === code).label,
    // 欠測は null のまま。線をつなぐと無い観測を有るように見せる。
    values: window.map((d) => byCode.get(code).get(d) ?? null),
  }));
  return series.length ? { weeks: window, series } : null;
}

const pct = (cur, prev) =>
  (Number.isFinite(cur) && Number.isFinite(prev) && prev !== 0 ? (cur / prev - 1) * 100 : null);

/** 小数1桁。プロンプトに 45.39800995024875 が入ると本文が過剰な桁で書き始める。 */
const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

const period = ({ year, month }) => `${year}-${String(month).padStart(2, '0')}`;

/** SPPI の月次推移。円ベースと契約通貨ベースの開きが広がったのかを図で示す。 */
function buildSppiHistory(rows, { months = 24 } = {}) {
  const byName = new Map();
  const periods = new Set();
  for (const r of rows || []) {
    if (r.basis === 'ex_tax' || r.value === null || r.value === undefined) continue;
    if (!SPPI_TREND_SERIES.includes(r.series_name)) continue;
    const p = period(r);
    periods.add(p);
    if (!byName.has(r.series_name)) byName.set(r.series_name, new Map());
    const at = byName.get(r.series_name);
    if (!at.has(p)) at.set(p, {});
    at.get(p)[r.basis] = Number(r.value);
  }
  const window = [...periods].sort().slice(-months);
  if (window.length < 2) return null;

  const series = SPPI_TREND_SERIES.filter((n) => byName.has(n)).map((name) => {
    const at = byName.get(name);
    return {
      name,
      yen: window.map((p) => at.get(p)?.yen ?? null),
      contract: window.map((p) => at.get(p)?.contract ?? null),
    };
  });
  return series.length ? { months: window, series } : null;
}

/**
 * SPPI 系列の親子関係。日本銀行の品目分類(運輸・郵便の内訳)にもとづく。
 *
 * これを渡さないと本文が「両者の系列間に親子関係があるかどうかは、このデータからは
 * 判断できない」と書く(2026-06号 04-2 が実際にそうなった)。日本銀行が公表している
 * 分類であり、業界の読者は知っている。知っていることを「分からない」と書けば信頼が減る。
 *
 * 値とも整合する — 陸上111.6 は 鉄道107.0 と 道路111.6 の間にあり、道路が大半を占める
 * ことを示す。海上160.0 は 内航135.0 と 外航233.8 の間にある。
 *
 * モデルに推測させない。ここに無い系列は親を持たないものとして扱う。
 */
const SERIES_PARENT = {
  陸上貨物輸送: '運輸・郵便',
  海上貨物輸送: '運輸・郵便',
  航空貨物輸送: '運輸・郵便',
  港湾運送: '運輸・郵便',
  倉庫: '運輸・郵便',
  鉄道貨物輸送: '陸上貨物輸送',
  道路貨物輸送: '陸上貨物輸送',
  外航貨物輸送: '海上貨物輸送',
  内航貨物輸送: '海上貨物輸送',
  '外航貨物輸送（除外航タンカー）': '外航貨物輸送',
  国際航空貨物輸送: '航空貨物輸送',
  国内航空貨物輸送: '航空貨物輸送',
};

/**
 * 為替寄与。円ベース ÷ 契約通貨ベース から出す。
 *
 * 日本銀行の定義で 円ベース = 契約通貨ベース × 為替 なので、比がそのまま為替の動きになる。
 * 外部の為替系列は要らない — 出典が日本銀行ひとつで完結する。
 *
 * 差ではなく比で出す。積の関係なので引き算では合わない
 * (運賃+37.4%・為替+11.2% のとき円ベースは +48.6% ではなく +52.8%)。
 *
 * 実データで裏が取れる。ほぼ全量が外貨建ての外航貨物輸送(+45.4%)と国際航空貨物輸送
 * (+45.2%)は、ドル円の 2020年平均106.8 → 2026年6月155 の +45.1% をそれぞれ独立に
 * 再現する。一方 海上貨物輸送は +20.2% にとどまる — 円建ての内航が混ざるからで、
 * これは「その系列の契約構成に対する為替の効き」を表す。ドル円そのものではない。
 */
function fxContribution(yenValue, contractValue) {
  if (!Number.isFinite(yenValue) || !Number.isFinite(contractValue) || contractValue === 0) return null;
  return round1((yenValue / contractValue - 1) * 100);
}

/** 前年同月比における為替寄与。伸び率どうしも比で合成される。 */
function fxContributionYoy(yoyYenPct, yoyContractPct) {
  if (!Number.isFinite(yoyYenPct) || !Number.isFinite(yoyContractPct)) return null;
  const denom = 1 + yoyContractPct / 100;
  if (denom === 0) return null;
  return round1(((1 + yoyYenPct / 100) / denom - 1) * 100);
}

function buildSppiFacts(rows, prevRows, at) {
  const byName = new Map();
  for (const r of rows) {
    if (r.basis === 'ex_tax') continue; // 소비세 제외는 본계열과 값이 같아 리포트에 쓰지 않는다
    const entry = byName.get(r.series_name) || { name: r.series_name, category: r.category, yen: null, contract: null };
    entry[r.basis] = Number(r.value);
    if (r.category) entry.category = r.category;
    byName.set(r.series_name, entry);
  }
  const prev = new Map();
  for (const r of prevRows) prev.set(`${r.series_name}_${r.basis}`, Number(r.value));

  const series = [...byName.values()].map((s) => {
    const yoyYenPct = pct(s.yen, prev.get(`${s.name}_yen`));
    const yoyContractPct = pct(s.contract, prev.get(`${s.name}_contract`));
    return {
      ...s,
      // 親系列。無い系列は null で、その場合は本文でも階層に触れない。
      parent: SERIES_PARENT[s.name] ?? null,
      yoyYenPct,
      yoyContractPct,
      // 契約通貨ベースを公表しない国内系列は null。円建て契約なので為替要因が無い。
      fxSinceBasePct: fxContribution(s.yen, s.contract),
      fxYoyPct: fxContributionYoy(yoyYenPct, yoyContractPct),
    };
  });

  // 이 리포트에서 가장 큰 이야기다.
  //
  // 外航 +52.8% / 国際航空 +48.0% 에 대해 陸上 +3.6% / 港湾運送 +0.8% — 15배 차이다.
  // 이유가 데이터 안에 있다. 국제 계열은 외화로 계약해 엔저가 그대로 얹히고,
  // 국내 계열은 엔화로 계약해 안 얹힌다(그래서 계약통화 베이스가 아예 공표되지 않는다).
  //
  // 일본 화주가 알고 싶은 것이 바로 "왜 국제 운임만 이렇게 오르나"인데,
  // 2026-06호는 이 조각을 02·03·04·05에 흩어놓고 한 번도 잇지 않았다.
  // 새 데이터가 필요 없다 — 이미 가진 값을 묶기만 하면 된다.
  //
  // signals에 넣는 이유: 검수(editorial.js 검사항목 3)가 signals를 본문에서
  // 다뤘는지 확인한다. 여기 넣어야 빠뜨리지 않는다.
  const intl = series.filter((x) => Number.isFinite(x.fxYoyPct) && Number.isFinite(x.yoyYenPct));
  const domestic = series.filter((x) => x.contract === null && Number.isFinite(x.yoyYenPct));
  const fxGap = (intl.length > 0 && domestic.length > 0) ? [{
    kind: 'fx_exposure_gap',
    intlTop: intl.slice().sort((a, b) => b.yoyYenPct - a.yoyYenPct)[0],
    domesticLow: domestic.slice().sort((a, b) => a.yoyYenPct - b.yoyYenPct)[0],
    note: '外貨建て契約の系列(契約通貨ベースが公表される)と円建て契約の系列'
      + '(契約通貨ベースが公表されない)で伸びが大きく分かれている。'
      + '国際の系列は円安がそのまま上乗せされ、国内の系列は上乗せされない。'
      + 'これが両者の差の主要因である。両者を必ず並べて述べ、契約通貨の違いで説明する。',
  }] : [];

  // 계약통화 기준이 100 미만인 계열은 반드시 다뤄야 하는 앵글이다.
  const belowBase = series
    .filter((s) => Number.isFinite(s.contract) && s.contract < INDEX_BASE)
    .map((s) => ({
      kind: 'contract_below_base',
      series: s.name,
      contract: s.contract,
      yen: s.yen,
      note: `契約通貨ベース ${s.contract} — 基準年(2020年)を下回る。円ベース ${s.yen} との差は為替要因。`,
    }));
  const signals = [...fxGap, ...belowBase];

  return {
    period: period(at),
    source: SOURCES.sppi,
    baseYear: '2020',
    unit: 'index',
    // 두 기준의 차이가 환율이라는 것은 지수の定義であって特定系列の特性ではない。
    // これを書いておかないと、検査側が系列ごとに根拠を求めて差し戻す。
    basisNote: '円ベースは契約通貨ベースに為替変動を加えたもの。両者の差は定義上すべて為替要因であり、'
      + '個別系列ごとの根拠を要しない。契約通貨ベースが運賃そのものの動きに近い。'
      + '為替換算による上乗せ分は、基準年からのぶんと前年同月比のぶんの両方を算出済みで渡している。'
      + 'いずれも円ベース÷契約通貨ベースで求めた値であり、自分で計算しない。'
      + 'これは系列ごとの契約構成に対する為替の効きであって、ドル円の変動率そのものではない。'
      + '【用語の区別】次の四つは別の概念であり、まとめて「為替寄与」と呼んではならない。'
      + '(1)単純差=円ベースの伸び率-契約通貨ベースの伸び率。単位はポイント。'
      + '(2)為替換算による上乗せ率=(1+円ベース伸び)÷(1+契約通貨ベース伸び)-1。単位は%。積の関係で求める。'
      + '(3)指数の比=円ベース指数÷契約通貨ベース指数-1。基準年からの累積。単位は%。'
      + '(4)指数差が円ベース指数に占める割合。単位は%。'
      + '【必須】(1)を述べるときは「ポイント」、(2)(3)(4)を述べるときは「%」と書き分ける。'
      + '(2)を(1)から引き算で導けるように書かない — 積の関係なので合わない。',
    // 階層は日本銀行の品目分類である。series[].parent を見て書く。
    hierarchyNote: '各系列に付した親系列は日本銀行の品目分類にもとづく。'
      + '親系列がある場合は「陸上貨物輸送のうち道路貨物輸送」のように内訳として書いてよい。'
      + '親系列が示されていない系列については階層に触れない。'
      + '【重要】親系列は品目分類上の親であって、子系列の合計ではない。'
      + 'SPPI は加重平均の指数であり、足し算では出ない。'
      + '「航空貨物輸送は国際と国内の合計」のようには書かない。'
      + '書けるのは「〜のうち」「〜の内訳」という分類関係までである。',
    series,
    signals,
  };
}

function buildPortFacts(rows, at) {
  const total = rows.find((r) => r.port_code === 'JP_MAJOR6') || null;
  const ports = rows
    .filter((r) => r.port_code !== 'JP_MAJOR6' && PORT_NAMES[r.port_code])
    .map((r) => ({
      code: r.port_code,
      name: PORT_NAMES[r.port_code],
      teu: Number(r.teu),
      exportTeu: r.export_teu === null ? null : Number(r.export_teu),
      importTeu: r.import_teu === null ? null : Number(r.import_teu),
      yoyPct: r.yoy_pct === null ? null : Number(r.yoy_pct),
    }))
    .sort((a, b) => b.teu - a.teu);

  return {
    period: period(at),
    source: SOURCES.port,
    unit: 'TEU',
    scope: '主要6港 外国貿易コンテナ',
    // 속보와 확보는 모집단·확정도가 다르다. 어느 쪽인지 밝히지 않으면 비교가 어긋난다.
    isPreliminary: Boolean(total ? total.is_preliminary : rows[0] && rows[0].is_preliminary),
    total: total
      ? {
        teu: Number(total.teu),
        exportTeu: total.export_teu === null ? null : Number(total.export_teu),
        importTeu: total.import_teu === null ? null : Number(total.import_teu),
        yoyPct: total.yoy_pct === null ? null : Number(total.yoy_pct),
      }
      : null,
    ports,
  };
}

function buildTradeFacts(rows, at) {
  const total = rows.find((r) => r.country_name === 'Grand Total') || null;
  const countries = rows
    .filter((r) => !r.is_aggregate)
    .map((r) => ({
      name: countryJa(r.country_name),
      exportJpy: r.export_jpy === null ? null : Number(r.export_jpy),
      importJpy: r.import_jpy === null ? null : Number(r.import_jpy),
      balanceJpy:
        r.export_jpy === null || r.import_jpy === null ? null : Number(r.export_jpy) - Number(r.import_jpy),
      yoyExportPct: r.yoy_export_pct === null ? null : Number(r.yoy_export_pct),
      yoyImportPct: r.yoy_import_pct === null ? null : Number(r.yoy_import_pct),
    }))
    .sort((a, b) => (b.exportJpy || 0) - (a.exportJpy || 0));

  return {
    period: period(at),
    source: SOURCES.trade,
    unit: 'thousand_jpy',
    total: total
      ? {
        exportJpy: Number(total.export_jpy),
        importJpy: Number(total.import_jpy),
        balanceJpy: Number(total.export_jpy) - Number(total.import_jpy),
        yoyExportPct: total.yoy_export_pct === null ? null : Number(total.yoy_export_pct),
        yoyImportPct: total.yoy_import_pct === null ? null : Number(total.yoy_import_pct),
      }
      : null,
    countries,
  };
}

function buildCommodityFacts(rows, at) {
  const group = (direction) => {
    const agg = new Map();
    for (const r of rows) {
      if (r.direction !== direction) continue;
      agg.set(r.commodity_name, (agg.get(r.commodity_name) || 0) + Number(r.value_jpy));
    }
    const sum = [...agg.values()].reduce((a, b) => a + b, 0);
    return [...agg.entries()]
      .map(([name, valueJpy]) => ({ name, valueJpy, sharePct: sum ? (valueJpy / sum) * 100 : null }))
      .sort((a, b) => b.valueJpy - a.valueJpy);
  };
  return {
    period: period(at), source: SOURCES.commodity, unit: 'thousand_jpy',
    export: group('export'), import: group('import'),
  };
}

/** 현재 수집 범위에 없는 것. 없는 줄 모르고 쓰면 근거 없는 서술이 나온다. */
const KNOWN_GAPS = [
  // 為替は SPPI の円ベース÷契約通貨ベースで数値化できる(fxSinceBasePct)。結損ではない。
  // 航路別荷動きは JPMAC から取れるようになった(route軸)。船腹・消化率は依然として無い。
  '航路別の船腹供給量・消化率 — 需給のどちら側から動いたかは説明できない',
  // 欠航便数は主要East-West航路ぶんを持つ(supply軸)。日本発着に限った系列は無い。
  '日本発着に限定した欠航便数 — 日本の航路そのものの供給は示せない',
];

/**
 * 供給側 — Drewry の欠航便数。
 *
 * 単位は TEU ではなく「便数」である。テーブルの列名が blanked_teu / planned_teu だが、
 * 中身は Drewry の "M blank sailings out of N planned sailings" の M と N で、
 * 実体は便数だ(collectors 側の列名が実態と合っていない)。TEU として書くと
 * 「58TEU が欠航」という有り得ない文になるので、ここで単位を言い直しておく。
 *
 * 対象は主要 East-West 航路であって日本発着ではない。日本の荷主にとっては
 * 自社航路そのものではないが、アジア〜欧州・太平洋の供給が絞られたかどうかは
 * スポット運賃の背景として読む値打ちがある。範囲を明示した上で載せる。
 */
/** 늘어놓은 시점이 실제로 몇 주에 걸치는지. 연속으로 오해받지 않도록 함께 넘긴다. */
function spanWeeks(rows) {
  if (!rows || rows.length < 2) return rows ? rows.length : 0;
  const first = Date.parse(rows[rows.length - 1].week_start);
  const last = Date.parse(rows[0].week_start);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return rows.length;
  return Math.round((last - first) / (7 * 24 * 3600 * 1000)) + 1;
}

function buildSupplyFacts(rows) {
  const sorted = [...(rows || [])]
    .filter((r) => r && r.week_start)
    .sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)));
  if (sorted.length === 0) return null;

  const num = (v) => (v === null || v === undefined ? null : Number(v));
  const latest = sorted[0];
  const recent = sorted.slice(0, 6);
  return {
    source: 'Drewry Cancelled Sailings Tracker',
    unit: 'sailings', // 便数。TEU ではない
    scope: '主要East-West航路(アジア〜欧州・太平洋・大西洋)。日本発着に限った数字ではない。',
    asOf: latest.week_start,
    blankedSailings: num(latest.blanked_teu),
    plannedSailings: num(latest.planned_teu),
    blankPct: num(latest.blank_pct),
    // 単月の断面だけでは絞られたのか緩んだのかが読めない。直近の公表を並べる。
    //
    // 公表週は連続していない。Drewry が毎週出すとは限らず、こちらの取得が飛ぶ週もある。
    // これを断らないと本文が「直近5週」と書く(2026-06号が実際にそうなった。
    // 6/5・7/3・7/10・7/17・7/31 の5点で、間の4週が欠けている)。
    recentNote: '公表週は連続していない。欠けている週がある。'
      + '「直近N週」とは書かず、日付を挙げて「公表された直近N回」として述べる。',
    recent: recent.map((r) => ({
      week: r.week_start,
      blankedSailings: num(r.blanked_teu),
      blankPct: num(r.blank_pct),
    })),
    // 並べた点が実際に何週にまたがるか。連続と誤読されないように数で示す。
    recentSpanWeeks: spanWeeks(recent),
  };
}

/**
 * 航路別荷動き — 日本海事センター(JPMAC).
 *
 * 이 리포트에서 유일하게 "일본 화물이 얼마나 움직였나"를 항로 단위로 말해주는 축이다.
 * 港湾統計은 일본 항구의 TEU를 주지만 목적지 항로를 모르고, 貿易統計은 금액이지 물량이 아니다.
 *
 * 2026년 6월 북미 왕항: 日本 53,701TEU(▲3.2%) / 中国 954,767TEU(+25.5%).
 * 이 대비가 일본 화주에게 가장 실감나는 숫자다.
 *
 * 두 항로의 성격이 다르다:
 *   north_america (PIERS) — 국가별. 일본 단독 수치가 나온다.
 *   europe        (CTS)   — 지역별만. 일본은 北東アジア에 묶여 따로 안 나온다.
 * 유럽에서 일본을 뽑아낼 수 없다. 그 한계를 scope와 note로 함께 넘긴다.
 */
function buildRouteFacts(rows) {
  if (!rows || rows.length === 0) return null;

  const byTrade = {};
  for (const r of rows) {
    const t = (byTrade[r.trade] ||= { rows: [] });
    t.rows.push(r);
  }

  const build = (key, label, hasCountry) => {
    const t = byTrade[key];
    if (!t || t.rows.length === 0) return null;
    // 같은 축 안에 여러 달이 섞일 수 있다. 최신 달만 쓴다.
    const latest = t.rows.reduce((a, b) => (
      (b.year * 12 + b.month) > (a.year * 12 + a.month) ? b : a), t.rows[0]);
    const same = t.rows.filter((r) => r.year === latest.year && r.month === latest.month);
    const total = same.find((r) => r.scope === 'total') || null;
    const pick = (n) => same.find((r) => r.name === n) || null;
    const num = (v) => (v === null || v === undefined ? null : Number(v));
    const one = (r) => (r ? {
      name: r.name, teu: num(r.teu), yoyPct: num(r.yoy_pct),
      sharePct: num(r.share_pct), cumTeu: num(r.cum_teu), cumYoyPct: num(r.cum_yoy_pct),
    } : null);

    return {
      label,
      period: `${latest.year}-${String(latest.month).padStart(2, '0')}`,
      direction: latest.direction,
      source: latest.source,
      total: one(total),
      // 일본과, 비교 대상이 되는 상위 몇 개. 전부 넣으면 본문이 나열로 흐른다.
      japan: hasCountry ? one(pick('日本')) : null,
      peers: hasCountry
        ? ['中国', '韓国', '台湾', 'ベトナム'].map(pick).filter(Boolean).map(one)
        : same.filter((r) => r.scope === 'region').map(one),
      hasCountryDetail: hasCountry,
    };
  };

  const northAmerica = build('north_america', '北米往航(アジア→米国)', true);
  const europe = build('europe', '欧州往航(アジア→欧州)', false);
  if (!northAmerica && !europe) return null;

  return {
    unit: 'TEU',
    northAmerica,
    europe,
    note: '北米は国別、欧州は地域別までの公表である。'
      + '欧州航路に日本単独の数字は無く、日本は北東アジアに含まれる — 日本の数字として書かない。'
      + '航路別の荷動き量であり、日本の港湾取扱量(港湾統計)とは母集団が異なる。'
      + '両者を足したり、一方から他方を説明したりしない。',
  };
}

function buildFactsheet({ sppi, port, trade, commodity, global, rail, supply, route }) {
  const periods = {
    sppi: sppi.period,
    port: port.period,
    trade: trade.period,
    commodity: commodity.period,
  };
  const distinct = new Set(Object.values(periods));
  return {
    generatedFor: periods.trade, // 무역이 가장 최신이라 리포트 기준월로 삼는다
    periods,
    // 기준월이 섞였다는 사실을 감추면 "6월 리포트"에 5월 항만 수치가 조용히 들어간다.
    periodMismatch: distinct.size > 1,
    gaps: [...KNOWN_GAPS],
    // 世界のスポットは週次で最新まで、日本の統計は月次で遅れて出る。
    // この非対称が「次に出る日本の数字がどちらを向くか」を語る根拠になる。
    publicationLag:
      '世界のスポット指数は週次で直近まで公表される。日本の企業向けサービス価格指数は月次で、'
      + '当月分の公表までに約2か月かかる。したがって、直近のスポットの動きは、'
      + 'まだ公表されていない日本の指数がどちらを向くかを考える材料になる。'
      + 'ただし転嫁の幅と時期は契約条件によって異なり、データからは特定できない。',
    sppi,
    port,
    trade,
    commodity,
    global: global ?? null,
    rail: rail ?? null,
    supply: supply ?? null,
    route: route ?? null,
  };
}

module.exports = {
  PORT_NAMES,
  GLOBAL_CODES,
  SPPI_TREND_SERIES,
  countryJa,
  buildGlobalFacts,
  buildSupplyFacts,
  buildRouteFacts,
  SERIES_PARENT,
  fxContribution,
  fxContributionYoy,
  buildGlobalHistory,
  buildSppiHistory,
  buildRailFacts,
  buildSppiFacts,
  buildPortFacts,
  buildTradeFacts,
  buildCommodityFacts,
  buildFactsheet,
};
