import { readFileSync, readdirSync } from 'fs';
const dir = 'content/weekly-region';
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(dir + '/' + f, 'utf8'));
  const items = j.items || j.articles || [];
  console.log(f, '| TOP:', Object.keys(j).join(','),
    '| n=', items.length,
    '| item0:', items[0] ? Object.keys(items[0]).join(',') : '(none)',
    '| types:', [...new Set(items.map((x) => x.briefType))].join(','));
  if (j.selection) console.log('   selection keys:', Object.keys(j.selection).join(','));
  if (j.titles) console.log('   titles[0]:', j.titles[0] ? Object.keys(j.titles[0]).join(',') : '(none)');
}
