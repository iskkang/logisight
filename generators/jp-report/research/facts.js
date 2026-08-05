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
    note: '中国–欧州の鉄道運賃と輸送日数。日本発着ではないが、アジア–欧州の代替ルートとして参照する。',
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

  // 계약통화 기준이 100 미만인 계열은 반드시 다뤄야 하는 앵글이다.
  const signals = series
    .filter((s) => Number.isFinite(s.contract) && s.contract < INDEX_BASE)
    .map((s) => ({
      kind: 'contract_below_base',
      series: s.name,
      contract: s.contract,
      yen: s.yen,
      note: `契約通貨ベース ${s.contract} — 基準年(2020年)を下回る。円ベース ${s.yen} との差は為替要因。`,
    }));

  return {
    period: period(at),
    source: SOURCES.sppi,
    baseYear: '2020',
    unit: 'index',
    // 두 기준의 차이가 환율이라는 것은 지수の定義であって特定系列の特性ではない。
    // これを書いておかないと、検査側が系列ごとに根拠を求めて差し戻す。
    basisNote: '円ベースは契約通貨ベースに為替変動を加えたもの。両者の差は定義上すべて為替要因であり、'
      + '個別系列ごとの根拠を要しない。契約通貨ベースが運賃そのものの動きに近い。'
      + 'fxSinceBasePct は基準年(2020年)からの為替寄与、fxYoyPct は前年同月比における為替寄与で、'
      + 'いずれも円ベース÷契約通貨ベースから算出済みである。自分で計算しない。'
      + 'これは系列ごとの契約構成に対する為替の効きであって、ドル円の変動率そのものではない。',
    // 階層は日本銀行の品目分類である。series[].parent を見て書く。
    hierarchyNote: '各系列の parent は日本銀行の品目分類にもとづく親系列である。'
      + 'parent がある系列は「陸上貨物輸送のうち道路貨物輸送」のように内訳として書いてよい。'
      + 'parent が null の系列については階層に触れない。',
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
  '航路別荷動き(JPMAC) — 船腹・消化率に触れられない',
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
function buildSupplyFacts(rows) {
  const sorted = [...(rows || [])]
    .filter((r) => r && r.week_start)
    .sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)));
  if (sorted.length === 0) return null;

  const num = (v) => (v === null || v === undefined ? null : Number(v));
  const latest = sorted[0];
  return {
    source: 'Drewry Cancelled Sailings Tracker',
    unit: 'sailings', // 便数。TEU ではない
    scope: '主要East-West航路(アジア〜欧州・太平洋・大西洋)。日本発着に限った数字ではない。',
    asOf: latest.week_start,
    blankedSailings: num(latest.blanked_teu),
    plannedSailings: num(latest.planned_teu),
    blankPct: num(latest.blank_pct),
    // 単月の断面だけでは絞られたのか緩んだのかが読めない。直近数週を並べる。
    recent: sorted.slice(0, 6).map((r) => ({
      week: r.week_start,
      blankedSailings: num(r.blanked_teu),
      blankPct: num(r.blank_pct),
    })),
  };
}

function buildFactsheet({ sppi, port, trade, commodity, global, rail, supply }) {
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
  };
}

module.exports = {
  PORT_NAMES,
  GLOBAL_CODES,
  SPPI_TREND_SERIES,
  countryJa,
  buildGlobalFacts,
  buildSupplyFacts,
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
