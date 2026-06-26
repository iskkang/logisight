// 미주 권역 — 한국 수출기업 관점
module.exports = {
  region: 'americas',
  label: '미주',
  geoKeywords: [
    'Americas','미주','North America','US','U.S.',  // 일반 권역어
    'USA','United States','미국','Mexico','멕시코','USMCA','nearshoring','니어쇼어링',
    'Laredo','라레도','Nuevo Laredo','Los Angeles','Long Beach','LA/LB',
    'Savannah','사바나','Houston','Texas','텍사스','Corpus Christi','코퍼스크리스티','Manzanillo','만사니요','Gulf of Mexico','멕시코만',
    // 주체앵커 보강: 미국·캐나다·멕시코 허브 도시·항만·물류기업
    'Chicago','시카고','Dallas','댈러스','Memphis','멤피스','Atlanta','애틀랜타','New York','뉴욕',
    'New Jersey','뉴저지','Oakland','오클랜드','Seattle','시애틀','Charleston','찰스턴','Norfolk','노퍽',
    'Vancouver','밴쿠버','Monterrey','몬테레이','Tijuana','티후아나','Veracruz','베라크루스',
    'Lazaro Cardenas','라사로카르데나스','FedEx','페덱스',
  ],
  broadGeo: ['Americas', '미주', 'North America'],  // 광역어 — 주체 판정에서 제외(미국·멕시코·도시는 주체로 유지)
  koreaAnchors: [
    'Hyundai','현대','Kia','기아','Samsung','삼성','LG','SK On','SK온','POSCO','포스코','Hanwha','한화',
    'battery','배터리','semiconductor','반도체','EV','전기차','IRA','관세','tariff',
    'HMGMA','Georgia plant','조지아 공장','Tennessee','테네시',
    '한국발','한국향','Korean exporter','부산',
  ],
  policyAnchors: [
    '관세','tariff','반덤핑','anti-dumping','수출통제','export control','제재','sanctions',
    '쿼터','quota','보조금','subsidy','무역장벽','trade barrier','관세인상',
    'Section 301','Section 232','IRA','USMCA','reshoring',
  ],
  tradeAnchors: [
    '무역량','trade volume','물동량','throughput','수출입','exports','imports',
    '교역량','TEU','container volume','수출 증가','수출 감소','통관량',
    'customs volume','교역 규모','bilateral trade',
  ],
  priorityTopics: [
    '니어쇼어링 (멕시코 생산 이전)',
    '미 서안/동안 항만',
    '라레도 국경 통관',
    'IRA·관세·반덤핑이 K-배터리/반도체 대미 수출에 미치는 영향',
    'USMCA 동향',
  ],
  excludeKeywords: ['football','celebrity','연예','스포츠'],
  promptFocus: [
    '미국·멕시코 물류를 한국 수출기업 관점에서 분석한다.',
    '니어쇼어링(멕시코 생산), 국경 통관(라레도), 서안·동안 항만, 관세(IRA·반덤핑)가 K-배터리/반도체/완성차 대미 수출에 미치는 영향을 우선한다.',
    '현상→원인→배경→전망 4단계. 권고가 아닌 "무엇을 왜 주시할지".',
  ].join(' '),
  extraSources: [],
};
