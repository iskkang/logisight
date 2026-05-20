// workers/collectors/index.ts
// 마스터 dispatcher — 모든 collector 순차/병렬 실행

import { collect as collectShipping } from './shipping_indices';
import { collect as collectBunker } from './bunker';
import { collect as collectAir } from './air_indices';
import { collect as collectBlankSailing } from './blank_sailing';
import { collect as collectNewsGlobal } from './news_global';
import { collect as collectNewsKorea } from './news_korea';
import { collect as collectNewsRail } from './news_rail';
import { collect as collectNewsIndustry } from './news_industry';
import { collect as collectPolicyUS } from './policy_us';
import { collect as collectPolicyEU } from './policy_eu';
import { collect as collectPolicyIMO } from './policy_imo';
import { collect as collectRailTCR } from './rail_tcr';
import { collect as collectRailTSR } from './rail_tsr';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult } from './types';

const GROUPS = [
  {
    name: '운임 지수',
    collectors: [
      { name: 'shipping_indices', fn: collectShipping },
      { name: 'bunker', fn: collectBunker },
      { name: 'air_indices', fn: collectAir },
      { name: 'blank_sailing', fn: collectBlankSailing },
    ],
  },
  {
    name: '뉴스',
    collectors: [
      { name: 'news_global', fn: collectNewsGlobal },
      { name: 'news_korea', fn: collectNewsKorea },
      { name: 'news_rail', fn: collectNewsRail },
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
      { name: 'policy_us', fn: collectPolicyUS },
      { name: 'policy_eu', fn: collectPolicyEU },
      { name: 'policy_imo', fn: collectPolicyIMO },
    ],
  },
];

async function runCollector(name: string, fn: () => Promise<CollectorResult>) {
  console.log(`\n🔄 ${name} 수집 시작...`);
  try {
    const result = await fn();
    const total = result.data.length;
    const success = result.data.filter(d => d.is_complete).length;
    const failed = total - success;

    await snapshotWriter(result);
    console.log(`✅ ${name} 완료: ${success}건 성공 / ${failed}건 실패`);
    return { name, success: true, total, failed };
  } catch (error) {
    console.error(`❌ ${name} 전체 실패:`, (error as Error).message);
    return { name, success: false, total: 0, failed: 1 };
  }
}

async function main() {
  const startTime = Date.now();
  console.log('🚀 Logisight 데이터 수집 시작\n');
  console.log(`📅 수집 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST`);

  const summary: Array<{ name: string; success: boolean; total: number; failed: number }> = [];

  // 그룹별 순차 실행 (각 그룹 내 병렬)
  for (const group of GROUPS) {
    console.log(`\n━━━ ${group.name} 그룹 ━━━`);

    const results = await Promise.allSettled(
      group.collectors.map(c => runCollector(c.name, c.fn))
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        summary.push(r.value);
      } else {
        summary.push({ name: 'unknown', success: false, total: 0, failed: 1 });
      }
    }
  }

  // 최종 요약
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalSuccess = summary.filter(s => s.success).length;
  const totalFailed = summary.filter(s => !s.success).length;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 수집 완료 요약`);
  console.log(`   성공: ${totalSuccess}개 collector`);
  console.log(`   실패: ${totalFailed}개 collector`);
  console.log(`   소요 시간: ${elapsed}초`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (totalFailed > 0) {
    console.log('⚠️ 실패한 collector:');
    summary.filter(s => !s.success).forEach(s => console.log(`  - ${s.name}`));
    process.exit(1); // GitHub Actions에서 실패 감지
  }
}

main();
