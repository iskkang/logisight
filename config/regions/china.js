// 중국 권역 — 한국 화주 관점(최대 교역상대·환적)
module.exports = {
  region: 'china',
  label: '중국',
  broadGeo: ['Asia', '아시아', 'East Asia', '동아시아', 'Greater China', '중화권', 'APAC'],  // 광역어 — 주체 판정 제외
  geoKeywords: [
    'China', '중국', 'PRC',
    'Shanghai', '상하이', 'Ningbo', '닝보', 'Shenzhen', '선전', 'Qingdao', '칭다오', 'Tianjin', '톈진',
    'Guangzhou', '광저우', 'Xiamen', '샤먼', 'Dalian', '다롄', 'Yantian', '옌톈', 'Yangshan', '양산',
    'Hong Kong', '홍콩', 'Suzhou', '쑤저우', 'Chongqing', '충칭',
    'COSCO', '코스코', 'Sinotrans', 'SIPG', '상하이항',
  ],
  koreaAnchors: [
    '한국발', '한국향', '부산', 'Korea', 'Korean shipper', 'Korean exporter', 'Korean importer',
    '한중', '대중 수출', '대중 교역', '반도체', 'semiconductor', '배터리', '이차전지', '디스플레이', '석유화학',
    '알리익스프레스', '테무', '쉬인', '이커머스', '직구',
  ],
  policyAnchors: [
    '관세', 'tariff', '반덤핑', 'anti-dumping', '수출통제', 'export control', '제재', 'sanctions',
    '규제', 'regulation', '쿼터', 'quota', '보조금', 'subsidy', '무역장벽', 'trade barrier',
    'Section 301', '디커플링', 'decoupling', '미중', '무역전쟁', '희토류', 'rare earth',
  ],
  tradeAnchors: [
    '무역량', 'trade volume', '물동량', 'throughput', '수출입', 'exports', 'imports',
    '교역량', 'TEU', 'container volume', '수출', '수입', '무역', '교역', '통관', 'customs',
  ],
  priorityTopics: [
    '한중 교역·환적 동향', '상하이·닝보·선전 등 주요 항만', '미중 무역·관세·디커플링',
    '중국발 이커머스 물동량', '반도체·배터리 공급망',
  ],
  excludeKeywords: ['celebrity', '연예', '스포츠', 'football', 'soccer'],
  promptFocus: [
    '중국 권역 물류를 한국 화주·제조사 관점에서 분석한다.',
    '한중 교역·환적, 상하이·닝보·선전 항만, 미중 관세·디커플링, 중국발 이커머스 물동량을 우선한다.',
    '현상→원인→배경→전망 4단계. 권고가 아닌 "무엇을 왜 주시할지".',
  ].join(' '),
  extraSources: [],
};
