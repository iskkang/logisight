'use strict';
// generators/jp-report/verify/editorial.js
// verifier (b) — LLM 편집 검수. 결정적 검증(numbers.js)이 못 잡는 것을 본다.
//
// 잡는 대상:
//  - 추측·가능성 서술 (실제 샘플: 「港湾間での取扱シフトが進んでいる可能性」)
//  - 팩트시트에 없는 사실의 추가
//  - signals 누락 (계약통화 지수가 기준연도를 밑도는데 언급하지 않음)
//  - 기준월 불일치 미고지
//  - gaps에 있는 것(환율 등)을 근거처럼 서술
//  - 문체 위반
//
// 자동 발행이므로 판정을 못 읽으면 통과가 아니라 REVISE로 떨어뜨린다.

const VERDICTS = new Set(['PASS', 'REVISE', 'REJECT']);

const REVIEW_SCHEMA = `{
  "verdict": "PASS" | "REVISE" | "REJECT",
  "issues": [
    { "type": "speculation|unsupported_fact|missing_signal|period_not_disclosed|gap_violation|style",
      "quote": "問題のある本文の抜粋",
      "reason": "なぜ問題か" }
  ]
}`;

function parseVerdict(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const issues = (Array.isArray(obj.issues) ? obj.issues : [])
    .filter((i) => i && typeof i === 'object' && (i.quote || i.reason))
    .map((i) => ({
      type: String(i.type || 'other'),
      quote: String(i.quote || ''),
      reason: String(i.reason || ''),
    }));

  let verdict = String(obj.verdict || '').trim().toUpperCase();
  if (!VERDICTS.has(verdict)) verdict = 'REVISE'; // 읽을 수 없으면 통과시키지 않는다
  // 지적이 달려 있는데 PASS로 오는 경우가 있다. 지적이 우선한다.
  if (verdict === 'PASS' && issues.length > 0) verdict = 'REVISE';

  return { verdict, issues };
}

const needsRewrite = (verdict) => verdict === 'REVISE' || verdict === 'REJECT';

/**
 * 발행을 막는 지적 유형.
 * 사실관계 위반은 막고, 문체는 기록만 한다 — 문체 지적만으로 영구히 막히면
 * 자동 파이프라인이 한 번도 발행하지 못한다.
 */
const BLOCKING_TYPES = new Set(['speculation', 'unsupported_fact', 'gap_violation', 'period_not_disclosed']);

const isBlocking = (type) => BLOCKING_TYPES.has(String(type));

function splitBySeverity(issues) {
  const list = Array.isArray(issues) ? issues : [];
  return {
    blocking: list.filter((i) => isBlocking(i.type)),
    warnings: list.filter((i) => !isBlocking(i.type)),
  };
}

function buildIssueFeedback(issues) {
  if (!issues || issues.length === 0) return '';
  return issues
    .map((i) => (i.quote ? `- 「${i.quote}」 … ${i.reason}` : `- ${i.reason}`))
    .join('\n');
}

function buildReviewPrompt(section, body, slim) {
  return [
    `以下は月次レポート「${section.no}. ${section.title}」の原稿である。編集者として検査せよ。`,
    '',
    '【検査項目】',
    '1. 根拠のない推測がないか。',
    '   ここで言う「根拠のない」とは、どの数値・どの事実から言えるのかが本文に示されていないものを指す。',
    '   このレポートは分析と見通しを書くことを目的としている。次のものは指摘してはならない:',
    '     - 世界のスポット指数と日本の指数を突き合わせた記述(同時に観測された事実として並べるもの)',
    '     - 公表時差にもとづく見通し(世界のスポットは週次で直近まで、日本の指数は月次で約2か月遅れる。',
    '       したがって直近のスポットの動きは、まだ公表されていない日本の指数を考える材料になる)。',
    '       factsheet の publicationLag がその根拠である。',
    '     - 「〜と考えられる。ただし〜は特定できない」の形で限界を添えた記述',
    '   逆に、次は指摘する: 数値の予測(「来月は240に達する」)、時差の長さの断定',
    '   (「3週後に波及する」)、根拠を示さない「〜とみられる」。',
    '     - 為替寄与(fxSinceBasePct / fxYoyPct)を用いた記述。これは factsheet が算出済みの値である。'
    ,'       円ベース = 契約通貨ベース × 為替 という積の関係から比で求めており、引き算では合わない。'
    ,'       「円ベース+52.8%のうち為替が+11.2%、運賃そのものが+37.4%」は正しい(52.8-37.4=15.4 ではない)。'
    ,'2. ファクトシートにない事実を書いていないか',
    '3. signals にある項目を本文で扱っているか(扱っていなければ missing_signal)',
    '4. periodMismatch が true なら基準月が異なることを明示しているか',
    '5. gaps にある項目(データがないもの)を根拠のように書いていないか',
    '6. 文体 — 常体、名詞止めの見出し、情緒的な形容がないか',
    '7. 数値を並べただけで解釈がない原稿になっていないか。',
    '   対比・順位・分岐・見通しのいずれも無い場合は style として指摘する。',
    '',
    '【判定】',
    'PASS: 問題なし / REVISE: 修正が必要 / REJECT: 全面書き直しが必要',
    '問題がなければ issues は空配列にする。問題があるのに PASS としてはならない。',
    '',
    '【出力】次の JSON のみを出力する。説明文は書かない。',
    REVIEW_SCHEMA,
    '',
    '【ファクトシート】',
    JSON.stringify(slim),
    '',
    '【原稿】',
    body,
  ].join('\n');
}

/**
 * @param {(args: object) => Promise<any>} callJson callClaudeJson 등 JSON을 돌려주는 호출자
 * @param {object} factsheet 전체 팩트시트. 슬림본을 주면 안 된다 —
 *   총론은 다른 섹션이 확정한 수치를 인용하는데, 검수자가 그 수치를 못 보면
 *   전부 출처 불명으로 판정한다(실제로 그렇게 오탐이 났다).
 */
async function reviewSection(callJson, section, body, factsheet) {
  const raw = await callJson({
    // claude-sonnet-5는 thinking과 본문이 max_tokens를 함께 쓴다(lib/claude.js 주석).
    // 8000으로는 가장 무거운 02. 海運에서 사고 과정이 예산을 다 써 응답이 비었고,
    // 전체 실행이 죽었다(2026-06호 재생성에서 두 번). writer와 같은 예산으로 맞춘다.
    max_tokens: 16000,
    system: 'あなたは日本の物流専門メディアの編集デスクだ。原稿を検査し、指摘を JSON で返す。',
    messages: [{ role: 'user', content: buildReviewPrompt(section, body, factsheet) }],
    debugPrefix: `jp-editorial-${section.id}`,
  });
  return parseVerdict(raw);
}

module.exports = {
  parseVerdict, needsRewrite, isBlocking, splitBySeverity,
  buildIssueFeedback, buildReviewPrompt, reviewSection,
};
