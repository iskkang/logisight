'use strict';
// generators/report/run-section.js
// 월간 리포트 섹션별 2패스 생성기 CLI
// 사용법:
//   node run-section.js ocean           # 단일 섹션
//   node run-section.js --all           # 전체 6섹션 (01~06; 07 규제·정책 삭제)
//   node run-section.js --all --force   # 이미 approved 섹션 포함 강제 재생성

const path = require('path');
const fs   = require('fs');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const Anthropic = require('@anthropic-ai/sdk');
const SECTIONS  = require('./sections.config');
const { resolveMonth, monthEndISO, prevMonthOf } = require('./lib/report-month');
const { loadAllMonthlyItems, loadIndexFactsheet, buildIndexTable } = require('./lib/index-factsheet');
const { loadMaritimeNewsItems, dedupeByUrl, rankAndCap } = require('./lib/maritime-news-feed');
const { buildOceanIndices, loadGroup } = require('./lib/ocean-indices');
const { buildAirIndices }     = require('./lib/air-indices');
const { buildRailIndices }    = require('./lib/rail-indices');
const { buildPortThroughput } = require('./lib/port-throughput');
const { buildPortCongestion } = require('./lib/port-congestion'); // ①
const { buildKitaSeaReport, buildKitaAirReport } = require('./lib/kita-report');
const { buildDerivedMetrics, loadKitaLanes } = require('./lib/derived-metrics-loader');
const { loadStyleGuide }      = require('./lib/style');
const { runSection, saveSectionFile, parseFrontmatter } = require('./lib/section-runner');
const { extractDigest, buildPriorDigestBlock, buildSynthesisBlock } = require('./lib/section-digest');
const { loadForecasts } = require('./lib/forecast-store');
const { judgeClaims, buildScorecardBlock } = require('./lib/forecast-scorecard');

// 총론(index)용 — 디스크의 타 섹션 파일에서 다이제스트 수집(--all이면 방금 생성분, 단독 실행이면 기존분)
function collectSectionDigests(outDir, excludeId = 'index') {
  const digests = [];
  for (const s of SECTIONS) {
    if (s.id === excludeId) continue;
    const p = path.join(outDir, `${s.id}.md`);
    if (fs.existsSync(p)) digests.push(extractDigest(fs.readFileSync(p, 'utf-8'), s.title));
  }
  return digests;
}

