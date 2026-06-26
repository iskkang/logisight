// 아프리카 권역 — 한국 화주 관점(수에즈/탕헤르 게이트웨이·자원·교역)
module.exports = {
  region: 'africa',
  label: '아프리카',
  broadGeo: ['Africa', '아프리카', 'Sub-Saharan', '사하라이남', 'North Africa', '북아프리카', 'East Africa', 'West Africa', 'MENA'],
  geoKeywords: [
    'South Africa', '남아공', 'Durban', '더반', 'Cape Town', '케이프타운',
    'Nigeria', '나이지리아', 'Lagos', '라고스', 'Kenya', '케냐', 'Mombasa', '몸바사',
    'Egypt', '이집트', 'Suez', '수에즈', 'Port Said', '포트사이드', 'Morocco', '모로코', 'Tangier', '탕헤르', 'Tanger Med',
    'Djibouti', '지부티', 'Ethiopia', '에티오피아', 'Ghana', '가나', 'Tanzania', '탄자니아', 'Abidjan', '아비장', 'Angola', '앙골라',
  ],
  koreaAnchors: [
    '한국발', '한국향', '부산', 'Korea', 'Korean shipper', 'Korean exporter', 'Korean importer',
    '자원', '광물', '니켈', '코발트', '리튬', '중고차', '인프라', '플랜트', '건설',
  ],
  policyAnchors: [
    '관세', 'tariff', '자원 국유화', '광물 정책', 'mining policy', '수출세', 'export tax',
    '제재', 'sanctions', '규제', 'regulation', '쿼터', 'quota', 'AfCFTA', '무역장벽', 'trade barrier', '반덤핑',
  ],
  tradeAnchors: [
    '무역량', 'trade volume', '물동량', 'throughput', '수출입', 'exports', 'imports',
    '교역량', 'TEU', 'container volume', '수출', '수입', '무역', '교역', '통관', 'customs',
  ],
  priorityTopics: [
    '수에즈·탕헤르 게이트웨이 항만', '아프리카 자원(광물)·중고차 교역', '더반·몸바사·라고스 항만',
    '한-아프리카 교역·인프라', '홍해 우회가 아프리카 항로에 미치는 영향',
  ],
  excludeKeywords: ['celebrity', '연예', '스포츠', 'football', 'soccer'],
  promptFocus: [
    '아프리카 권역의 물류·교역을 그 자체로 분석한다.',
    '수에즈·탕헤르 게이트웨이, 자원(광물)·중고차, 더반·몸바사·라고스 항만, 역내·국제 교역을 우선한다.',
    '현상→원인→배경→전망. 권고가 아닌 "무엇이 왜 중요한지". 한국은 실제 연관될 때만 언급.',
  ].join(' '),
  extraSources: [],
};
