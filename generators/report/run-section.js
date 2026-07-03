'use strict';
// generators/report/run-section.js
// 월간 리포트 섹션별 2패스 생성기 CLI
// 사용법:
//   node run-section.js ocean           # 단일 섹션
//   node run-section.js --all           # 전체 6섹션 (01~06; 07 규제·정책 삭제)
//   node run-section.js --all --force   # 이미 approved 섹션 포함 강제 재생성

const path = require('path');
const fs   = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const Anthropic = require('@anthropic-ai/sdk');
const SECTIONS  = require('./sections.config');
const { resolveMonth, monthEndISO } = require('./lib/report-month');
const { loadAllMonthlyItems, loadIndexFactsheet, buildIndexTable } = require('./lib/index-factsheet');
const { buildOceanIndices }   = require('./lib/ocean-indices');
const { buildAirIndices }     = require('./lib/air-indices');
const { buildRailIndices }    = require('./lib/rail-indices');
const { buildPortThroughput } = require('./lib/port-throughput');
const { buildPortCongestion } = require('./lib/port-congestion'); // ①
const { buildKitaSeaReport, buildKitaAirReport } = require('./lib/kita-report');
const { loadStyleGuide }      = require('./lib/style');
const { runSection, saveSectionFile, parseFrontmatter } = require('./lib/section-runner');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TODAY   = new Date().toISOString().slice(0, 10);
const MONTH   = resolveMonth(process.argv.slice(2), new Date());
const OUT_DIR = path.resolve(__dirname, `../../content/monthly-report/${MONTH}`);

if (!ANTHROPIC_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY is not set.');
  process.exit(1);
}

