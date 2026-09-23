'use strict';
// generators/jp-report/run.js
// 일본 월간 리포트 파이프라인 오케스트레이터.
// 사용법: node generators/jp-report/run.js [--publish]
//
//   research → write(+verify 2층) → assemble → [publish]
//
// 발행은 완전 자동이되, 검수를 통과하지 못하면 발행하지 않고 멈춘다(fail-closed).
// 사람이 승인 버튼을 누르지 않는다는 뜻이지, 틀린 수치를 내보낸다는 뜻이 아니다.
//
// 종료 코드
//   0 — 리포트 준비(또는 발행) 완료
//   2 — 검수 미해결. 조립도 발행도 하지 않는다. 미해결 목록은
//       outputs/cache/jp-report/<월>/unresolved.json
//   1 — 그 밖의 실패(팩트시트·원고 생성·조립·발행)

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const cache = require('./write/cache');

const DRAFTS = path.resolve(__dirname, '../../content/drafts');

function step(label, file, args = []) {
  console.log(`\n▶ ${label}`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, file), ...args], { stdio: 'inherit' });
    return { ok: true, code: 0 };
  } catch (e) {
    return { ok: false, code: e.status === undefined ? 1 : e.status };
  }
}

function main() {
  const publish = process.argv.includes('--publish');

  const research = step('① researcher — 팩트시트', 'research/build-factsheet.js');
  if (!research.ok) {
    console.error('\n❌ 팩트시트 생성 실패 — 중단');
    process.exit(1);
  }

  const factsheet = JSON.parse(fs.readFileSync(path.join(DRAFTS, 'jp-factsheet.json'), 'utf8'));
  const period = factsheet.generatedFor;

  // 종료 코드 2 = 검수 미해결. 이때 writer는 원고를 만들지 않는다.
  //
  // 예전에는 미해결이어도 assembler를 돌렸다. 원고가 없으니 assembler가 "원고 없음"으로
  // 죽고, 종료 코드가 1로 덮였다. 워크플로는 2(검수 미해결)를 기다리는데 영영 오지 않고
  // 로그에는 조립 실패만 남아 진짜 이유가 가려졌다. 미해결이면 조립하지 않는다.
  const write = step('② writer — 섹션 생성 + 2층 검수', 'write/write-report.js');
  if (write.code === 2) {
    console.error('\n' + '─'.repeat(56));
    console.error('⛔ 검수 미해결 — 조립·발행하지 않는다 (fail-closed)');
    const saved = cache.readUnresolved(period);
    ((saved && saved.unresolved) || []).forEach((u) => {
      console.error(`   ${u.section} [${u.type}] ${u.detail}`);
    });
    console.error(`   목록: ${cache.unresolvedFile(period)}`);
    console.error('   통과한 섹션은 저장돼 있다. 다시 실행하면 막힌 섹션만 다시 쓴다.');
    process.exit(2);
  }
  if (!write.ok) {
    console.error('\n❌ 원고 생성 실패 — 중단');
    process.exit(1);
  }

  const assemble = step('③ assembler — 차트·SEO·HTML', 'assemble/build-report.js', [`--period=${period}`]);
  if (!assemble.ok) {
    console.error('\n❌ 조립 실패 — 중단');
    process.exit(1);
  }

  console.log('\n' + '─'.repeat(56));
  console.log(`✅ ${period} 리포트 준비 완료`);
  if (!publish) {
    console.log('   발행하려면 --publish 를 붙여 실행한다.');
    return;
  }
  const pub = step('④ publish — PDF 업로드 + reports 등록', 'publish.js', [`--period=${period}`]);
  if (!pub.ok) {
    console.error('\n❌ 발행 실패 — 원고·PDF는 남아 있다. 로그를 보고 재실행한다.');
    process.exit(1);
  }
  console.log(`\n🌐 https://jpn.logisight.net/reports/monthly/${period}`);
}

if (require.main === module) main();
