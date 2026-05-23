'use strict';
// scripts/generate-cadi-weekly.js
// Usage: node scripts/generate-cadi-weekly.js [input-file.json]
// Reads Q16 questionnaire JSON → fetches delay context from Supabase →
// calls Claude to generate bilingual (EN/ZH) CADI weekly draft.

const fs   = require('fs');
const path = require('path');

const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTPUT_DIR      = path.resolve(__dirname, '../content/drafts');
const DEFAULT_INPUT   = path.resolve(__dirname, '../content/inputs/cadi-weekly-input.json');

// --- Guard: Anthropic key is required ---
if (!ANTHROPIC_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY is not set.');
  process.exit(1);
}

// --- Resolve input file ---
const inputFile = process.argv[2]
  ? path.resolve(process.argv[2])
  : DEFAULT_INPUT;

if (!fs.existsSync(inputFile)) {
  console.error(`ERROR: Input file not found: ${inputFile}`);
  process.exit(1);
}

// --- Q16 field metadata: maps key → section number + label ---
const Q_META = {
  q1_transit_times:    { section: 1, label: 'Transit times (lanes/routes)' },
  q2_delay_vs_normal:  { section: 1, label: 'Delay vs normal this week' },
  q3_cargo_stuck:      { section: 1, label: 'Cargo currently stuck' },
  q4_policy_change:    { section: 2, label: 'New policy / regulation change' },
  q5_border_status:    { section: 2, label: 'Border / customs status' },
  q6_delay_case:       { section: 2, label: 'Specific delay case (border/customs)' },
  q7_rate_change:      { section: 3, label: 'Rate change this week' },
  q8_space_availability: { section: 3, label: 'Space / booking availability' },
  q9_spot_rate:        { section: 3, label: 'Spot rate level' },
  q10_equipment:       { section: 4, label: 'Container / equipment situation' },
  q11_equipment_issues: { section: 4, label: 'Equipment shortages or issues' },
  q12_truck_last_mile: { section: 5, label: 'Truck / last-mile situation' },
  q13_tsr_status:      { section: 5, label: 'TSR rail corridor status' },
  q14_sea_vs_rail:     { section: 5, label: 'Sea vs rail comparison' },
  q15_next_week_watch: { section: 6, label: 'Items to watch next week' },
  q16_other:           { section: 6, label: 'Other comments' },
};

// Section header mapping (부록 B 2절 구조)
const SECTION_HEADERS = {
  1: '1. Transit & Delay (운행 시효 & 딜레이)',
  2: '2. Border / Customs / Policy (국경·통관·정책)',
  3: '3. Booking & Rates (부킹·운임)',
  4: '4. Container & Equipment (컨테이너·장비)',
  5: '5. Related Logistics (관련 물류)',
  6: '6. Outlook (전망·코멘트)',
};

// System prompt: 부록 B 4절 rules verbatim
const SYSTEM_PROMPT = `You are an expert Central Asia logistics report writer for MTL Shipping Agency.

Generate a bilingual (English first, then Chinese 中文) weekly intelligence report following these rules EXACTLY:

GENERATION RULES (부록 B 4절):
1. Render ONLY sections where answers exist. Empty / null answers = omit that sentence/subsection entirely.
2. If a full section has zero answered questions, omit the entire section. Never write fake "no issues this week" filler.
3. For each answered item, structure content as: Phenomenon → Cause → Background → Outlook (use only what the data supports — do not fabricate missing steps).
4. Output is bilingual: English first, Chinese (中文) second for each section. Global readers; English is primary.
5. Generalize — remove any client name, specific cargo details, or contract-identifying information.
6. Trust markers — cite numbers as "based on MTL-handled shipments this week". If sample is thin, label as "indicative".
7. External citations must be paraphrased with source attribution. Do not copy verbatim.
8. Output section headers must follow this exact structure:
   1. Transit & Delay (运输时效 & 延误)
   2. Border / Customs / Policy (边境 / 通关 / 政策)
   3. Booking & Rates (订舱 & 运价)
   4. Container & Equipment (集装箱 & 设备)
   5. Related Logistics (关联物流)
   6. Outlook (展望)
9. Begin each section with its English/Chinese header. Skip sections with no data entirely.
10. Keep language concise and professional. No speculation beyond what the input data supports.`;

