'use strict';
// generators/jp-report/run.js
// 일본 월간 리포트 파이프라인 오케스트레이터.
// 사용법: node generators/jp-report/run.js [--publish]
//
//   research → write(+verify 2층) → assemble → [publish]
//
// 발행은 완전 자동이되, 검수를 통과하지 못하면 발행하지 않고 멈춘다(fail-closed).
// 사람이 승인 버튼을 누르지 않는다는 뜻이지, 틀린 수치를 내보낸다는 뜻이 아니다.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

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

  // 종료 코드 2 = 검수 미해결. 원고는 만들어졌지만 발행하면 안 된다.
  const write = step('② writer — 섹션 생성 + 2층 검수', 'write/write-report.js');
  const blocked = write.code === 2;
  if (!write.ok && !blocked) {
    console.error('\n❌ 원고 생성 실패 — 중단');
    process.exit(1);
  }

  const assemble = step('③ assembler — 차트·SEO·HTML', 'assemble/build-report.js', [`--period=${period}`]);
  if (!assemble.ok) {
    console.error('\n❌ 조립 실패 — 중단');
    process.exit(1);
  }

  console.log('\n' + '─'.repeat(56));
  if (blocked) {
    console.error('⛔ 검수 미해결 — 발행하지 않는다 (fail-closed)');
    console.error(`   원고와 HTML은 ${DRAFTS} 에 있다. 지적 내용은 위 로그 참조.`);
    process.exit(2);
  }
  console.log(`✅ ${period} 리포트 준비 완료`);
  if (!publish) {
    console.log('   발행하려면 --publish 를 붙여 실행한다.');
    return;
  }
  console.log('\n▶ ④ publish');
  console.warn('   ⚠️ 발행 단계는 미구현이다. 사이트(jpn.logisight.net) 구축 후 연결한다.');
}

if (require.main === module) main();