// 맺음말(07)용 — 파생 지표 전체 factText (해석 렌즈의 재료)
async function buildClosingDerivedBlock() {
  try {
    const d = await buildDerivedMetrics({ weekEnd: WEEK_END, kitaSea: loadKitaLanes() });
    const texts = [d.spreadBlock, d.gapBlock, d.kitaGapBlock, d.decouplingBlock, d.bunkerDivergenceBlock]
      .filter(Boolean).map(b => b.factText);
    return texts.length
      ? '## 파생 지표 (해석 렌즈 적용 대상 — 이 수치만 사용)\n\n' + texts.join('\n\n')
      : null;
  } catch (e) { console.warn('  closing 파생 로드 실패(무시):', e.message); return null; }
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
    ? [...SECTIONS.filter(s => s.id !== 'index' && s.id !== 'closing'),
       ...SECTIONS.filter(s => s.id === 'index'),
       ...SECTIONS.filter(s => s.id === 'closing')]   // 맺음말은 총론까지 본 뒤 최후 생성
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
  const failed  = [];   // 생성에 실패한 섹션 — 나머지는 계속 쓰고, 끝에서 종료코드로 남긴다
  const priorDigests = [];   // 크로스섹션 dedup — 앞 섹션 핵심 주제 누적

  for (const sec of targets) {
    const outPath = path.join(OUT_DIR, `${sec.id}.md`);

    // 이미 생성된 섹션은 건너뛴다 ★
    //
    // 예전에는 status === 'approved' 일 때만 건너뛰었다. 그런데 생성된 섹션은 전부
    // 'draft' 로 저장된다 —— approved 로 바꾸는 것은 사람이 검수한 뒤의 일이다.
    // 그래서 "진행분을 커밋해 두면 다음 실행이 남은 섹션만 쓴다"던 워크플로의 재개
    // 장치가 실제로는 한 번도 동작하지 않았다. 2026-10 생성이 macro 에서 죽었을 때
    // 재실행했더라도 멀쩡한 4개를 처음부터 다시 썼을 것이다.
    //
    // no-data 는 건너뛰지 않는다. 기사가 0건이라 빈 채로 끝난 섹션이므로, 풀이
    // 채워진 뒤 다시 시도해야 한다(2026-10 macro 가 정확히 그랬다).
    if (!force && fs.existsSync(outPath)) {
      const existing = fs.readFileSync(outPath, 'utf-8');
      const { meta } = parseFrontmatter(existing);
      if (meta.status === 'approved' || meta.status === 'draft') {
        console.log(`⏭️  [${sec.id}] 이미 생성됨 (status: ${meta.status}) — 스킵 (--force 로 재생성)`);
        priorDigests.push(extractDigest(existing, sec.title));
        skipped++;
        continue;
      }
    }

    try {
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
        const derivedTexts = [derived.spreadBlock, derived.gapBlock, derived.kitaGapBlock, derived.decouplingBlock, derived.bunkerDivergenceBlock]
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

      // ── index: 전월 전망(forecasts.json) 자동 판정 → 스코어카드를 synthesis 블록에 이어붙임 ──
      let priorDigest;
      if (sec.id === 'index') {
        const synthesis = buildSynthesisBlock(collectSectionDigests(OUT_DIR));   // 총론 = 전 섹션 종합
        let scorecardFactText = null;
        try {
          const prevMonth = prevMonthOf(MONTH);
          const claims = loadForecasts(prevMonth);
          if (claims && claims.length) {
            const seriesByMetric = await loadGroup(['SCFI', 'KCCI', 'CCFI', 'WCI', 'BDI'], WEEK_END);
            const judged  = judgeClaims(claims, seriesByMetric || {});
            const block   = buildScorecardBlock(judged, prevMonth);
            scorecardFactText = block ? block.factText : null;
            if (scorecardFactText) console.log(`▶ [index] 전월(${prevMonth}) 전망 스코어카드 주입 (${judged.length}건)`);
          }
        } catch (e) {
          console.warn('⚠️  [index] 전망 스코어카드 생성 실패(무시) —', e.message);
        }
        priorDigest = [synthesis, scorecardFactText].filter(Boolean).join('\n\n');
      } else {
        priorDigest = buildPriorDigestBlock(priorDigests);   // 그 외 = 중복 금지
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
        // 맺음말에만 파생 지표를 넣는다. b37bcff(맺음말 신설)에서 이 블록을 만드는
        // 함수는 추가됐는데 넘기는 자리가 빠져 있었다 —— 그래서 맺음말은 신설 이후
        // 한 번도 파생 지표를 받아 본 적이 없다. 2026-07 맺음말이 멀쩡했던 것은
        // 사람이 손으로 고쳤기 때문이고, 08·09 는 수치를 지어내다 QA 에 걸렸다.
        derivedFactText: sec.id === 'closing' ? await buildClosingDerivedBlock() : null,
        priorDigest,
      });
      // 빈 결과가 멀쩡한 원고를 덮지 않게 한다 ★
      // --force 로 다시 쓸 때 그 달 풀이 얇으면 기사 0건 → status: no-data 로 저장되는데,
      // 그 자리에 이미 제대로 쓰인 섹션이 있으면 빈 스텁이 좋은 원고를 지운다.
      // 2026-10-06 에 실제로 index·closing 을 그렇게 날렸다(git 에서 복구했다).
      // 되살릴 데가 없는 상황 —— 커밋 전 재생성 —— 이면 그대로 유실이다.
      if (result.status === 'no-data' && fs.existsSync(outPath)) {
        const prev = fs.readFileSync(outPath, 'utf-8');
        const { meta: prevMeta } = parseFrontmatter(prev);
        if (prevMeta.status === 'draft' || prevMeta.status === 'approved') {
          console.warn(`⚠️  [${sec.id}] 기사 0건 — 기존 ${prevMeta.status} 원고를 지우지 않고 저장을 건너뛴다`);
          priorDigests.push(extractDigest(prev, sec.title));
          skipped++;
          continue;
        }
      }

      const saved   = saveSectionFile(OUT_DIR, sec.id, MONTH, result.status, result.text, {
        pass1_tokens: result.pass1Tokens,
        pass2_tokens: result.pass2Tokens,
        items_count:  items.length,
      });
      console.log(`✅ [${sec.id}] 저장: ${saved}\n`);
      priorDigests.push(extractDigest(result.text, sec.title));   // 다음 섹션 dedup용 누적
      generated++;
    } catch (err) {
      // 한 섹션이 죽어도 나머지는 계속 쓴다 ★
      // 2026-10-02 실행은 macro 에서 예외가 나며 그대로 끝났고, index·closing 과
      // 조립·QA·초안 커밋까지 전부 함께 날아갔다. 그 달 리포트가 통째로 없었던
      // 이유다. 한 섹션의 사고가 나머지 여섯을 볼모로 잡을 이유가 없다.
      failed.push({ id: sec.id, message: err.message });
      console.error(`::error::[${sec.id}] 생성 실패 — ${err.message}`);
      console.error('   남은 섹션은 계속 생성한다. 이 실행은 실패로 끝난다.');
    }
  }

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`완료: ${generated}개 생성, ${skipped}개 스킵`);
  if (failed.length) {
    console.error(`실패: ${failed.length}개 섹션`);
    failed.forEach(f => console.error(`  - ${f.id}: ${f.message}`));
    // 진행분은 디스크에 남아 있다. 재실행하면 성공한 섹션은 건너뛰고 실패분만 다시 쓴다.
    process.exitCode = 1;
  }
  if (generated > 0) {
    console.log(`\n다음 단계:`);
    console.log(`  1. 각 섹션 파일에서 status: draft → status: approved 로 변경`);
    console.log(`     ${OUT_DIR}/`);
    console.log(`  2. 병합: node generators/report/assemble-monthly-report.js`);
  }

  // 전 섹션 생성 완료 후 전망(forecasts.json) 자동 추출 — 실패해도 리포트 생성 자체는 성공 유지
  if (runAll && generated > 0) {
    try {
      console.log(`\n📮 전망 추출 실행: node generators/report/extract-forecasts.js --month=${MONTH}`);
      execSync(`node generators/report/extract-forecasts.js --month=${MONTH}`, {
        cwd: path.resolve(__dirname, '../..'),
        stdio: 'inherit',
      });
    } catch (e) {
      console.warn('⚠️  전망 추출 실패(무시) —', e.message);
    }
  }
}

main().catch(err => {
  console.error('❌ run-section.js 실패:', err.message);
  process.exit(1);
});