function buildDelayTable(rows) {
  if (!rows || rows.length === 0) return null;
  const lines = [
    '| Lane | Milestone | Median Delay (h) | P90 (h) | On-Time Rate | Quality |',
    '|------|-----------|-----------------|---------|--------------|---------|',
  ];
  for (const r of rows) {
    const med    = r.median_delay_h != null ? `${r.median_delay_h}h` : '—';
    const p90    = r.p90_delay_h    != null ? `${r.p90_delay_h}h`   : '—';
    const onTime = r.on_time_rate   != null ? `${Math.round(r.on_time_rate * 100)}%` : '—';
    const qual   = r.data_quality   ? `${r.data_quality} (n=${r.sample_count})` : `n=${r.sample_count}`;
    lines.push(`| ${r.lane_id} | ${r.milestone} | ${med} | ${p90} | ${onTime} | ${qual} |`);
  }
  return lines.join('\n');
}

function isoWeek(date) {
  const d = new Date(date);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.ceil((((d - jan4) / 86_400_000) + jan4.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

async function fetchDelayData() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — skipping delay data.');
    return null;
  }
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const today = new Date();
    const twoWeeksAgo = new Date(today.getTime() - 14 * 86_400_000);
    const minWeek = isoWeek(twoWeeksAgo);
    const { data, error } = await supabase
      .from('delay_index_weekly')
      .select('lane_id, week_iso, milestone, median_delay_h, p90_delay_h, on_time_rate, sample_count, data_quality')
      .gte('week_iso', minWeek)
      .eq('milestone', 'DEST_ARR')
      .order('week_iso', { ascending: false })
      .order('lane_id');
    if (error) {
      console.warn(`WARNING: delay_index_weekly query failed: ${error.message} — skipping delay data.`);
      return null;
    }
    return data;
  } catch (err) {
    console.warn(`WARNING: Supabase fetch error: ${err.message} — skipping delay data.`);
    return null;
  }
}

function buildUserPrompt(week, input, delayTable) {
  const lines = [];
  lines.push(`Week: ${week}`);
  lines.push('');

  // Include delay table if available
  if (delayTable) {
    lines.push('## Delay Index Data (last 2 weeks, DEST_ARR milestone)');
    lines.push(delayTable);
    lines.push('');
  }

  // Collect answered questions, grouped by section
  const answered = {};
  for (const [key, meta] of Object.entries(Q_META)) {
    const val = input[key];
    if (val == null || val === '') continue;
    if (!answered[meta.section]) answered[meta.section] = [];
    answered[meta.section].push({ label: meta.label, value: val });
  }

  if (Object.keys(answered).length === 0) {
    lines.push('No questionnaire answers provided this week.');
  } else {
    lines.push('## Q16 Questionnaire Answers (answered items only)');
    lines.push('');
    for (const sectionNum of Object.keys(answered).sort()) {
      lines.push(`### ${SECTION_HEADERS[sectionNum]}`);
      for (const item of answered[sectionNum]) {
        lines.push(`- **${item.label}**: ${item.value}`);
      }
      lines.push('');
    }
  }

  lines.push('Please generate the CADI Weekly report draft following the system rules. Output only the report content (no preamble).');
  return lines.join('\n');
}

async function main() {
  // Load and parse input
  let input;
  try {
    const raw = fs.readFileSync(inputFile, 'utf-8');
    input = JSON.parse(raw);
  } catch (err) {
    console.error(`ERROR: Failed to read/parse input file: ${err.message}`);
    process.exit(1);
  }

  const week = input.week || isoWeek(new Date());

  // Fetch delay data (non-fatal if unavailable)
  const delayRows = await fetchDelayData();
  const delayTable = buildDelayTable(delayRows);

  if (delayRows && delayRows.length > 0) {
    console.log(`Delay rows fetched: ${delayRows.length}`);
  } else {
    console.log('Delay data: not available (skipped).');
  }

  // Build prompts
  const userPrompt = buildUserPrompt(week, input, delayTable);

  // Call Claude
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  console.log(`Calling Claude (claude-sonnet-4-6) for week ${week}...`);
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = msg.content[0].type === 'text' ? msg.content[0].text : '';

  // Build output file
  const today = new Date().toISOString().slice(0, 10);
  const header = [
    `# CADI Weekly Draft — ${week}`,
    `**Generated**: ${today} by generate-cadi-weekly.js`,
    `**Status**: DRAFT — requires human POV review before publication`,
    `**Review checklist**: [ ] facts accurate [ ] no client identifiers [ ] tone appropriate [ ] links added`,
    '',
    '---',
    '',
  ].join('\n');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, `cadi-weekly-${today}.md`);
  fs.writeFileSync(outPath, header + text + '\n', 'utf-8');

  console.log(`Draft written: ${outPath}`);
}

main().catch(err => {
  console.error(`ERROR: generate-cadi-weekly.js failed: ${err.message}`);
  process.exit(1);
});
