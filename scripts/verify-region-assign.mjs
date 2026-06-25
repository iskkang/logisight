import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { assignPool, REGIONS } = require('../lib/region-assign');

const cfgs = {};
for (const r of REGIONS) cfgs[r] = require('../config/regions/' + r + '.js');

// 픽스처: 제목+리드(summary)에 실제 기사 톤 반영. content엔 region+hook 신호 포함(scoreArticle pass용).
const F = [
  { name: 'KCCI 지수', expect: 'global',
    a: { title: '컨운임지수 11.88% 급등…미주·유럽 노선 강세', summary: '한국발 KCCI 11.88% 상승, 미주·유럽 강세',
         content: '미 서안·동안·유럽·지중해·중동·호주·남미·아프리카 노선 운임 상승' } },
  { name: 'WorldACD 거시', expect: 'global',
    a: { title: 'WorldACD 5월 항공화물 데이터…물량 9% 감소', summary: '글로벌 항공화물 수요 동향', content: '전 세계 항공화물 수요·운임 집계' } },
  { name: '중동 항공 안정(주체 없음)', expect: 'global',
    a: { title: '중동 발발에도 항공화물 시장 안정', summary: '아시아발 운임 강세 지속, 물량 소폭 변동', content: '중동 정세에도 시장 안정' } },
  { name: '글로벌 항만혼잡 340TEU', expect: 'global',
    a: { title: '글로벌 항만 혼잡 340만TEU…선사 7월 운임인상 예고', summary: '전 세계 주요 항만 적체 심화', content: '로테르담·LA·상하이 등 적체' } },
  { name: 'Steel 232(미국 주체)', expect: 'americas',
    a: { title: '미국 철강·알루미늄 관세 면제…기록적 절차 요구', summary: '미국 Section 232 관세 면제 신청 절차 강화',
         content: '미국 정부가 철강·알루미늄 관세 면제 절차를 강화' } },
  { name: 'DP World 텍사스(미주 주체)', expect: 'americas',
    a: { title: 'DP World, 텍사스 코퍼스크리스티항 컨터미널 개발 추진', summary: '미국 텍사스 항만 인프라 투자 확대',
         content: '미국 텍사스 코퍼스크리스티항 컨테이너 터미널 개발로 수출입 물동량 처리 능력 확대' } },
  { name: '미국 301조 독일제약(유럽 주체)', expect: 'europe',
    a: { title: '미·독 약가 갈등…美, 301조 조사 개시', summary: 'USTR이 독일 제약에 대한 301조 관세 조사를 개시',
         content: '독일 제약사 약가를 문제삼아 미국이 301조 관세 조사에 착수' } },
  { name: '컨운임 미주 5700(미주 광역만)', expect: 'global',
    a: { title: '컨운임 이른 성수기 급등…미주 5700달러 돌파', summary: '미주 노선 운임 급등', content: '미주 노선 운임 강세 지속' } },
];

const buckets = assignPool(F.map((f) => f.a), cfgs, { dominanceMargin: 1 });
const KEYS = [...REGIONS, 'global'];
const bucketOf = (a) => KEYS.find((k) => buckets[k].some((x) => x.title === a.title)) || '(none)';

let fail = 0;
for (const f of F) {
  const got = bucketOf(f.a);
  const ok = got === f.expect;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${f.name} | got=${got} expect=${f.expect}`);
}

// 거시 4종 전부 global
for (const n of ['KCCI 지수', 'WorldACD 거시', '중동 항공 안정(주체 없음)', '글로벌 항만혼잡 340TEU']) {
  const f = F.find((x) => x.name === n); const ok = bucketOf(f.a) === 'global';
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | [거시→global] ${n}`);
}

// europe ∩ americas disjoint
const et = new Set(buckets.europe.map((x) => x.title));
const overlap = buckets.americas.filter((x) => et.has(x.title));
const dOk = overlap.length === 0;
if (!dOk) fail++;
console.log(`${dOk ? 'PASS' : 'FAIL'} | [disjoint] europe∩americas = ${overlap.length}`);

console.log('\ncounts:', Object.fromEntries(KEYS.map((k) => [k, buckets[k].length])));
console.log(fail === 0 ? 'ALL GREEN' : `${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
