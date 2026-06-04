// collectors/index.ts
// 마스터 dispatcher — 모든 collector 순차/병렬 실행
// 사용법: npx tsx index.ts [all|shipping|news|rail|policy]

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { collect as collectShipping }    from './shipping_indices';
import { collect as collectBunker }      from './bunker';
import { collect as collectAir }         from './air_indices';
import { collect as collectNewsGlobal }  from './news_global';
import { collect as collectNewsKorea }   from './news_korea';
import { collect as collectNewsRail }    from './news_rail';
import { collect as collectNewsIndustry } from './news_industry';
import { collect as collectPolicyUS }    from './policy_us';
import { collect as collectPolicyEU }    from './policy_eu';
import { collect as collectPolicyIMO }   from './policy_imo';
import { collect as collectRailTCR }     from './rail_tcr';
import { collect as collectRailTSR }     from './rail_tsr';
import { snapshotWriter }                from './utils/snapshot_writer';
import type { CollectorResult }          from './types';
import { collect as collectRailCN }            from './rail_cn';
import { collect as collectRailOps }           from './rail_ops';
import { collect as collectCarrierAdvisories } from './carrier_advisories';
import { collect as collectOceanNews }         from './ocean_news';
import { collect as collectChokepoints }       from './chokepoints';
import { collect as collectPortStats }         from './port_stats';
import { collect as collectMonthlyAnalysis }   from './monthly_analysis';
import { collect as collectFreightIndexExcel } from './freight_index_excel';
import { collect as collectNewsLogistics }     from './news_logistics';

const GROUPS = [
  {
    name: '운임 지수',
    collectors: [
      { name: 'shipping_indices', fn: collectShipping },
      { name: 'bunker',           fn: collectBunker },
      { name: 'air_indices',      fn: collectAir },
    ],
  },
  {
    name: '뉴스',
    collectors: [
      { name: 'news_global',   fn: collectNewsGlobal },
      { name: 'news_korea',    fn: collectNewsKorea },
      { name: 'news_rail',     fn: collectNewsRail },
      { name: 'news_industry', fn: collectNewsIndustry },
    ],
  },
  {
    name: '철도',
    collectors: [
      { name: 'rail_tcr', fn: collectRailTCR },
      { name: 'rail_tsr', fn: collectRailTSR },
    ],
  },
  {
    name: '정책',
    collectors: [
      { name: 'policy_us',  fn: collectPolicyUS },
      { name: 'policy_eu',  fn: collectPolicyEU },
      { name: 'policy_imo', fn: collectPolicyIMO },
    ],
  },
  {
    name: 'rail-daily',
    collectors: [
      { name: 'news_rail',      fn: collectNewsRail },                          // RailFreight RSS + TransportCorridors
      { name: 'rail_cn_daily',  fn: () => collectRailCN({ frequency: 'daily' }) },
      { name: 'rail_ops_daily', fn: () => collectRailOps({ frequency: 'daily' }) },
    ],
  },
  {
    name: 'rail-weekly',
    collectors: [
      { name: 'news_rail',       fn: collectNewsRail },                         // weekly도 최신 기사 포함
      { name: 'rail_cn_weekly',  fn: () => collectRailCN({ frequency: 'weekly' }) },
      { name: 'rail_ops_weekly', fn: () => collectRailOps({ frequency: 'weekly' }) },
    ],
  },
  {
    name: 'ocean-daily',
    collectors: [
      { name: 'carrier_advisories',  fn: collectCarrierAdvisories },
      { name: 'ocean_news_daily',    fn: () => collectOceanNews({ frequency: 'daily' }) },
      { name: 'chokepoints_daily',   fn: () => collectChokepoints({ frequency: 'daily' }) },
      { name: 'news_global_ocean',   fn: () => collectNewsGlobal(['shipping']) },
    ],
  },
  {
    name: 'ocean-weekly',
    collectors: [
      { name: 'carrier_advisories',  fn: collectCarrierAdvisories },
      { name: 'ocean_news_weekly',   fn: () => collectOceanNews({ frequency: 'weekly' }) },
      { name: 'chokepoints_weekly',  fn: () => collectChokepoints({ frequency: 'weekly' }) },
      { name: 'port_stats',          fn: collectPortStats },
    ],
  },
  {
    name: 'air-daily',
    collectors: [
      { name: 'news_global_air', fn: () => collectNewsGlobal(['air']) },
    ],
  },
  {
    name: 'policy-daily',
    collectors: [
      { name: 'news_global_trade', fn: () => collectNewsGlobal(['trade']) },
      { name: 'news_industry_trade', fn: collectNewsIndustry },
    ],
  },
  {
    name: 'logistics-daily',
    collectors: [
      { name: 'news_logistics', fn: collectNewsLogistics },
    ],
  },
  {
    name: 'monthly-analysis',
    collectors: [
      { name: 'monthly_analysis',     fn: collectMonthlyAnalysis },
      { name: 'freight_index_excel',  fn: collectFreightIndexExcel },
    ],
  },
];

