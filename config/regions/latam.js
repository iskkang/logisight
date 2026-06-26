// 남미 권역 — 한국 자원수입·이차전지 공급망 관점
module.exports = {
  region: 'latam',
  label: '남미',
  geoKeywords: [
    'South America','남미','중남미','Latin America','LatAm','라틴아메리카',  // 일반 권역어
    'Brazil','브라질','Chile','칠레','Peru','페루','Argentina','아르헨티나','Colombia','콜롬비아',
    'Santos','산토스','Paranagua','파라나구아','Valparaiso','발파라이소','San Antonio',
    'lithium','리튬','copper','구리','iron ore','철광석',
    // 주체앵커 보강: 남미 허브 도시·항만·광물기업
    'Callao','카야오','Buenos Aires','부에노스아이레스','Cartagena','카르타헤나','Guayaquil','과야킬',
    'Montevideo','몬테비데오','Bogota','보고타','Sao Paulo','상파울루','Rio de Janeiro','리우데자네이루',
    'Itajai','이타자이','Codelco','코델코','soybean','대두',
  ],
  broadGeo: ['South America', '남미', '중남미', 'Latin America', 'LatAm', '라틴아메리카'],  // 광역어 — 주체 판정에서 제외
  koreaAnchors: [
    'lithium','리튬','이차전지 원료','battery raw material','POSCO','포스코','LG','Samsung','삼성',
    'iron ore','철광석','grain','곡물','copper','구리','nickel','니켈',
    '한국발','한국향','Korean importer','부산',
  ],
  policyAnchors: [
    '관세','tariff','수출세','export tax','자원 국유화','광물 정책','mining policy',
    '반덤핑','anti-dumping','쿼터','quota','보조금','subsidy','무역장벽','trade barrier','FTA',
  ],
  tradeAnchors: [
    '무역량','trade volume','물동량','throughput','수출입','exports','imports',
    '교역량','TEU','container volume','수출 증가','수출 감소','통관량',
    'customs volume','교역 규모','bilateral trade',
  ],
  priorityTopics: [
    '리튬·구리 등 배터리 원료 공급',
    '브라질 철광·곡물 수출',
    '남미 주요 항만',
    '한국 자원 수입 흐름',
  ],
  excludeKeywords: ['celebrity','연예','스포츠','football','soccer'],
  promptFocus: [
    '남미(브라질·칠레) 권역의 물류·교역을 그 자체로 분석한다.',
    '리튬·구리·철광·곡물 흐름과 주요 항만을 우선한다.',
    '현상→원인→배경→전망 4단계. 권고가 아닌 "무엇을 왜 주시할지".',
  ].join(' '),
  extraSources: [],
};
