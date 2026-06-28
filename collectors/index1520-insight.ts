// index1520 격주 리포트 본문 → DeepSeek로 "가장 강한 헤드라인 + 분석" 생성 → eurasia_charts(key='ai_insight').
// 유라시아 페이지 종합판단 카드가 이 스냅샷을 읽어 표시. 평이한 한국어(어려운 한자 금지).
// 실행: npx tsx collectors/index1520-insight.ts  (DEEPSEEK_API_KEY + SUPABASE 필요)
import { fetchListing } from './index1520_reports';
import { fetchArticleBody } from './utils/article_body';
import { dbUpsert } from './utils/supabase_writer';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { callDeepSeekJson } = require('../generators/lib/deepseek.js') as {
  callDeepSeekJson: (o: { system?: string; messages: { role: string; content: string }[]; max_tokens?: number; debugPrefix?: string }) => Promise<unknown>;
};

const SOURCE = 'index1520';
const SOURCE_URL = 'https://index1520.com/en/analytics/?type[]=2';
const SYSTEM =
  '당신은 유라시아 철도 물류 시장 애널리스트입니다. index1520(ERAI)의 격주 시장 리포트를 읽고, 한국 화주·포워더가 한눈에 이해할 핵심을 뽑습니다. ' +
  '평이한 한국어로 쓰고 어려운 한자어는 쓰지 않습니다. 중국-유럽 철도 운임·물동량·운송기간과 그 동인에 집중합니다. JSON만 출력합니다.';

type Insight = { headline: string; analysis: string };

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('[index1520-insight] DEEPSEEK_API_KEY 미설정 — 건너뜀(기존 스냅샷 유지)');
    return;
  }

  // 최신 "Eurasian logistics market update"(격주 시리즈) 2건 우선, 없으면 최신 2건
  const listed = await fetchListing().catch(() => []);
  const series = listed.filter((r) => /Eurasian logistics market update/i.test(r.title));
  const picks = (series.length ? series : listed).slice(0, 2);
  if (!picks.length) {
    console.warn('[index1520-insight] 리포트 없음 — 건너뜀');
    return;
  }

  const blocks: string[] = [];
  for (const r of picks) {
    const body = await fetchArticleBody(r.url).catch(() => '');
    if (body) blocks.push(`[${r.title}]\n${body.slice(0, 2200)}`);
  }
  if (!blocks.length) {
    console.warn('[index1520-insight] 본문 추출 실패 — 건너뜀');
    return;
  }

  const user =
    `다음은 최근 index1520 유라시아 철도 시장 리포트 본문입니다.\n\n${blocks.join('\n\n')}\n\n` +
    '위 내용을 근거로 아래 JSON만 출력하세요.\n' +
    '{\n' +
    '  "headline": "가장 강한 핵심 인사이트 한 줄(28자 내외, 한국어, 명사형 마무리)",\n' +
    '  "analysis": "2~3문장 분석. 구체 수치(운임·물동량·운송기간 변화)와 핵심 동인을 포함. 한국어."\n' +
    '}';

  let insight: Insight;
  try {
    const obj = (await callDeepSeekJson({ system: SYSTEM, messages: [{ role: 'user', content: user }], max_tokens: 1200, debugPrefix: 'index1520-insight' })) as Insight;
    if (!obj?.headline || !obj?.analysis) throw new Error('빈 응답');
    insight = { headline: String(obj.headline).trim(), analysis: String(obj.analysis).trim() };
  } catch (e) {
    console.error('[index1520-insight] 생성 실패:', (e as Error).message);
    return;
  }

  const payload = {
    headline: insight.headline,
    analysis: insight.analysis,
    basedOn: picks.map((r) => r.title),
    sourceUrl: picks[0].url,
    generatedAt: new Date().toISOString(),
  };

  await dbUpsert(
    'eurasia_charts',
    [{ key: 'ai_insight', payload, source: SOURCE, source_url: SOURCE_URL, updated_at: new Date().toISOString() }],
    'key',
  );
  console.log(`✅ index1520-insight: "${insight.headline}" (기반 ${picks.length}건) → eurasia_charts.ai_insight`);
}

main().catch((e) => {
  console.error('[index1520-insight] failed:', (e as Error).message);
  process.exit(1);
});
