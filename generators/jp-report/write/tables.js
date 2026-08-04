'use strict';
// generators/jp-report/write/tables.js
// 팩트시트 → 마크다운 표. **코드가 그린다.**
//
// 한국 월간 리포트 파이프라인과 같은 방침이다 — 프롬프트에 이렇게 적혀 있다:
//   "지수 표·차트는 시스템이 자동 주입하므로 본문에 표나 수치를 그리지 말 것"
// 표를 LLM이 쓰면 수치 오류가 반드시 섞인다(실제로 값 뒤바꿈·합산 오류가 반복됐다).
// 코드가 그리면 그 부류가 원천 차단되고, 본문은 해석에만 집중하면 된다.

// 일본 재무 표기에서 ▲는 마이너스다. 문체 가이드도 「マイナスは「▲○%」」로 정하고 있고
// 본문도 그렇게 쓴다('名古屋港は▲0.8%' = 감소). 표에서 ▲를 증가 화살표로 쓰면
// 같은 문서 안에서 같은 기호가 정반대를 뜻하게 된다 — 실제로 그렇게 나왔다.
const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(v)
  ? '—'
  : (v < 0 ? `▲${Math.abs(v).toFixed(1)}%` : `+${v.toFixed(1)}%`));

const fmtInt = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))
  ? '—'
  : (Number(v) < 0
    ? `▲${Math.abs(Number(v)).toLocaleString('en-US')}`
    : Number(v).toLocaleString('en-US')));

const fmtNum = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));

/** 千円 → 億円. 팩트시트 금액 단위가 千円이라 표기 단위로 환산한다. */
const toOku = (thousandYen) => (thousandYen === null || thousandYen === undefined
  ? null
  : Number(thousandYen) / 1e5);

function table(header, rows) {
  const head = `| ${header.join(' | ')} |`;
  const sep = `|${header.map(() => '---').join('|')}|`;
  return [head, sep, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function sppiTable(facts) {
  const s = facts.sppi || {};
  const rows = (s.series || []).map((x) => [
    x.name,
    fmtNum(x.yen),
    fmtPct(x.yoyYenPct),
    x.contract === null || x.contract === undefined ? '—' : fmtNum(x.contract),
    x.yoyContractPct === null || x.yoyContractPct === undefined ? '—' : fmtPct(x.yoyContractPct),
  ]);
  const body = table(['系列', '円ベース', '前年同月比', '契約通貨ベース', '前年同月比'], rows);
  const note = `※ ${s.period || ''} 分。指数は${s.baseYear || '2020'}年=100。`
    + '円ベースは契約通貨ベースに為替変動を加えたもので、両者の差は定義上すべて為替要因。'
    + `契約通貨ベースが公表されない系列は「—」。出典: ${s.source || ''}。`;
  return `${body}\n\n${note}`;
}

function portTable(facts) {
  const p = facts.port || {};
  const rows = [];
  if (p.total) {
    rows.push(['**主要6港 合計**', `**${fmtInt(p.total.teu)}**`, fmtInt(p.total.exportTeu), fmtInt(p.total.importTeu),
      fmtPct(p.total.yoyPct)]);
  }
  for (const x of p.ports || []) {
    rows.push([x.name, fmtInt(x.teu), fmtInt(x.exportTeu), fmtInt(x.importTeu), fmtPct(x.yoyPct)]);
  }
  const body = table(['港湾', '合計 (TEU)', '輸出', '輸入', '前年同月比'], rows);
  const note = `※ ${p.period || ''} 分${p.isPreliminary ? '(速報値 — 確報とは確定度が異なる)' : '(確報値)'}。`
    + '外国貿易コンテナ。合計は主要6港の合計であり全国計ではない。'
    + `出典: ${p.source || ''}。`;
  return `${body}\n\n${note}`;
}

function tradeTable(facts) {
  const t = facts.trade || {};
  const rows = [];
  if (t.total) {
    rows.push(['**総額**', `**${fmtInt(Math.round(toOku(t.total.exportJpy)))}**`,
      fmtPct(t.total.yoyExportPct),
      fmtInt(Math.round(toOku(t.total.importJpy))),
      fmtPct(t.total.yoyImportPct),
      fmtInt(Math.round(toOku(t.total.balanceJpy)))]);
  }
  for (const c of (t.countries || []).slice(0, 10)) {
    rows.push([c.name, fmtInt(Math.round(toOku(c.exportJpy))),
      fmtPct(c.yoyExportPct),
      fmtInt(Math.round(toOku(c.importJpy))),
      fmtPct(c.yoyImportPct),
      fmtInt(Math.round(toOku(c.balanceJpy)))]);
  }
  const body = table(['相手国', '輸出 (億円)', '前年同月比', '輸入 (億円)', '前年同月比', '収支 (億円)'], rows);
  return `${body}\n\n※ ${t.period || ''} 分。輸出上位10か国。地域集計は除く。出典: ${t.source || ''}。`;
}

function commodityTable(facts) {
  const c = facts.commodity || {};
  const ex = c.export || [];
  const im = c.import || [];
  const n = Math.max(ex.length, im.length);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    rows.push([
      ex[i] ? ex[i].name : '—',
      ex[i] ? fmtInt(Math.round(toOku(ex[i].valueJpy))) : '—',
      ex[i] ? `${fmtNum(ex[i].sharePct)}%` : '—',
      im[i] ? im[i].name : '—',
      im[i] ? fmtInt(Math.round(toOku(im[i].valueJpy))) : '—',
      im[i] ? `${fmtNum(im[i].sharePct)}%` : '—',
    ]);
  }
  const body = table(['輸出品目', '金額 (億円)', '構成比', '輸入品目', '金額 (億円)', '構成比'], rows);
  return `${body}\n\n※ ${c.period || ''} 分。概況品目の大分類10品目。出典: ${c.source || ''}。`;
}

/**
 * 世界のスポット運賃指数。
 * 変化率は発表元の前回比であり、日本の前年同月比とは別物 — 列名で区別する。
 */
function globalTable(facts) {
  const g = facts.global || {};
  const rows = (g.indices || []).map((i) => [
    i.label,
    i.value === null || i.value === undefined ? '—' : fmtNum(i.value, 1),
    i.changePct === null || i.changePct === undefined ? '—' : fmtPct(i.changePct),
    i.asOf || '—',
  ]);
  const body = table(['指数', '直近値', '前回比', '基準日'], rows);
  const note = `※ 週次で公表され、日本の月次統計とは基準日が揃わない。前回比は発表元の公表値。`
    + `韓国発を基準とする指数(KCCI 等)は扱わない。出典: ${g.source || ''}。`;
  return `${body}

${note}`;
}

/** 섹션별로 주입할 표. 없으면 빈 문자열. */
function tablesFor(sectionId, facts) {
  switch (sectionId) {
    case 'global': return globalTable(facts);
    case 'freight': return sppiTable(facts);
    case 'port': return portTable(facts);
    case 'trade': return `${tradeTable(facts)}\n\n${commodityTable(facts)}`;
    default: return '';
  }
}

module.exports = {
  fmtPct, fmtInt, fmtNum, toOku, table,
  globalTable, sppiTable, portTable, tradeTable, commodityTable, tablesFor,
};
