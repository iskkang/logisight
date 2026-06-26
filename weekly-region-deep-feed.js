'use strict';
// [프로토타입] 권역 "심층 분석형" 위클리 feed — 미주 시제품.
// 기존 weekly-region-feed(단신 카드형)와 별개. KMI 국제물류위클리 수준을 목표:
//   풀 → 권역 배정 → 핵심 이슈 2~3건 클러스터링 → 이슈별 심층 분석(현황→원인→영향→전망→시사점) →
//   운임 지표(freight_indices) 차트/표 → rich JSON(content/weekly-region-deep/<week>-<region>.json)
// 한국은 실제 연관될 때만 언급(억지 금지). 보고된 사실·수치만(환각 금지).
// 사용법: node weekly-region-deep-feed.js [--week=2026-W26] [--region=americas]
const fs = require('fs');
const path = require('path');
const ws = require('ws'); globalThis.WebSocket = ws;
require('dotenv').config({ path: path.resolve(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');
const { callDeepSeekJson } = require('./generators/lib/deepseek');
const { assignPool, REGIONS } = require('./lib/region-assign');

const CATS = ['해상', '항공', '무역', '물류', '철도'];
const POOL_PER_REGION = 18;     // 클러스터링 입력 상한
const MAX_ISSUES = 3;
const MAX_ARTS_PER_ISSUE = 5;

// 권역별 운임 지표 코드(차트/표).
//  - SCFI 권역 항로가 있으면 SCFI + KCCI 함께 표기(차트는 SCFI 기준): 미주, 유럽, 중국.
//  - SCFI 권역 항로가 없으면 KCCI만($/FEU, 부산 출발): 일본·동남아·중동·아프리카·남미.
//  - 러시아: 컨테이너 지수 미사용(지시) → 지표 섹션 생략.
const REGION_INDICES = {
  americas: { table: ['SCFI_USWC', 'SCFI_USEC', 'KCCI_USWC', 'KCCI_USEC'], chart: { codes: ['SCFI_USWC', 'SCFI_USEC'], title: 'SCFI 미주 항로 컨테이너 운임 ($/FEU)' } },
  europe: { table: ['SCFI_EU', 'KCCI_NEU', 'KCCI_MED'], chart: { codes: ['SCFI_EU'], title: 'SCFI 유럽 항로 컨테이너 운임' } },
  china: { table: ['SCFI', 'CCFI', 'KCCI_CN'], chart: { codes: ['SCFI', 'CCFI'], title: '중국발 컨테이너 운임 (SCFI 종합 · CCFI, 지수)' } },
  japan: { table: ['KCCI_JP'], chart: { codes: ['KCCI_JP'], title: 'KCCI 한국 → 일본 컨테이너 운임 ($/FEU)' } },
  sea: { table: ['KCCI_SEA'], chart: { codes: ['KCCI_SEA'], title: 'KCCI 한국 → 동남아 컨테이너 운임 ($/FEU)' } },
  mideast: { table: ['KCCI_ME', 'KCCI_MED'], chart: { codes: ['KCCI_ME', 'KCCI_MED'], title: 'KCCI 한국 → 중동·지중해 컨테이너 운임 ($/FEU)' } },
  africa: { table: ['KCCI_WAF', 'KCCI_ZAF'], chart: { codes: ['KCCI_WAF', 'KCCI_ZAF'], title: 'KCCI 한국 → 아프리카 컨테이너 운임 ($/FEU)' } },
  latam: { table: ['KCCI_SAE', 'KCCI_SAW'], chart: { codes: ['KCCI_SAE', 'KCCI_SAW'], title: 'KCCI 한국 → 남미 컨테이너 운임 ($/FEU)' } },
};
const IDX_LABEL = {
  SCFI: 'SCFI 종합', SCFI_EU: 'SCFI 유럽', SCFI_USWC: 'SCFI 미서안', SCFI_USEC: 'SCFI 미동안',
  CCFI: 'CCFI 종합', KCCI: 'KCCI 종합', KCCI_CN: 'KCCI 중국', KCCI_JP: 'KCCI 일본', KCCI_SEA: 'KCCI 동남아',
  KCCI_ME: 'KCCI 중동', KCCI_MED: 'KCCI 지중해', KCCI_NEU: 'KCCI 북유럽', KCCI_WAF: 'KCCI 서아프리카',
  KCCI_ZAF: 'KCCI 남아프리카', KCCI_SAE: 'KCCI 남미동안', KCCI_SAW: 'KCCI 남미서안', KCCI_USWC: 'KCCI 미서안', KCCI_USEC: 'KCCI 미동안',
  WCI_SHA_LAX: '상하이→LA', WCI_SHA_NYC: '상하이→뉴욕', WCI_SHA_RTM: '상하이→로테르담', WCI_SHA_GOA: '상하이→제노바', BDI: 'BDI 건화물지수',
};
const IDX_UNIT = {
  SCFI: 'pt', SCFI_EU: '$/TEU', SCFI_USWC: '$/FEU', SCFI_USEC: '$/FEU', CCFI: 'pt', KCCI: 'pt', BDI: 'pt',
  KCCI_CN: '$/FEU', KCCI_JP: '$/FEU', KCCI_SEA: '$/FEU', KCCI_ME: '$/FEU', KCCI_MED: '$/FEU', KCCI_NEU: '$/FEU',
  KCCI_WAF: '$/FEU', KCCI_ZAF: '$/FEU', KCCI_SAE: '$/FEU', KCCI_SAW: '$/FEU',
  WCI_SHA_LAX: '$/FEU', WCI_SHA_NYC: '$/FEU', WCI_SHA_RTM: '$/FEU', WCI_SHA_GOA: '$/FEU',
};

const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : null; };

function isoWeekId(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wn = Math.ceil(((t - ys) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wn).padStart(2, '0')}`;
}
function weekPeriod(d) {
  const t = new Date(d); const off = (t.getDay() + 6) % 7;
  const mon = new Date(t); mon.setDate(t.getDate() - off);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = (x) => `${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`;
  return `${f(mon)}~${f(sun)}`;
}
const mmdd = (s) => (s ? `${s.slice(5, 7)}/${s.slice(8, 10)}` : '');
const pct = (a, b) => (a == null || b == null || !b) ? null : ((a - b) / b) * 100;
const fmtPct = (v) => { if (v == null) return '—'; const r = Number(v.toFixed(1)); return r === 0 ? '0.0%' : `${r > 0 ? '+' : ''}${r.toFixed(1)}%`; };

// freight_indices → 지표 표 + 차트 시계열
async function buildIndices(sb, region) {
  const conf = REGION_INDICES[region];
  if (!conf) return null;
  const all = [...new Set([...conf.table, ...conf.chart.codes])];
  const { data, error } = await sb.from('freight_indices')
    .select('index_code,week_date,value,change_pct')
    .in('index_code', all).order('week_date', { ascending: false }).limit(all.length * 30);
  if (error) throw new Error(error.message);
  const byCode = {};
  for (const r of data) (byCode[r.index_code] = byCode[r.index_code] || []).push(r);  // 최신순

  // 주차가 연속이 아닐 수 있어(예: KCCI 항로 일부 주 누락) 행 인덱스가 아니라 날짜 기준으로 비교 대상 선택.
  const DAY = 86400000;
  const pickByDate = (a, latestWeek, daysBack, tolDays) => {
    const target = new Date(latestWeek + 'T00:00:00Z').getTime() - daysBack * DAY;
    let best = null, bd = Infinity;
    for (const r of a) { const d = Math.abs(new Date(r.week_date + 'T00:00:00Z').getTime() - target); if (d < bd) { bd = d; best = r; } }
    return best && bd <= tolDays * DAY ? best : null;
  };
  // 표: 최신값 + WoW + MoM. WoW는 출처 보고 change_pct 우선(갭 영향 無), 없으면 1주 전 행(±4일)으로 계산.
  const table = [];
  for (const code of conf.table) {
    const a = byCode[code]; if (!a || !a.length) continue;
    const latest = a[0];
    const wowRow = pickByDate(a, latest.week_date, 7, 4);
    const moRow = pickByDate(a, latest.week_date, 28, 10);
    const wow = latest.change_pct != null ? fmtPct(latest.change_pct)
      : fmtPct(pct(latest.value, wowRow && wowRow.value));
    table.push({
      label: IDX_LABEL[code] || code, unit: IDX_UNIT[code] || '',
      value: latest.value, date: mmdd(latest.week_date),
      wow, mom: fmtPct(pct(latest.value, moRow && moRow.value)),
    });
  }

  // 차트: 공통 주차축(최근 16주) × 코드별 시리즈
  const weeksSet = new Set();
  for (const code of conf.chart.codes) for (const r of (byCode[code] || [])) weeksSet.add(r.week_date);
  const weeks = [...weeksSet].sort().slice(-16);
  const datasets = conf.chart.codes.map((code) => {
    const map = Object.fromEntries((byCode[code] || []).map((r) => [r.week_date, r.value]));
    return { label: IDX_LABEL[code] || code, data: weeks.map((w) => (w in map ? map[w] : null)) };
  });
  const asOf = weeks.length ? mmdd(weeks[weeks.length - 1]) : '';
  const fams = new Set();
  for (const code of all) {
    if (code.startsWith('WCI')) fams.add('Drewry WCI');
    else if (code.startsWith('SCFI')) fams.add('Shanghai SCFI');
    else if (code === 'CCFI') fams.add('CCFI');
    else if (code.startsWith('KCCI')) fams.add('KCCI');
    else if (code === 'BDI') fams.add('Baltic BDI');
  }
  return { asOf, title: conf.chart.title, labels: weeks.map(mmdd), datasets, table, source: `freight_indices (${[...fams].join(' · ')})` };
}

function clusterMessages(arts, label) {
  const list = arts.map((a, i) => `${i}. [${a.briefType}] ${a.title} — ${(a.summary || '').slice(0, 120)}`).join('\n');
  return [{ role: 'user', content: `다음은 지난주 ${label} 권역 물류 기사 목록이다.
이번 주 가장 중요한 핵심 이슈를 ${MAX_ISSUES}개 이내로 선정하고, 각 이슈에 관련 기사 번호를 배정하라.
- 한 이슈에 여러 기사를 묶어 하나의 깊은 분석으로 만들 것(단신 나열 금지).
- 운임·관세·항만·니어쇼어링 등 물류적으로 중요한 주제 우선. 중요도 낮은 기사는 버려도 됨.
- 이슈 제목은 명사형, 구체적으로.
반드시 JSON만: {"issues":[{"title":"이슈 제목","articles":[0,3,5]}, ...]}

기사 목록:
${list}` }];
}

function analysisMessages(issue, arts, label) {
  const src = arts.map((a, i) => `[${i}] 제목:${a.title}\n리드:${(a.summary || '').slice(0, 200)}\n본문:${(a.content || '').slice(0, 1200)}\n출처:${a.source || ''} ${a.url || ''}`).join('\n\n');
  return [{ role: 'user', content: `당신은 ${label} 권역 물류 주간 분석 브리프의 편집장이다. 아래 한 이슈에 관한 원문 기사들을 근거로 KMI 국제물류위클리 수준의 심층 분석을 작성하라.
원칙:
- 보고된 사실·수치만 사용. 원문에 없는 내용을 지어내지 말 것(환각 금지).
- 한국은 기사가 실제로 한국(한국 기업·한국 교역·한국발/향 화물)과 연관될 때만 언급. 연관 없으면 한국을 아예 쓰지 말 것.
- 단순 요약이 아니라 분석: 현황 → 원인 → 영향 → 전망의 논리로 전개.
- 숫자·단위·국가는 한글(달러·억·미국). 어려운 한자 약물 금지.
- 문체: ~입니다/~합니다 금지. ~함·~됨·~로 나타남·~전망됨 보고체.

반드시 JSON만:
{
 "lead":"이 이슈의 핵심 명제 1~2문장",
 "paragraphs":["분석 단락 3~4개. 각 단락 2~4문장. 현황→원인→영향 순"],
 "bullets":["핵심 근거 3~5개. 가능하면 수치 포함. 한 줄씩"],
 "outlook":"전망 2~3문장",
 "implications":[{"actor":"화주 또는 포워더 또는 항만·선사 등","point":"해당 주체에 대한 시사점 1문장"}],
 "sources":[{"title":"기사 제목","source":"매체명","url":"URL"}]
}

이슈: ${issue.title}

원문 기사:
${src}` }];
}

function summaryMessages(issues, label) {
  const list = issues.map((s, i) => `${i + 1}. ${s.title} — ${s.lead}`).join('\n');
  return [{ role: 'user', content: `아래는 이번 주 ${label} 권역 핵심 이슈 분석이다. 이를 종합한 주간 총평을 작성하라.
- 2~3개 단락, 단락 사이는 빈 줄(\\n\\n)로 구분. 각 단락 2~3문장.
- 첫 단락=이번 주를 관통하는 핵심 흐름, 다음 단락(들)=그 의미·파급·전망.
- 한국은 실제 연관될 때만 언급하고, 한국 결론을 억지로 붙이지 말 것(연관 없으면 미언급).
- ~함·~됨·~전망됨 보고체. 숫자·국가는 한글.
반드시 JSON만: {"summary":"단락1\\n\\n단락2"}

이슈:
${list}` }];
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE 환경변수 없음');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false }, realtime: { enabled: false } });

  const cfgs = {};
  for (const r of REGIONS) cfgs[r] = require('./config/regions/' + r + '.js');

  const now = new Date();
  const week = arg('week') || isoWeekId(now);
  const period = weekPeriod(now);
  const region = arg('region') || 'americas';
  const cfg = cfgs[region];
  const sinceISO = new Date(now.getTime() - 7 * 86400000).toISOString();

  // 풀 → 권역 배정
  const pool = []; const seen = new Set();
  for (const cat of CATS) {
    const { data, error } = await sb.from('maritime_news')
      .select('title,summary,content,image_url,source,url,category,agent_type,published_at')
      .eq('category', cat).gte('published_at', sinceISO)
      .order('published_at', { ascending: false }).limit(80);
    if (error) throw new Error(error.message);
    for (const r of (data || [])) {
      if ((r.content || '').length <= 200) continue;
      const key = r.url || r.title; if (seen.has(key)) continue;
      seen.add(key); pool.push(r);
    }
  }
  const buckets = assignPool(pool, cfgs, { dominanceMargin: 1 });
  const arts = (buckets[region] || []).slice(0, POOL_PER_REGION);
  console.log(`풀 ${pool.length} → [${region}] ${arts.length}건`);
  if (!arts.length) throw new Error(`${region} 기사 0건`);

  // 1) 이슈 클러스터링
  const cl = await callDeepSeekJson({ messages: clusterMessages(arts, cfg.label), max_tokens: 1200 });
  const rawIssues = (cl && cl.issues || []).slice(0, MAX_ISSUES);
  console.log(`이슈 ${rawIssues.length}개:`, rawIssues.map((x) => x.title));

  // 2) 이슈별 심층 분석
  const issues = [];
  for (const it of rawIssues) {
    const idxs = (it.articles || []).filter((i) => arts[i]).slice(0, MAX_ARTS_PER_ISSUE);
    const srcArts = idxs.map((i) => arts[i]);
    if (!srcArts.length) continue;
    const an = await callDeepSeekJson({ messages: analysisMessages(it, srcArts, cfg.label), max_tokens: 3000 });
    if (!an || !an.lead) { console.warn(`  이슈 분석 실패: ${it.title}`); continue; }
    issues.push({
      title: it.title,
      lead: an.lead || '',
      paragraphs: Array.isArray(an.paragraphs) ? an.paragraphs.filter(Boolean) : [],
      bullets: Array.isArray(an.bullets) ? an.bullets.filter(Boolean) : [],
      outlook: an.outlook || '',
      implications: Array.isArray(an.implications) ? an.implications.filter((x) => x && x.point) : [],
      sources: Array.isArray(an.sources) ? an.sources.filter((x) => x && (x.url || x.title)) : [],
    });
    console.log(`  ✅ ${it.title} (단락 ${issues[issues.length - 1].paragraphs.length}, 불릿 ${issues[issues.length - 1].bullets.length})`);
  }
  if (!issues.length) throw new Error('이슈 분석 0건');

  // 3) 종합
  const sm = await callDeepSeekJson({ messages: summaryMessages(issues, cfg.label), max_tokens: 800 });

  // 4) 지표(차트/표)
  const indices = await buildIndices(sb, region);

  const meta = require('./config/region-meta')[region] || {};
  const out = {
    region, label: cfg.label, week, period,
    generated_at: now.toISOString().slice(0, 10),
    regionEn: meta.en || region.toUpperCase(),
    coverTitle: (meta.coverTitle || cfg.label + ' 권역') + ' 분석',
    summary: (sm && sm.summary) || '',
    indices, issues,
  };
  const dir = path.join(__dirname, 'content/weekly-region-deep');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${week}-${region}.json`), JSON.stringify(out, null, 2), 'utf-8');
  console.log(`\n✅ [${region}] deep-feed: 이슈 ${issues.length}, 지표 ${indices ? indices.table.length + '행' : '없음'} → content/weekly-region-deep/${week}-${region}.json`);
}

if (require.main === module) {
  main().catch((e) => { console.error('deep-feed 실패:', e.message); process.exit(1); });
}
module.exports = { buildIndices, REGION_INDICES };
