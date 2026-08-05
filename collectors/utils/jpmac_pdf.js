'use strict';
// 日本海事センター(JPMAC) 「海上荷動きの動向」概要PDF 파싱.
//
// 이 축이 왜 필요한가: 지금까지 일본판이 가진 물량 지표는 港湾統計(일본 항구의 TEU)뿐이고,
// 그건 "어느 항로로 갔는가"를 말해주지 않는다. JPMAC은 일본발 화물을 항로 단위로 낸다.
// 2026년 6월 북미 왕항에서 日本 53,701TEU(▲3.2%)인데 中国은 954,767TEU(+25.5%)다.
// 이 대비는 다른 어느 축에서도 안 나온다.
//
// ■ 형식
// HTML 표가 없다. 개요가 PDF로만 나오고, pdf-parse로 텍스트는 깨끗이 뽑힌다.
// 다만 표의 숫자가 구분자 없이 붙어 나온다:
//   |日本53,701   -3.2    2.8321,930-3.4|
//   → 日本 / 53,701 / -3.2 / 2.8 / 321,930 / -3.4
// 쉼표가 3자리씩 끊는다는 성질로 경계를 잡는다.
//
// ■ 두 항로의 성격이 다르다
//   북미(PIERS)   — 국가별. 일본 단독 수치가 나온다.
//   유럽(CTS)     — 지역별만. 일본은 北東アジア에 묶여 따로 안 나온다.
// 유럽에서 일본을 뽑아낼 수는 없다. 지역까지가 한계라고 밝히고 쓴다.

/** 쉼표로 3자리씩 끊은 수 또는 맨 수. 붙어 나온 숫자의 경계를 이걸로 잡는다. */
const NUM = String.raw`\d{1,3}(?:,\d{3})+|\d+`;

/**
 * 표 한 줄.
 *
 * 이름 부분을 게으르게 잡는다 — 「18ヶ国・地域 合計」처럼 이름에 숫자가 들어간다.
 * 뒤의 다섯 수가 전부 맞아야 성립하므로 역추적으로 경계가 정해진다.
 */
const ROW = new RegExp(
  `^(.+?)\\s*(${NUM})\\s*(-?\\d+\\.\\d)\\s*(\\d+\\.\\d)\\s*(${NUM})\\s*(-?\\d+\\.\\d)$`,
);

const toInt = (s) => Number(String(s).replace(/,/g, ''));

/** 「2026年6月[往航]速報値」/「2026年5月[往航/復航]速報値」 */
function parseHeader(text) {
  const m = /(\d{4})年(\d{1,2})月\s*[［\[]([^\]］]+)[\]］]/.exec(text);
  if (!m) return null;
  const pub = /(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(text);
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    directions: m[3].split('/').map((s) => s.trim()).filter(Boolean),
    publishedAt: pub ? `${pub[1]}-${String(pub[2]).padStart(2, '0')}-${String(pub[3]).padStart(2, '0')}` : null,
  };
}

/**
 * 표 블록의 행들. 표 제목(表N…)부터 다음 표 제목 또는 「出所」까지.
 *
 * @param {string} text PDF 전문
 * @param {RegExp} titleRe 표 제목 패턴
 */
function parseTable(text, titleRe) {
  const lines = text.split('\n').map((l) => l.trim());
  const start = lines.findIndex((l) => titleRe.test(l));
  if (start < 0) return [];

  const rows = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    // 다음 표나 출처를 만나면 끝. 「出所：CTS社」「出典」 등.
    if (/^表\d/.test(line) || /^出所|^出典/.test(line)) break;
    // 헤더 행(荷動量 前年比 シェア …)은 수가 없어 ROW에 안 걸린다.
    const m = ROW.exec(line);
    if (!m) continue;
    const name = m[1].replace(/\s+/g, ' ').trim();
    if (!name) continue;
    rows.push({
      name,
      teu: toInt(m[2]),
      yoyPct: Number(m[3]),
      sharePct: Number(m[4]),
      cumTeu: toInt(m[5]),
      cumYoyPct: Number(m[6]),
    });
  }
  return rows;
}

/**
 * 본문 산문의 합계. 표와 대조하기 위한 것이다.
 *
 * 「前年比14%増の191.6万TEU」「前年比3.1%増の186.7万TEU」
 * 표만 믿으면 형식이 바뀌었을 때 조용히 틀린 수가 나간다(Drewry에서 3주간 그랬다).
 * 두 경로로 읽어 어긋나면 그 회차를 버린다.
 */
function parseProseTotal(text) {
  // PDF는 줄바꿈이 아무데나 들어간다 — 「186.7万」과 「TEU」 사이에서도 끊긴다
  // (유럽 개요가 실제로 그랬다). 문장 단위로 읽는 값이라 공백을 먼저 지우고 본다.
  const flat = String(text || '').replace(/\s+/g, '');
  const m = /前年比(\d+(?:\.\d+)?)[%％](増|減)[^。]*?の([\d,]+(?:\.\d+)?)万TEU/.exec(flat);
  if (!m) return null;
  return {
    yoyPct: Number(m[1]) * (m[2] === '減' ? -1 : 1),
    manTeu: Number(String(m[3]).replace(/,/g, '')),
  };
}

/**
 * 표 합계와 산문 합계가 맞는지.
 * 표는 TEU, 산문은 万TEU(소수 1자리)라 반올림 차이만 허용한다.
 */
function crossCheck(tableTotalTeu, prose) {
  if (!prose || !Number.isFinite(tableTotalTeu)) return { ok: false, reason: '대조할 값이 없다' };
  const diff = Math.abs(tableTotalTeu / 10000 - prose.manTeu);
  // 万TEU 소수 1자리 반올림이면 최대 0.05万. 여유를 두고 0.1万.
  if (diff > 0.1) {
    return { ok: false, reason: `표 ${(tableTotalTeu / 10000).toFixed(2)}万TEU vs 본문 ${prose.manTeu}万TEU` };
  }
  return { ok: true };
}

/**
 * 북미 항로 개요 — 국가·지역별.
 * @returns {{header, rows, prose, check}|null}
 */
function parseNorthAmerica(text) {
  const header = parseHeader(text);
  if (!header) return null;
  const rows = parseTable(text, /^表1\s*\d{4}年\d{1,2}月/);
  const prose = parseProseTotal(text);
  const total = rows[0];
  return {
    header,
    rows,
    prose,
    check: crossCheck(total ? total.teu : NaN, prose),
  };
}

/**
 * 유럽 항로 개요 — 지역별만. 일본 단독 수치는 없다.
 * 表1이 아시아(積), 表2가 유럽(揚)이고 합계는 같다.
 */
function parseEurope(text) {
  const header = parseHeader(text);
  if (!header) return null;
  const rows = parseTable(text, /^表1\s*アジア/);
  const prose = parseProseTotal(text);
  const total = rows[0];
  return {
    header,
    rows,
    prose,
    check: crossCheck(total ? total.teu : NaN, prose),
  };
}

module.exports = {
  ROW, NUM, parseHeader, parseTable, parseProseTotal, crossCheck,
  parseNorthAmerica, parseEurope,
};
