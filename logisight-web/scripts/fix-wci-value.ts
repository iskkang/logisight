import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import ws from 'ws';
(globalThis as any).WebSocket = ws;

// scripts/fix-wci-value.ts
// DB에 잘못 저장된 WCI 값(20241 등 범위 초과)을 삭제하고
// 알려진 정확한 값으로 교체한다.
//
// 실행: npx tsx scripts/fix-wci-value.ts

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { enabled: false } as never,
});

async function main() {
  // 1. 범위 초과 WCI 행 조회
  const { data: badRows } = await supabase
    .from('freight_indices')
    .select('id, index_code, value, week_date')
    .eq('index_code', 'WCI');

  console.log('현재 DB의 WCI 행:');
  for (const r of badRows ?? []) {
    const flag = Number(r.value) > 10000 ? ' ← 잘못된 값' : ' ← OK';
    console.log(`  id=${r.id}  value=${r.value}  week_date=${r.week_date}${flag}`);
  }

  // 2. 잘못된 값 삭제 (>10000)
  const badIds = (badRows ?? []).filter(r => Number(r.value) > 10000).map(r => r.id);
  if (badIds.length > 0) {
    const { error } = await supabase.from('freight_indices').delete().in('id', badIds);
    if (error) { console.error('삭제 실패:', error.message); process.exit(1); }
    console.log(`\n✅ 잘못된 WCI 행 ${badIds.length}개 삭제 완료`);
  } else {
    console.log('\n⚡ 범위 초과 WCI 행 없음 — 삭제 스킵');
  }

  // 3. 정확한 WCI Composite 삽입 (Drewry 2026-05-21 기준)
  //    사용자 제공값: Composite 2,711.77
  //    week_date: 해당 주 월요일 (2026-05-19)
  const correctRow = {
    index_code: 'WCI',
    value:      2711.77,
    week_date:  '2026-05-19',  // 2026-05-21 주의 월요일
    change_pct: null,
    source:     'Drewry WCI',
    source_url: 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry',
  };

  const { error: upsertErr } = await supabase
    .from('freight_indices')
    .upsert(correctRow, { onConflict: 'index_code,week_date' });

  if (upsertErr) {
    console.error('upsert 실패:', upsertErr.message);
    process.exit(1);
  }
  console.log(`✅ WCI ${correctRow.value} (week ${correctRow.week_date}) upsert 완료`);
}

main().catch(e => { console.error(e); process.exit(1); });