const GROUP_MAP: Record<string, string> = {
  shipping:      '운임 지수',
  news:          '뉴스',
  rail:          '철도',
  policy:        '정책',
  'rail-daily':  'rail-daily',
  'rail-weekly': 'rail-weekly',
  'ocean-daily': 'ocean-daily',
  'ocean-weekly':       'ocean-weekly',
  'air-daily':          'air-daily',
  'policy-daily':       'policy-daily',
  'logistics-daily':    'logistics-daily',
  'monthly-analysis':   'monthly-analysis',
};

async function runCollector(name: string, fn: () => Promise<CollectorResult>) {
  console.log(`\n🔄 ${name} 수집 시작...`);
  try {
    const result = await fn();
    const total   = result.data.length;
    const success = result.data.filter(d => d.is_complete).length;
    const failed  = total - success;
    await snapshotWriter(result);
    console.log(`✅ ${name} 완료: ${success}건 성공 / ${failed}건 실패`);
    return { name, success: true, total, failed };
  } catch (error) {
    console.error(`❌ ${name} 전체 실패:`, (error as Error).message);
    return { name, success: false, total: 0, failed: 1 };
  }
}

async function main() {
  const groupArg   = process.argv[2];
  const targetName = groupArg ? GROUP_MAP[groupArg] : undefined;

  if (groupArg && !targetName) {
    console.error(`❌ 알 수 없는 그룹: "${groupArg}". 가능한 값: ${Object.keys(GROUP_MAP).join(', ')}, all`);
    process.exit(1);
  }

  const activeGroups = targetName ? GROUPS.filter(g => g.name === targetName) : GROUPS;

  const startTime = Date.now();
  console.log(`🚀 Logisight 데이터 수집 시작 (group: ${groupArg ?? 'all'})\n`);
  console.log(`📅 수집 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST`);

  const summary: Array<{ name: string; success: boolean; total: number; failed: number }> = [];

  for (const group of activeGroups) {
    console.log(`\n━━━ ${group.name} 그룹 ━━━`);
    const results = await Promise.allSettled(
      group.collectors.map(c => runCollector(c.name, c.fn))
    );
    for (const r of results) {
      summary.push(
        r.status === 'fulfilled'
          ? r.value
          : { name: 'unknown', success: false, total: 0, failed: 1 }
      );
    }
  }

  const elapsed      = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalSuccess = summary.filter(s => s.success).length;
  const totalFailed  = summary.filter(s => !s.success).length;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 수집 완료 요약`);
  console.log(`   성공: ${totalSuccess}개 collector`);
  console.log(`   실패: ${totalFailed}개 collector`);
  console.log(`   소요 시간: ${elapsed}초`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (totalFailed > 0) {
    console.log('⚠️ 실패한 collector:');
    summary.filter(s => !s.success).forEach(s => console.log(`  - ${s.name}`));
  }

  // 전체 collector가 모두 실패한 경우에만 exit(1)
  // 일부 실패는 허용 (HTTP 403, 사이트 차단 등 외부 요인 정상)
  if (totalSuccess === 0) {
    console.error('❌ 모든 collector 실패 — exit(1)');
    process.exit(1);
  }
}

main();