async function main() {
  const args      = process.argv.slice(2);
  const runAll    = args.includes('--all');
  const force     = args.includes('--force');
  const sectionId = args.find(a => !a.startsWith('--'));

  if (!runAll && !sectionId) {
    console.error('사용법: node run-section.js <section-id>  OR  node run-section.js --all');
    console.error('섹션 ID:', SECTIONS.map(s => s.id).join(' | '));
    process.exit(1);
  }

  const targets = runAll
    ? SECTIONS
    : SECTIONS.filter(s => s.id === sectionId);

  if (targets.length === 0) {
    console.error(`알 수 없는 섹션 ID: "${sectionId}"`);
    console.error('사용 가능:', SECTIONS.map(s => s.id).join(' | '));
    process.exit(1);
  }

  const allItems   = loadAllMonthlyItems();
  const styleGuide = loadStyleGuide();
  const client     = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const indexRows  = await loadIndexFactsheet();
  const { table: indexTable, factText: indexFactText } = buildIndexTable(indexRows);

  console.log(`\n📋 monthly items: ${allItems.length}건 | 대상 섹션: ${targets.map(s => s.id).join(', ')}`);
  console.log(`📁 출력 디렉터리: ${OUT_DIR}\n`);

  let generated = 0;
  let skipped   = 0;

  for (const sec of targets) {
    const outPath = path.join(OUT_DIR, `${sec.id}.md`);

    // approved 섹션은 --force 없이 스킵
    if (!force && fs.existsSync(outPath)) {
      const { meta } = parseFrontmatter(fs.readFileSync(outPath, 'utf-8'));
      if (meta.status === 'approved') {
        console.log(`⏭️  [${sec.id}] status: approved — 스킵 (--force 로 재생성 가능)`);
        skipped++;
        continue;
      }
    }

    const items = sec.filterItems(allItems);
    console.log(`▶ [${sec.id}] ${sec.title} — 관련 기사 ${items.length}건`);

    // ── ocean per-index 지수 블록 + KITA 부산발 참고운임 ──
    let oceanBlocks = null, oceanFactText = null, kitaSeaBundle = null;
    if (sec.id === 'ocean') {
      const built  = await buildOceanIndices();
      oceanBlocks  = built.blocks;
      oceanFactText = built.factText;
      console.log(`▶ [ocean] per-index 지수 블록 ${oceanBlocks.length}개 로드`);
      kitaSeaBundle = buildKitaSeaReport();
      if (kitaSeaBundle) console.log(`▶ [ocean] KITA 해상 참고운임 로드 (기준 ${kitaSeaBundle.asOf})`);
      else               console.warn('⚠️  [ocean] KITA 해상 운임 미수집 — notice 표시');
    }

    // ── air: IATA·KITA·TAC/BAI·Superset 수집 ──
    let airBundle = null, airTable = null, airFactText = null, kitaAirBundle = null;
    if (sec.id === 'air') {
      console.log('▶ [air] 항공 데이터 수집 (IATA·KITA·TAC/BAI·Superset)...');
      airBundle = await buildAirIndices();
      if (airBundle) {
        airTable    = airBundle.table;
        airFactText = airBundle.factText;
      } else {
        console.warn('⚠️  [air] 항공 데이터 미수집 — notice 표시');
      }
      kitaAirBundle = buildKitaAirReport();
      if (kitaAirBundle) console.log(`▶ [air] KITA 항공 참고운임 로드 (기준 ${kitaAirBundle.asOf})`);
      else               console.warn('⚠️  [air] KITA 항공 운임 미수집 — notice 표시');
    }

    // ── macro: Container Port Throughput + Port Congestion 수집 ──
    let portThroughputTable = null, portThroughputFactText = null, portCongestionTable = null;
    if (sec.id === 'macro') {
      console.log('▶ [macro] Port Throughput 데이터 수집...');
      const ptData = await buildPortThroughput();
      if (ptData) { portThroughputTable = ptData.table; portThroughputFactText = ptData.factText; }
      else console.warn('⚠️  [macro] Port Throughput 미수집 — ⚠️ notice 표시');

      const pcData = await buildPortCongestion();
      if (pcData) { portCongestionTable = pcData.table; }   // ① 항만 혼잡도
      else console.warn('⚠️  [macro] 항만 혼잡도 미수집');
    }

    // ── rail: Landbridge 중국 철도·中欧班列 정량 데이터 수집 ──
    let railTable = null, railFactText = null;
    if (sec.id === 'rail') {
      console.log('▶ [rail] Landbridge 데이터 수집...');
      const railData = await buildRailIndices({ month: MONTH });
      if (railData) { railTable = railData.table || null; railFactText = railData.factText; }
      else console.warn('⚠️  [rail] Landbridge 미수집 — factText 없음');
    }

    const result  = await runSection({
      client, sectionConfig: sec, items, styleGuide, month: MONTH,
      indexTable:    sec.id === 'index' ? indexTable    : null,
      indexFactText: sec.id === 'ocean' ? oceanFactText
                   : sec.id === 'index' ? indexFactText : null,
      railTable, railFactText, oceanBlocks,
      airBundle,
      airTable, airFactText,
      portThroughputTable, portThroughputFactText, portCongestionTable,
      kitaSeaBundle, kitaAirBundle,
    });
    const saved   = saveSectionFile(OUT_DIR, sec.id, MONTH, result.status, result.text, {
      pass1_tokens: result.pass1Tokens,
      pass2_tokens: result.pass2Tokens,
      items_count:  items.length,
    });
    console.log(`✅ [${sec.id}] 저장: ${saved}\n`);
    generated++;
  }

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`완료: ${generated}개 생성, ${skipped}개 스킵`);
  if (generated > 0) {
    console.log(`\n다음 단계:`);
    console.log(`  1. 각 섹션 파일에서 status: draft → status: approved 로 변경`);
    console.log(`     ${OUT_DIR}/`);
    console.log(`  2. 병합: node generators/report/assemble-monthly-report.js`);
  }
}

main().catch(err => {
  console.error('❌ run-section.js 실패:', err.message);
  process.exit(1);
});
