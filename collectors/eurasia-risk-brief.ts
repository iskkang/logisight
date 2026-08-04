// index1520 격주 리포트 + 철도 뉴스(maritime_news '철도') 분석 → DeepSeek로
// Action Queue용 철도 액션 1건 + 유라시아 리스크 3~4건 생성 → eurasia_charts(key='rail_brief').
// 종합(control tower) 페이지가 이 스냅샷을 읽어 카드에 표시. eurasia_disruptions(타 파이프라인)는 건드리지 않음.
// 실행: npx tsx collectors/eurasia-risk-brief.ts  (DEEPSEEK_API_KEY + SUPABASE 필요)
import ws from 'ws';
// Node 20: supabase-js realtime용 WebSocket shim
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(globalThis as any).WebSocket) (globalThis as any).WebSocket = ws as unknown as never;
import { createClient } from '@supabase/supabase-js';

import { fetchListing } from './index1520_reports';
import { fetchArticleBody } from './utils/article_body';
import { dbUpsert } from './utils/supabase_writer';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { callDeepSeekJson } = require('../generators/lib/deepseek.js') as {
  callDeepSeekJson: (o: { system?: string; messages: { role: string; content: string }[]; max_tokens?: number; debugPrefix?: string }) => Promise<unknown>;
};

const SOURCE = 'index1520';
const SEV = new Set(['high', 'medium', 'low']);

// 언어별로 따로 생성한다. 같은 근거(리포트·뉴스)에서 각 언어로 쓰게 하고,
// eurasia_charts는 key-value 테이블이라 키를 나눈다(rail_brief / rail_brief_ja).
// 번역하지 않는 이유는 forecasts와 같다 — 대상 독자가 다르다.
const LANGS = [
  {
    lang: 'ko',
    key: 'rail_brief',
    system:
      '당신은 유라시아 철도 물류 리스크 애널리스트입니다. index1520(ERAI) 격주 시장 리포트와 최근 철도 뉴스를 근거로 '
      + '한국 화주·포워더가 바로 쓸 수 있는 핵심 액션 1건과 주요 리스크 3~4건을 도출합니다. '
      + '평이한 한국어로 쓰고 어려운 한자어는 쓰지 않습니다. 추측 금지(근거 있는 것만). JSON만 출력합니다.',
    ask:
      '위 근거로 아래 JSON만 출력하세요. severity는 high|medium|low. 본문은 한국어로 작성하세요.\n'
      + '{\n'
      + '  "action": { "title": "지금 챙길 핵심 액션 한 줄(24자 내외)", "sub": "한 줄 근거/수치(40자 내외)", "severity": "high|medium|low" },\n'
      + '  "risks": [ { "title": "유라시아 철도 리스크(20자 내외)", "severity": "high|medium|low" } ],\n'
      + '  "outlook": { "summary": "향후 2~4주 유라시아 철도 시장 전망 2~3문장(운임·물동량·리드타임 방향, 수치 포함)", "points": ["운임 방향 한 줄", "물동량 방향 한 줄", "리드타임/기타 한 줄"] }\n'
      + '}',
  },
  {
    lang: 'ja',
    key: 'rail_brief_ja',
    system:
      'あなたはユーラシア鉄道物流のリスクアナリストである。index1520(ERAI)の隔週マーケットレポートと直近の鉄道ニュースを根拠に、'
      + '日本の荷主・フォワーダーがすぐ使える重要アクション1件と主要リスク3〜4件を導く。'
      + '常体(だ・である)で平易に書く。推測は禁止(根拠のあることだけ)。JSON のみを出力する。',
    // 出力言語の指示はユーザーメッセージ側にも要る。system だけ日本語にして
    // スキーマ説明を韓国語のままにしたら、モデルは韓国語で書いてきた(実際にそうなった)。
    ask:
      '上記の根拠から、以下の JSON だけを出力すること。severity は high|medium|low。本文はすべて日本語(常体)で書く。\n'
      + '{\n'
      + '  "action": { "title": "今すぐ押さえるべき打ち手を一行(全角24字程度)", "sub": "根拠・数値を一行(全角40字程度)", "severity": "high|medium|low" },\n'
      + '  "risks": [ { "title": "ユーラシア鉄道のリスク(全角20字程度)", "severity": "high|medium|low" } ],\n'
      + '  "outlook": { "summary": "今後2〜4週のユーラシア鉄道市況の見通しを2〜3文(運賃・輸送量・リードタイムの方向、数値を含める)", "points": ["運賃の方向を一行", "輸送量の方向を一行", "リードタイムなどを一行"] }\n'
      + '}',
  },
] as const;

