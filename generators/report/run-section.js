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
const { resolveMonth, monthEndISO, prevMonthOf } = require('./lib/report-month');
const { loadAllMonthlyItems, loadIndexFactsheet, buildIndexTable } = require('./lib/index-factsheet');
const { loadMaritimeNewsItems, dedupeByUrl, rankAndCap } = require('./lib/maritime-news-feed');
const { buildOceanIndices }   = require('./lib/ocean-indices');
const { buildAirIndices }     = require('./lib/air-indices');
const { buildRailIndices }    = require('./lib/rail-indices');
const { buildPortThroughput } = require('./lib/port-throughput');
const { buildPortCongestion } = require('./lib/port-congestion'); // ①
const { buildKitaSeaReport, buildKitaAirReport } = require('./lib/kita-report');
const { buildDerivedMetrics, loadKitaLanes } = require('./lib/derived-metrics-loader');
const { loadStyleGuide }      = require('./lib/style');
const { runSection, saveSectionFile, parseFrontmatter } = require('./lib/section-runner');
const { extractDigest, buildPriorDigestBlock, buildSynthesisBlock } = require('./lib/section-digest');

// 총론(index)용 — 디스크의 타 섹션 파일에서 다이제스트 수집(--all이면 방금 생성분, 단독 실행이면 기존분)
function collectSectionDigests(outDir) {
  const digests = [];
  for (const s of SECTIONS) {
    if (s.id === 'index') continue;
    const p = path.join(outDir, `${s.id}.md`);
    if (fs.existsSync(p)) digests.push(extractDigest(fs.readFileSync(p, 'utf-8'), s.title));
  }
  return digests;
}

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MONTH   = resolveMonth(process.argv.slice(2), new Date());   // 라벨(발행) 월 — 디렉터리·파일명
const WEEK_END = monthEndISO(prevMonthOf(MONTH));   // 데이터 상한 = 직전월 말일(발행월 데이터 배제)
const DEFAULT_MONTHLY_ITEM_CAP = 40;   // ocean/air/rail 등 maxItems 미지정 섹션 상한
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

  // 총론(index)은 마지막에 생성 — 앞서 생성된 전 섹션 다이제스트를 종합 입력으로 받음.
  // 문서 순서는 assemble이 SECTIONS 순서로 병합하므로 불변.
  const targets = runAll
    ? [...SECTIONS.filter(s => s.id !== 'index'), ...SECTIONS.filter(s => s.id === 'index')]
    : SECTIONS.filter(s => s.id === sectionId);

  if (targets.length === 0) {
    console.error(`알 수 없는 섹션 ID: "${sectionId}"`);
    console.error('사용 가능:', SECTIONS.map(s => s.id).join(' | '));
    process.exit(1);
  }

  const fileItems  = loadAllMonthlyItems({ monthEnd: WEEK_END });
  const extraItems = await loadMaritimeNewsItems({ monthEnd: WEEK_END });
  const allItems   = dedupeByUrl([...fileItems, ...extraItems]);
  console.log(`📰 아이템 풀: 파일 ${fileItems.length} + maritime ${extraItems.length} → dedup ${allItems.length}`);
  const styleGuide = loadStyleGuide();
  const client     = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const indexRows  = await loadIndexFactsheet({ weekEnd: WEEK_END });
  const { table: indexTable, factText: indexFactText } = buildIndexTable(indexRows);

  console.log(`\n📋 monthly items: ${allItems.length}건 | 대상 섹션: ${targets.map(s => s.id).join(', ')}`);
  console.log(`📁 출력 디렉터리: ${OUT_DIR}\n`);

  let generated = 0;
  let skipped   = 0;
  const priorDigests = [];   // 크로스섹션 dedup — 앞 섹션 핵심 주제 누적

  for (const sec of targets) {
    const outPath = path.join(OUT_DIR, `${sec.id}.md`);

    // approved 섹션은 --force 없이 스킵 (스킵해도 dedup 다이제스트에는 포함)
    if (!force && fs.existsSync(outPath)) {
      const existing = fs.readFileSync(outPath, 'utf-8');
      const { meta } = parseFrontmatter(existing);
      if (meta.status === 'approved') {
        console.log(`⏭️  [${sec.id}] status: approved — 스킵 (--force 로 재생성 가능)`);
        priorDigests.push(extractDigest(existing, sec.title));
        skipped++;
        continue;
      }
    }

    const items = rankAndCap(sec.filterItems(allItems), sec.maxItems ?? DEFAULT_MONTHLY_ITEM_CAP);
    console.log(`▶ [${sec.id}] ${sec.title} — 관련 기사 ${items.length}건`);

    // ── ocean per-index 지수 블록 + KITA 부산발 참고운임 ──
    let oceanBlocks = null, oceanFactText = null, kitaSeaBundle = null;
    if (sec.id === 'ocean') {
      const built  = await buildOceanIndices({ weekEnd: WEEK_END });
      oceanBlocks  = built.blocks;
      oceanFactText = built.factText;
      console.log(`▶ [ocean] per-index 지수 블록 ${oceanBlocks.length}개 로드`);
      kitaSeaBundle = buildKitaSeaReport();
      if (kitaSeaBundle) console.log(`▶ [ocean] KITA 해상 참고운임 로드 (기준 ${kitaSeaBundle.asOf})`);
      else               console.warn('⚠️  [ocean] KITA 해상 운임 미수집 — notice 표시');

      // ── 파생 지표(한중발 스프레드·계약-스팟 갭·KITA 공시-실측 갭) — oceanFactText 뒤에 합류 ──
      const derived = await buildDerivedMetrics({ weekEnd: WEEK_END, kitaSea: loadKitaLanes() });
      const derivedTexts = [derived.spreadBlock, derived.gapBlock, derived.kitaGapBlock]
        .filter(Boolean).map(b => b.factText);
      if (derivedTexts.length) oceanFactText = [oceanFactText, ...derivedTexts].join('\n\n');
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

      // ── 혼잡-운임 교차 신호(파생) — portThroughputFactText 뒤에 합류 ──
      const derived = await buildDerivedMetrics({ weekEnd: WEEK_END, congestion: pcData });
      if (derived.congestionSignalText) {
        portThroughputFactText = portThroughputFactText
          ? `${portThroughputFactText}\n\n${derived.congestionSignalText}`
          : derived.congestionSignalText;
      }
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
      priorDigest: sec.id === 'index'
        ? buildSynthesisBlock(collectSectionDigests(OUT_DIR))   // 총론 = 전 섹션 종합
        : buildPriorDigestBlock(priorDigests),                  // 그 외 = 중복 금지
    });
    const saved   = saveSectionFile(OUT_DIR, sec.id, MONTH, result.status, result.text, {
      pass1_tokens: result.pass1Tokens,
      pass2_tokens: result.pass2Tokens,
      items_count:  items.length,
    });
    console.log(`✅ [${sec.id}] 저장: ${saved}\n`);
    priorDigests.push(extractDigest(result.text, sec.title));   // 다음 섹션 dedup용 누적
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
