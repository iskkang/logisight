'use strict';
// Phase 6 — 주간 전망 초안 생성 (Claude API)
// 최신 지표 스냅샷 + 최근 7일 뉴스 + 활성 장애 + 임박 정책을 모아
// 현상→원인→배경→전망 표준 프롬프트로 전망 초안을 생성, forecasts에 status='draft'로 적재.
// 발행은 프론트 admin 검수 큐(/admin/forecasts)에서만 이뤄진다.
//
// 실행: node generators/web/generate-forecasts.js   (또는 npm run generate:forecasts)

const path = require('path');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false }, realtime: { enabled: false } },
);

const MODULES = ['rates', 'eurasia', 'trade', 'policy'];
const CONFIDENCE = ['high', 'medium', 'low'];

// --- Claude (Messages API, raw fetch — repo의 LLM 클라이언트 패턴과 동일) ---
async function callClaude({ system, user, maxTokens = 4000 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 미설정');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error('Anthropic HTTP ' + r.status + ': ' + t.slice(0, 300));
  }
  const data = await r.json();
  return (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function extractJson(text) {
  let t = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  return JSON.parse(t);
}

// --- 입력 스냅샷 수집 ---
async function gatherSnapshot() {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  const [{ data: idxRows }, { data: news }, { data: disruptions }, { data: policies }] =
    await Promise.all([
      supabase
        .from('freight_indices')
        .select('index_code,value,change_pct,week_date')
        .order('week_date', { ascending: false })
        .limit(400),
      supabase
        .from('maritime_news')
        .select('title,summary,category,published_at,source')
        .gte('published_at', since)
        .order('published_at', { ascending: false })
        .limit(40),
      supabase
        .from('eurasia_disruptions')
        .select('title,segment,severity,delay_contribution_days,lane_id')
        .eq('status', 'active')
        .limit(20),
      supabase
        .from('policies')
        .select('title_ko,region,country_code,policy_type,effective_date,severity,summary_ko,affected_hs_chapters')
        .gte('effective_date', today)
        .lte('effective_date', horizon)
        .order('effective_date', { ascending: true })
        .limit(20),
    ]);

  // 지수: 코드별 최신 1개
  const latestIdx = new Map();
  for (const r of idxRows || []) if (!latestIdx.has(r.index_code)) latestIdx.set(r.index_code, r);
  const indices = [...latestIdx.values()].map((r) => ({
    code: r.index_code,
    value: r.value,
    change_pct: r.change_pct,
    week_date: r.week_date,
  }));

  return { today, indices, news: news || [], disruptions: disruptions || [], policies: policies || [] };
}

const SYSTEM = `당신은 한국 화주·포워더를 위한 물류 인텔리전스 애널리스트다.
주어진 지표·뉴스·장애·정책 스냅샷만 근거로 모듈별 전망 초안을 작성한다.

규칙(엄수):
- 각 전망 statement는 "현상 → 원인 → 배경 → 전망" 흐름을 자연스러운 산문으로 담는다(라벨 소제목 금지).
- 단정 표현 금지. 확률·추정 표현 강제("~할 가능성", "~로 추정", "~와 정합"). 인과 단정("~때문에") 금지.
- 선행/후행 판정 금지.
- impact_note에는 독자 단위 3단 변환을 반드시 포함: 지수 변화 → FEU/kg당 비용·리드타임 영향 → 권장 행동 1개.
- basis는 실제 스냅샷의 지표·수치 문자열 배열. 스냅샷에 없는 수치를 지어내지 마라.
- horizon_date는 판정 기준일(YYYY-MM-DD). 정책은 effective_date, 운임/유라시아는 2~4주 후를 기준으로.
- metric_ref는 판정에 쓸 지표 참조(예: KCCI, SCFI, delay_index_weekly:<lane_id>).
- invalidation_condition은 전망을 무효화하는 조건(예: 해협 재개방).
- confidence는 high|medium|low.
- 신호가 약하거나 데이터가 부족한 모듈은 생략한다. 억지로 만들지 마라.

출력은 오직 JSON 객체 하나:
{"forecasts":[{"module":"rates|eurasia|trade|policy","statement":"...","basis":["..."],"impact_note":"...","horizon_date":"YYYY-MM-DD","confidence":"high|medium|low","invalidation_condition":"...","metric_ref":"..."}]}`;

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
  }
  const snap = await gatherSnapshot();
  console.log(
    `📦 스냅샷: 지표 ${snap.indices.length} · 뉴스 ${snap.news.length} · 장애 ${snap.disruptions.length} · 임박정책 ${snap.policies.length}`,
  );

  const user = `오늘: ${snap.today}

[지표 스냅샷]
${JSON.stringify(snap.indices)}

[최근 7일 뉴스]
${JSON.stringify(snap.news)}

[활성 유라시아 장애]
${JSON.stringify(snap.disruptions)}

[향후 60일 임박 정책]
${JSON.stringify(snap.policies)}

위 스냅샷만 근거로 모듈별 전망 초안을 작성하라.`;

  const text = await callClaude({ system: SYSTEM, user, maxTokens: 4000 });
  let parsed;
  try {
    parsed = extractJson(text);
  } catch (e) {
    console.error('❌ JSON 파싱 실패. 원문 일부:\n' + text.slice(0, 500));
    throw e;
  }

  const drafts = Array.isArray(parsed.forecasts) ? parsed.forecasts : [];
  let inserted = 0;
  for (const f of drafts) {
    if (!MODULES.includes(f.module) || !f.statement) {
      console.warn(`⚠️ 스킵(모듈/본문 부적합): ${JSON.stringify(f).slice(0, 80)}`);
      continue;
    }
    const row = {
      module: f.module,
      statement: String(f.statement),
      basis: Array.isArray(f.basis) ? f.basis.map(String) : null,
      impact_note: f.impact_note ? String(f.impact_note) : null,
      horizon_date: f.horizon_date || null,
      confidence: CONFIDENCE.includes(f.confidence) ? f.confidence : null,
      invalidation_condition: f.invalidation_condition ? String(f.invalidation_condition) : null,
      metric_ref: f.metric_ref ? String(f.metric_ref) : null,
      status: 'draft',
    };
    const { error } = await supabase.from('forecasts').insert(row);
    if (error) {
      console.error(`❌ insert 실패 [${f.module}]: ${error.message}`);
    } else {
      inserted++;
      console.log(`✅ draft [${f.module}] ${row.statement.slice(0, 40)}…`);
    }
  }

  console.log(`📊 생성 완료: ${inserted}/${drafts.length} draft 적재 (검수 대기). 발행은 /admin/forecasts에서.`);
}

main().catch((error) => {
  console.error(`❌ generate-forecasts 실패: ${error.message}`);
  process.exit(1);
});
