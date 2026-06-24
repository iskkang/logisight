'use strict';
// generators/weekly-report/list-publishable.js
// 자동발행 대상 주차(YYYY-Www)를 한 줄에 하나씩 stdout으로 출력한다.
// 대상 = content/weekly-report/<week>.md 가 status: approved 이고,
//        아직 content/published/weekly-report-<week>.pdf 가 없는 주차.
//   --week=YYYY-Www : 해당 주차만 검사
//   --force         : PDF가 이미 있어도 포함(재발행)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const WR_DIR = path.join(ROOT, 'content/weekly-report');
const PUB_DIR = path.join(ROOT, 'content/published');

function arg(name) { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : null; }
const flag = (name) => process.argv.includes(`--${name}`);

function isApproved(file) {
  return fs.existsSync(file) && /^status:\s*approved\s*$/m.test(fs.readFileSync(file, 'utf-8'));
}
function pdfExists(week) {
  return fs.existsSync(path.join(PUB_DIR, `weekly-report-${week}.pdf`));
}

const only = arg('week');
const force = flag('force');

const candidates = only
  ? [`${only}.md`]
  : (fs.existsSync(WR_DIR) ? fs.readdirSync(WR_DIR).filter(f => /^\d{4}-W\d{2}\.md$/.test(f)) : []);

const weeks = candidates
  .map(f => f.replace(/\.md$/, ''))
  .filter(week => isApproved(path.join(WR_DIR, `${week}.md`)) && (force || !pdfExists(week)));

process.stdout.write(weeks.join('\n'));
