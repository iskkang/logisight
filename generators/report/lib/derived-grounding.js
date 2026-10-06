'use strict';
// generators/report/lib/derived-grounding.js
// 「생성 시점에 모델에게 준 근거」를 한 곳에서 만들고, 파일로 얼린다.
//
// ■ 왜 얼리나 —— 검증이 재현되지 않았다
// verify-report.js 는 검증할 때마다 이 근거를 다시 계산했다. 리포트 본문은 생성
// 시점에 고정되는데 근거만 움직이니, 같은 문서가 시간이 지나면 저절로 실패한다.
// 2026-09호가 정확히 그랬다. 9/7 에 critical 0 으로 통과한 초안을 10/6 에 다시
// 검증하자 critical 3 이 떴고, 셋 다 본문 오류가 아니라 근거가 움직인 것이었다.
//
//   본문(9/7)                     10/6 재계산    왜 움직였나
//   CCFI/SCFI 52.3% ← 57.9%       51.2% ← 56.2%  멈춰 있던 CCFI 의 08-31 행이
//                                                9/7 이후 도착 → 공통 최신주 이동
//   상관계수 0.99                 0.97           표본이 늘었다
//   혼잡도 WoW -17.5%             -12.5%         buildPortCongestion() 은 기준일
//                                                인자가 없다 —— 언제 불러도 '지금'
//
// 앞의 둘은 weekEnd 를 박아도 늦게 도착하는 행 때문에 또 움직인다. 마지막은
// portcast.io 를 실시간으로 긁는 구조라 과거 시점 조회 자체가 불가능하다.
// 그러니 인자를 더하는 식으로는 못 고친다 —— 만든 순간의 값을 적어 두는 수밖에 없다.
//
// ■ 언제 쓰나
// 조립(assemble-monthly-report.js)이 초안을 확정하는 순간 saveGrounding() 으로
// 같은 디렉터리에 떨군다. 검증은 loadGrounding() 으로 그 파일을 읽는다.
// 파일이 없으면(스냅샷 도입 전의 옛 호) 예전처럼 재계산하되 경고를 남긴다.

const fs = require('fs');
const path = require('path');

const { prevMonthOf, monthEndISO } = require('./report-month');
const { buildDerivedMetrics, loadKitaLanes } = require('./derived-metrics-loader');

const ROOT = path.resolve(__dirname, '../../..');

/** @param {string} month 'YYYY-MM' */
function groundingPath(month) {
  return path.join(ROOT, 'content', 'monthly-report', month, 'derived-grounding.md');
}

/**
 * 파생 지표·KITA 권역 지수·혼잡 신호를 한 덩어리 텍스트로.
 * 생성 프롬프트에 들어가지만 최종 문서에는 표로 남지 않는 값들이라, 검증자가
 * 이걸 못 보면 본문의 정당한 인용을 "표에 없는 창작 수치"로 판정한다.
 * @param {string} month 'YYYY-MM'
 * @returns {Promise<string|null>}
 */
async function buildGroundingText(month) {
  try {
    const weekEnd = monthEndISO(prevMonthOf(month));
    let congestion = null;
    try { congestion = await require('./port-congestion').buildPortCongestion(); } catch (_) {}
    const d = await buildDerivedMetrics({ weekEnd, kitaSea: loadKitaLanes(), congestion });
    const texts = [d.spreadBlock, d.gapBlock, d.kitaGapBlock, d.decouplingBlock, d.bunkerDivergenceBlock]
      .filter(Boolean).map(b => b.factText);
    if (d.congestionSignalText) texts.push(d.congestionSignalText);

    // KITA 권역 지수(RADIS·북미·유럽·아시아). 생성 시 kitaFactText 로 주입되지만
    // 최종 문서에는 표가 아니라 차트로만 남는다. 2026-09 의 '북미 19,827.5원'
    // critical 이 그것이었다 —— 실재하는 주입값인데 검증자 눈에 없었다.
    try {
      const { buildKitaSeaReport, buildKitaAirReport } = require('./kita-report');
      for (const build of [buildKitaSeaReport, buildKitaAirReport]) {
        const b = build();
        if (b && b.factText) texts.push(`## KITA 참고운임·권역 지수(생성 시 주입분)\n${b.factText}`);
      }
    } catch (e) {
      console.warn('⚠️  KITA 근거 수집 실패(무시) —', e.message);
    }

    return texts.length ? texts.join('\n\n') : null;
  } catch (e) {
    console.warn('⚠️  파생 지표 근거 계산 실패(무시) —', e.message);
    return null;
  }
}

/**
 * 지금 계산한 근거를 파일로 얼린다. 조립 시점에 한 번 부른다.
 * @returns {Promise<string|null>} 저장 경로 (근거가 비면 null)
 */
async function saveGrounding(month) {
  const text = await buildGroundingText(month);
  if (!text) return null;
  const file = groundingPath(month);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = [
    `<!-- 생성 시점에 모델에게 주입된 근거 데이터의 스냅샷.`,
    `     검증(verify-report.js)은 재계산하지 않고 이 파일과 대조한다 —— 재계산하면`,
    `     늦게 도착한 지수 행·실시간 혼잡도 때문에 통과했던 리포트가 나중에 실패한다.`,
    `     얼린 시각: ${new Date().toISOString()} -->`,
    '',
  ].join('\n');
  fs.writeFileSync(file, header + text + '\n', 'utf-8');
  return file;
}

/**
 * 얼려 둔 근거를 읽는다. 없으면 null —— 호출부가 재계산으로 물러난다.
 * @returns {string|null}
 */
function loadGrounding(month) {
  const file = groundingPath(month);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf-8');
  return raw.replace(/^<!--[\s\S]*?-->\n*/, '').trim() || null;
}

module.exports = { groundingPath, buildGroundingText, saveGrounding, loadGrounding };
