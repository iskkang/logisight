'use strict';
// 권역 위클리 feed 생산기: weekly-report 리치 풀(이미지+본문)을 권역에 단일 배정(assignPool) →
// 거시/지수/라운드업은 글로벌 제외, 권역은 "주체"인 기사만 → briefType 그룹 큐레이션 →
// rich JSON(items[] + selection)으로 content/weekly-region/<week>-<region>.json 저장. PDF는 weekly-region-pdf.js.
// weekly-report 파일 import/수정 없음(독립).
// 사용법: node weekly-region-feed.js [--week=2026-W26] [--region=europe(특정 권역만)]
const fs = require('fs');
const path = require('path');
const ws = require('ws'); globalThis.WebSocket = ws;
require('dotenv').config({ path: path.resolve(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');
const { callDeepSeekJson } = require('./generators/lib/deepseek');
const { SHARED_TYPE_RULES } = require('./lib/region-filter');
const { assignPool, REGIONS } = require('./lib/region-assign');
const { buildRegionSelectionMessages } = require('./generators/web/lib/weekly-briefing.lib');

const CATS = ['해상', '항공', '무역', '물류'];   // weekly-report 섹션 카테고리(overview 제외)
const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : null; };

function isoWeekId(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wn = Math.ceil(((t - ys) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wn).padStart(2, '0')}`;
}
function weekPeriod(d) {
  const t = new Date(d); const off = (t.getDay() + 6) % 7;   // 0=월
  const mon = new Date(t); mon.setDate(t.getDate() - off);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = (x) => `${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`;
  return `${f(mon)}~${f(sun)}`;
}
function toItem(a) {
  let body = String(a.content || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  body = body.replace(/\n?\*?\s*출처\s*[:：][^\n]*\*?\s*$/, '').trim();
  if (body.length > 900) body = body.slice(0, 900).replace(/\s+\S*$/, '') + '…';
  return {
    briefType: a.briefType, tag: a.category || '', headline: a.title || '',
    lead: a.summary || '', image: a.image_url || null, body, source: a.source || '', url: a.url || '',
  };
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL/SERVICE_ROLE_KEY 없음');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false }, realtime: { enabled: false } });

  const cfgs = {};
  for (const r of REGIONS) cfgs[r] = require('./config/regions/' + r + '.js');

  const now = new Date();
  const week = arg('week') || isoWeekId(now);
  const period = weekPeriod(now);
  const only = arg('region');
  const sinceISO = new Date(now.getTime() - 7 * 86400000).toISOString();

  // 리치 풀(weekly-report 풀: 카테고리별 이미지+본문>200+한글제목, 섹션 cap 없이 전량)
  const pool = []; const seen = new Set();
  for (const cat of CATS) {
    const { data, error } = await supabase.from('maritime_news')
      .select('title,summary,content,image_url,source,url,category,agent_type,published_at')
      .eq('category', cat).gte('published_at', sinceISO)
      .order('published_at', { ascending: false }).limit(60);
    if (error) throw new Error(error.message);
    for (const r of (data || [])) {
      if (!(r.image_url && (r.content || '').length > 200 && /[가-힣]/.test(r.title || ''))) continue;
      if (seen.has(r.title)) continue;
      seen.add(r.title); pool.push(r);
    }
  }

  // 단일 배정: 거시/지수/라운드업 → global, 권역은 주체 게이트
  const buckets = assignPool(pool, cfgs, { dominanceMargin: 1 });
  const counts = Object.fromEntries(REGIONS.map((r) => [r, buckets[r].length]));
  console.log(`풀 ${pool.length} → 배정`, counts, `| global(거시/제외) ${buckets.global.length}`);

  const dir = path.join(__dirname, 'content/weekly-region');
  fs.mkdirSync(dir, { recursive: true });

  for (const region of (only ? [only] : REGIONS)) {
    const arts = buckets[region] || [];
    if (!arts.length) {
      const stale = path.join(dir, `${week}-${region}.json`);
      if (fs.existsSync(stale)) { fs.unlinkSync(stale); console.log(`  [${region}] 0건 — stale feed 삭제: ${stale}`); }
      else console.log(`  [${region}] 0건 — feed/PDF 생략`);
      continue;
    }

    const cfg = cfgs[region];
    const byType = arts.reduce((m, a) => { m[a.briefType] = (m[a.briefType] || 0) + 1; return m; }, {});
    const focus = cfg.promptFocus + ' ' + SHARED_TYPE_RULES;
    const selection = await callDeepSeekJson({ messages: buildRegionSelectionMessages(arts, focus), max_tokens: 3000 });

    const out = {
      region, label: cfg.label, week, period,
      generated_at: now.toISOString().slice(0, 10),
      by_type: byType, selection, items: arts.map(toItem),
    };
    const outPath = path.join(dir, `${week}-${region}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8');
    console.log(`✅ [${region}] feed: ${outPath} (items ${arts.length}`, byType, ')');
  }
}

main().catch((e) => { console.error('feed 생성 실패:', e.message); process.exit(1); });
