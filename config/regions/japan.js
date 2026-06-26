// 일본 권역 — 한국 화주 관점(한일 항로·소부장·완성차)
module.exports = {
  region: 'japan',
  label: '일본',
  broadGeo: ['Asia', '아시아', 'East Asia', '동아시아', 'APAC'],  // 광역어 — 주체 판정 제외
  geoKeywords: [
    'Japan', '일본', 'Japanese',
    'Tokyo', '도쿄', 'Yokohama', '요코하마', 'Kobe', '고베', 'Osaka', '오사카', 'Nagoya', '나고야',
    'Hakata', '하카타', 'Shimizu', '시미즈', 'Tomakomai', 'Moji', '모지',
    'Ocean Network Express', 'NYK', 'Mitsui OSK', 'K-Line', 'Toyota', '도요타', 'Nissan', 'Honda',
  ],
  koreaAnchors: [
    '한국발', '한국향', '부산', 'Korea', 'Korean shipper', 'Korean exporter', 'Korean importer',
    '한일', '대일', '소부장', '소재부품장비', '완성차', '반도체장비', '철강', '반도체', 'semiconductor',
  ],
  policyAnchors: [
    '관세', 'tariff', '수출규제', 'export control', '화이트리스트', '불화수소', '수출통제',
    '규제', 'regulation', '제재', 'sanctions', '쿼터', 'quota', '무역장벽', 'trade barrier', '반덤핑',
  ],
  tradeAnchors: [
    '무역량', 'trade volume', '물동량', 'throughput', '수출입', 'exports', 'imports',
    '교역량', 'TEU', 'container volume', '수출', '수입', '무역', '교역', '통관', 'customs',
  ],
  priorityTopics: [
    '한일 항로·환적', '도쿄·요코하마·고베 등 주요 항만', '소재부품장비·반도체장비 교역',
    '일본 완성차·철강 동향', '한일 수출규제 잔존 이슈',
  ],
  excludeKeywords: ['celebrity', '연예', '스포츠', 'football', 'soccer'],
  promptFocus: [
    '일본 권역 물류를 한국 화주·제조사 관점에서 분석한다.',
    '한일 항로·환적, 도쿄·요코하마·고베 항만, 소부장·반도체장비 교역, 완성차·철강 동향을 우선한다.',
    '현상→원인→배경→전망 4단계. 권고가 아닌 "무엇을 왜 주시할지".',
  ].join(' '),
  extraSources: [],
};