type Brief = {
  action: { title: string; sub: string; severity: string };
  risks: { title: string; severity: string }[];
  outlook: { summary: string; points: string[] };
};

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('[eurasia-risk-brief] DEEPSEEK_API_KEY 미설정 — 건너뜀');
    return;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('[eurasia-risk-brief] SUPABASE env 미설정 — 건너뜀');
    return;
  }

  // 1) 리포트 본문(최신 격주 2건)
  const listed = await fetchListing().catch(() => []);
  const series = listed.filter((r) => /Eurasian logistics market update/i.test(r.title));
  const picks = (series.length ? series : listed).slice(0, 2);
  const reportBlocks: string[] = [];
  for (const r of picks) {
    const body = await fetchArticleBody(r.url).catch(() => '');
    if (body) reportBlocks.push(`[${r.title}]\n${body.slice(0, 2000)}`);
  }

  // 2) 철도 뉴스(maritime_news category='철도', 최신 10건)
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: news } = await sb
    .from('maritime_news')
    .select('title,summary,published_at')
    .eq('category', '철도')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(10);
  const newsBlock = (news ?? [])
    .map((n: { title: string; summary: string | null }) => `- ${n.title}${n.summary ? `: ${n.summary.slice(0, 140)}` : ''}`)
    .join('\n');

  if (!reportBlocks.length && !newsBlock) {
    console.warn('[eurasia-risk-brief] 입력(리포트/뉴스) 없음 — 건너뜀');
    return;
  }

  const evidence =
    `# index1520 격주 리포트\n${reportBlocks.join('\n\n') || '(없음)'}\n\n`
    + `# 최근 철도 뉴스\n${newsBlock || '(없음)'}\n\n`;

  // 한 언어가 실패해도 다른 언어는 살린다 — 한쪽 때문에 둘 다 못 쓰면 손해다.
  for (const L of LANGS) {
    const user = evidence + L.ask;

    let brief: Brief;
    try {
      const obj = (await callDeepSeekJson({ system: L.system, messages: [{ role: 'user', content: user }], max_tokens: 1500, debugPrefix: `eurasia-risk-brief-${L.lang}` })) as Brief;
      const action = obj?.action;
      const risks = Array.isArray(obj?.risks) ? obj.risks : [];
      if (!action?.title || !risks.length) throw new Error('빈 응답');
      const ol = (obj as { outlook?: { summary?: unknown; points?: unknown } })?.outlook;
      const outlook = {
        summary: String(ol?.summary ?? '').trim(),
        points: Array.isArray(ol?.points) ? ol!.points.map((p) => String(p).trim()).filter(Boolean).slice(0, 4) : [],
      };
      brief = {
        action: { title: String(action.title).trim(), sub: String(action.sub ?? '').trim(), severity: SEV.has(action.severity) ? action.severity : 'medium' },
        risks: risks.filter((r) => r?.title).slice(0, 4).map((r) => ({ title: String(r.title).trim(), severity: SEV.has(r.severity) ? r.severity : 'low' })),
        outlook,
      };
    } catch (e) {
      console.error(`[eurasia-risk-brief:${L.lang}] 생성 실패:`, (e as Error).message);
      continue;
    }

    const payload = { ...brief, lang: L.lang, basedOn: picks.map((r) => r.title), newsCount: (news ?? []).length, generatedAt: new Date().toISOString() };
    await dbUpsert('eurasia_charts', [{ key: L.key, payload, source: SOURCE, source_url: 'https://index1520.com/en/analytics/', updated_at: new Date().toISOString() }], 'key');
    console.log(`✅ eurasia-risk-brief[${L.lang}]: action="${brief.action.title}" risks=${brief.risks.length} → eurasia_charts.${L.key}`);
  }
}

main().catch((e) => {
  console.error('[eurasia-risk-brief] failed:', (e as Error).message);
  process.exit(1);
});
