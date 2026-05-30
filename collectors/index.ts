// collectors/index.ts
// ë§ˆìŠ¤í„° dispatcher â€” ëª¨ë“  collector ìˆœì°¨/ë³‘ë ¬ ì‹¤í–‰
// ì‚¬ìš©ë²•: npx tsx index.ts [all|shipping|news|rail|policy]

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { collect as collectShipping }    from './shipping_indices';
import { collect as collectBunker }      from './bunker';
import { collect as collectAir }         from './air_indices';
import { collect as collectBlankSailing } from './blank_sailing';
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

const GROUPS = [
  {
    name: 'ìš´ìž„ ì§€ìˆ˜',
    collectors: [
      { name: 'shipping_indices', fn: collectShipping },
      { name: 'bunker',           fn: collectBunker },
      { name: 'air_indices',      fn: collectAir },
      { name: 'blank_sailing',    fn: collectBlankSailing },
    ],
  },
  {
    name: 'ë‰´ìŠ¤',
    collectors: [
      { name: 'news_global',   fn: collectNewsGlobal },
      { name: 'news_korea',    fn: collectNewsKorea },
      { name: 'news_rail',     fn: collectNewsRail },
      { name: 'news_industry', fn: collectNewsIndustry },
    ],
  },
  {
    name: 'ì² ë„',
    collectors: [
      { name: 'rail_tcr', fn: collectRailTCR },
      { name: 'rail_tsr', fn: collectRailTSR },
    ],
  },
  {
    name: 'ì •ì±…',
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
      { name: 'news_rail',       fn: collectNewsRail },                         // weeklyë„ ìµœì‹  ê¸°ì‚¬ í¬í•¨
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
];

const GROUP_MAP: Record<string, string> = {
  shipping:      'ìš´ìž„ ì§€ìˆ˜',
  news:          'ë‰´ìŠ¤',
  rail:          'ì² ë„',
  policy:        'ì •ì±…',
  'rail-daily':  'rail-daily',
  'rail-weekly': 'rail-weekly',
  'ocean-daily': 'ocean-daily',
  'ocean-weekly':'ocean-weekly',
};

async function runCollector(name: string, fn: () => Promise<CollectorResult>) {
  console.log(`\nðŸ”„ ${name} ìˆ˜ì§‘ ì‹œìž‘...`);
  try {
    const result = await fn();
    const total   = result.data.length;
    const success = result.data.filter(d => d.is_complete).length;
    const failed  = total - success;
    await snapshotWriter(result);
    console.log(`âœ… ${name} ì™„ë£Œ: ${success}ê±´ ì„±ê³µ / ${failed}ê±´ ì‹¤íŒ¨`);
    return { name, success: true, total, failed };
  } catch (error) {
    console.error(`âŒ ${name} ì „ì²´ ì‹¤íŒ¨:`, (error as Error).message);
    return { name, success: false, total: 0, failed: 1 };
  }
}

async function main() {
  const groupArg   = process.argv[2];
  const targetName = groupArg ? GROUP_MAP[groupArg] : undefined;

  if (groupArg && !targetName) {
    console.error(`âŒ ì•Œ ìˆ˜ ì—†ëŠ” ê·¸ë£¹: "${groupArg}". ê°€ëŠ¥í•œ ê°’: ${Object.keys(GROUP_MAP).join(', ')}, all`);
    process.exit(1);
  }

  const activeGroups = targetName ? GROUPS.filter(g => g.name === targetName) : GROUPS;

  const startTime = Date.now();
  console.log(`ðŸš€ Logisight ë°ì´í„° ìˆ˜ì§‘ ì‹œìž‘ (group: ${groupArg ?? 'all'})\n`);
  console.log(`ðŸ“… ìˆ˜ì§‘ ì‹œê°: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST`);

  const summary: Array<{ name: string; success: boolean; total: number; failed: number }> = [];

  for (const group of activeGroups) {
    console.log(`\nâ”â”â” ${group.name} ê·¸ë£¹ â”â”â”`);
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

  console.log('\nâ”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”');
  console.log(`ðŸ“Š ìˆ˜ì§‘ ì™„ë£Œ ìš”ì•½`);
  console.log(`   ì„±ê³µ: ${totalSuccess}ê°œ collector`);
  console.log(`   ì‹¤íŒ¨: ${totalFailed}ê°œ collector`);
  console.log(`   ì†Œìš” ì‹œê°„: ${elapsed}ì´ˆ`);
  console.log('â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n');

  if (totalFailed > 0) {
    console.log('âš ï¸ ì‹¤íŒ¨í•œ collector:');
    summary.filter(s => !s.success).forEach(s => console.log(`  - ${s.name}`));
  }

  // ì „ì²´ collectorê°€ ëª¨ë‘ ì‹¤íŒ¨í•œ ê²½ìš°ì—ë§Œ exit(1)
  // ì¼ë¶€ ì‹¤íŒ¨ëŠ” í—ˆìš© (HTTP 403, ì‚¬ì´íŠ¸ ì°¨ë‹¨ ë“± ì™¸ë¶€ ìš”ì¸ ì •ìƒ)
  if (totalSuccess === 0) {
    console.error('âŒ ëª¨ë“  collector ì‹¤íŒ¨ â€” exit(1)');
    process.exit(1);
  }
}

main();
