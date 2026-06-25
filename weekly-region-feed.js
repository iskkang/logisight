'use strict';
// 권역 위클리 feed 생산기: weekly-report 리치 풀(이미지+본문)에 region-filter 재적용 → briefType 그룹 큐레이션
// → rich JSON(items[] + selection)으로 content/weekly-region/<week>-<region>.json 저장. PDF는 weekly-region-pdf.js.
// weekly-report 파일 import/수정 없음(독립).
// 사용법: node weekly-region-feed.js --region=europe [--week=2026-W26]
const fs = require('fs');
const path = require('path');
const ws = require('ws'); globalThis.WebSocket = ws;
require('dotenv').config({ path: path.resolve(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');
const { callDeepSeekJson } = require('./generators/lib/deepseek');
const { filterByRegion, SHARED_TYPE_RULES } = require('./lib/region-filter');
const { buildRegionSelectionMessages } = require('./generators/web/lib/weekly-briefing.lib');

const CATS = ['해상', '항공', '무역', '물류'];   // weekly-report 섹션 카테고리(overview 제외)
const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : null; };
const REGION = arg('region');

function isoWeekId(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);   // ISO: 목요일 기준
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
  if (!REGION) throw new Error('--region=<key> 필요 (europe/americas/russia/latam)');
  const cfg = require('./config/regions/' + REGION + '.js');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL/SERVICE_ROLE_KEY 없음');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false }, realtime: { enabled: false } });

  const now = new Date();
  const week = arg('week') || isoWeekId(now);
  const period = weekPeriod(now);
  const sinceISO = new Date(now.getTime() - 7 * 86400000).toISOString();

  // 리치 풀(weekly-report 풀: 카테고리별 이미지+본문>200+한글제목). 섹션 top-3 cap 없이 전량 → recall 확보.
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

  const curated = filterByRegion(pool, cfg, 14);
  const byType = curated.reduce((m, a) => { m[a.briefType] = (m[a.briefType] || 0) + 1; return m; }, {});
  console.log(`  [region=${REGION}/${cfg.label}] 리치풀 ${pool.length} → 통과 ${curated.length}`, byType);
  if (curated.length === 0) { console.warn(`⚠️ [region=${REGION}] 통과 0건 — feed 생략`); return; }

  const focus = cfg.promptFocus + ' ' + SHARED_TYPE_RULES;
  const selection = await callDeepSeekJson({ messages: buildRegionSelectionMessages(curated, focus), max_tokens: 3000 });

  const out = {
    region: REGION, label: cfg.label, week, period,
    generated_at: now.toISOString().slice(0, 10),
    by_type: byType, selection, items: curated.map(toItem),
  };
  const dir = path.join(__dirname, 'content/weekly-region');
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${week}-${REGION}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`✅ [region=${REGION}] feed: ${outPath} (items ${out.items.length})`);
}

main().catch((e) => { console.error('feed 생성 실패:', e.message); process.exit(1); });
