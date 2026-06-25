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
  {
    // 원안의 'EV'는 koreaAnchor라 type=news로 분류됨 → policy 분류 검증 위해 'steel'로 교체
    name: 'EU-China 관세(통과·policy 기대)',
    a: { title: 'EU imposes tariffs on Chinese steel imports', summary: '유럽 무역정책 변화' },
    expectPass: true, expectType: 'policy',
  },
  {
    name: '로테르담 물동량(통과·trade 기대)',
    a: { title: 'Rotterdam container throughput rises 8%', summary: '유럽 항만 물동량' },
    expectPass: true, expectType: 'trade',
  },
  {
    name: '지역 없는 일반 관세(컷 기대)',
    a: { title: 'WTO debates global tariff reform', summary: '국제 무역 규범' },
    expectPass: false,
  },
];

let fail = 0;
for (const f of fixtures) {
  const r = scoreArticle(f.a, europe);
  let ok = r.pass === f.expectPass;
  if (f.expectType && r.type !== f.expectType) ok = false;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${f.name} | region=${r.regionScore} korea=${r.koreaScore} policy=${r.policyScore} trade=${r.tradeScore} type=${r.type} pass=${r.pass}`);
}
console.log(fail === 0 ? '\nALL GREEN' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
