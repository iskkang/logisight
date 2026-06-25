import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const europe = require('../config/regions/europe.js');
const { scoreArticle } = require('../lib/region-filter.js');

const fixtures = [
  {
    name: 'KO-EU 배터리(통과 기대)',
    a: { title: 'LG Energy Solution expands Wroclaw plant; Rotterdam imports rise',
         summary: '한국 배터리 공급망 유럽 확대' },
    expectPass: true,
  },
  {
    name: '유럽 일반 비물류(컷 기대)',
    a: { title: 'France football league schedule', summary: '스포츠 일정' },
    expectPass: false,
  },
  {
    name: '한국만·유럽無(컷 기대)',
    a: { title: 'Busan port handles record TEU', summary: '부산항 물동량' },
    expectPass: false,
  },
];

let fail = 0;
for (const f of fixtures) {
  const r = scoreArticle(f.a, europe);
  const ok = r.pass === f.expectPass;
  if (!ok) fail++;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + f.name +
    ' | region=' + r.regionScore + ' korea=' + r.koreaScore +
    ' rel=' + r.relevance + ' pass=' + r.pass);
}
console.log(fail === 0 ? '\nALL GREEN' : '\n' + fail + ' FAILED');
process.exit(fail === 0 ? 0 : 1);
