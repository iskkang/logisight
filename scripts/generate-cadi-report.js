'use strict';
// scripts/generate-cadi-report.js
// 기존 weekly-report.yml에서 호출. delay_index_weekly + disruption_events → content/drafts/ 초안.

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTPUT_DIR   = path.resolve(__dirname, '../content/drafts');
const TEMPLATE_PATH = path.resolve(__dirname, '../content/templates/cadi-weekly-template.md');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function isoWeek(date) {
  const d = new Date(date);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.ceil((((d - jan4) / 86_400_000) + jan4.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function qualityBadge(quality, n) {
  const labels = {
    confirmed:   `✅ 확인 (n=${n})`,
    provisional: `⚠️ 잠정 (n=${n})`,
    indicative:  `🔵 참고 (n=${n})`,
  };
  return labels[quality] ?? `n=${n}`;
}

function buildDelayTable(rows) {
  if (!rows || rows.length === 0) return '_이번 기간 딜레이 데이터 없음_';

  const lines = [
    '| 노선 | 마일스톤 | 중앙값(h) | P90(h) | 정시율 | 신뢰도 |',
    '|------|----------|----------|--------|--------|--------|',
  ];
  for (const r of rows) {
    const med    = r.median_delay_h != null ? `${r.median_delay_h}h` : '—';
    const p      = r.p90_delay_h    != null ? `${r.p90_delay_h}h`   : '—';
    const onTime = r.on_time_rate   != null ? `${Math.round(r.on_time_rate * 100)}%` : '—';
    lines.push(`| ${r.lane_id} | ${r.milestone} | ${med} | ${p} | ${onTime} | ${qualityBadge(r.data_quality, r.sample_count)} |`);
  }
  return lines.join('\n');
}

function buildDisruptionSection(events) {
  if (!events || events.length === 0) return '이번 기간 특이 국경·정책 이슈 없음.';
  return events.map(e => {
    const title = e.title_ko ?? e.title_en;
    const desc  = e.description_en ? `\n${e.description_en}` : '';
    const src   = e.source_url ? `\n출처: ${e.source_url}` : '';
    return `**[${e.severity.toUpperCase()}] ${title}**${desc}${src}`;
  }).join('\n\n');
}

async function main() {
  const today = new Date();
  const publishDate = today.toLocaleDateString('ko-KR');
  const twoWeeksAgo = new Date(today.getTime() - 14 * 86_400_000);
  const minWeek = isoWeek(twoWeeksAgo);

  // Fetch last 2 weeks of delay data
  const { data: delayRows, error: delayErr } = await supabase
    .from('delay_index_weekly')
    .select('lane_id, week_iso, milestone, median_delay_h, p90_delay_h, on_time_rate, sample_count, data_quality')
    .gte('week_iso', minWeek)
    .order('week_iso', { ascending: false })
    .order('lane_id');

  if (delayErr) {
    console.error('❌ delay_index_weekly 조회 실패:', delayErr.message);
    process.exit(1);
  }

  // Fetch active disruption events (unresolved)
  const { data: eventRows } = await supabase
    .from('disruption_events')
    .select('lane_id, event_type, title_en, title_ko, description_en, severity, source_url')
    .is('resolved_at', null)
    .order('severity')
    .limit(10);

  // Load template
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const output = template
    .replace('{{DELAY_TABLE}}',         buildDelayTable(delayRows))
    .replace('{{DISRUPTION_SECTION}}',  buildDisruptionSection(eventRows ?? []))
    .replace('{{ANALYSIS_SECTION}}',    '_분석 섹션: research-market-analyst 결과를 여기에 삽입_')
    .replace('{{PUBLISH_DATE}}',        publishDate);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filename = `cadi-report-${today.toISOString().slice(0, 10)}.md`;
  const outPath  = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(outPath, output, 'utf-8');

  console.log(`✅ CADI 보고서 초안: ${outPath}`);
  console.log(`   딜레이 행: ${delayRows?.length ?? 0}, 이벤트: ${eventRows?.length ?? 0}`);
}

main().catch(err => {
  console.error('❌ generate-cadi-report.js 실패:', err);
  process.exit(1);
});
