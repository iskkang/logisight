// scripts/backfill-categories.ts
// maritime_news에서 category IS NULL인 행에 키워드 기반 카테고리를 채운다.
// 실행: npx tsx scripts/backfill-categories.ts
//
// 환경변수 필요 (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 또는 NEXT_PUBLIC_* 사용)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, KEY);

const RULES: Array<{ pattern: RegExp; category: string }> = [
  {
    pattern: /선박|해운|컨테이너|운임|선사|TEU|항로|해상|선적|물동량|얼라이언스|블랭크세일링/i,
    category: '해상',
  },
  {
    pattern: /항공|화물기|공항|air cargo|flight|AWB|에어카고|항공화물/i,
    category: '항공',
  },
  {
    pattern: /철도|TCR|TSR|열차|rail|train|유라시아|코리도|CIM|카시|알마티|하르가스|중앙아시아/i,
    category: '철도',
  },
  {
    pattern: /포워더|물류|창고|3PL|공급망|SCM|로지스틱|logistics|freight forwarder/i,
    category: '물류',
  },
  {
    pattern: /관세|수출|수입|FTA|무역|통관|HS코드|HS코드|CBAM|ETS|제재|sanctions|tariff|관세율/i,
    category: '무역',
  },
];

function classify(title: string, summary: string | null): string | null {
  const text = `${title} ${summary ?? ''}`;
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return null;
}

async function main() {
  const { data: rows, error } = await supabase
    .from('maritime_news')
    .select('id, title, summary')
    .is('category', null);

  if (error) {
    console.error('조회 실패:', error.message);
    process.exit(1);
  }

  if (!rows?.length) {
    console.log('백필 대상 행 없음 (category IS NOT NULL)');
    return;
  }

  console.log(`대상 ${rows.length}건 처리 시작...`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const category = classify(row.title, row.summary);
    if (!category) {
      skipped++;
      continue;
    }

    const { error: err } = await supabase
      .from('maritime_news')
      .update({ category, agent_type: 'brief' })
      .eq('id', row.id);

    if (err) {
      console.error(`업데이트 실패 (${row.id}):`, err.message);
    } else {
      updated++;
    }
  }

  console.log(`완료: ${updated}건 업데이트, ${skipped}건 스킵 (키워드 미매칭)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
