// 중동 권역 — 한국 화주 관점(호르무즈·홍해·유가·플랜트)
module.exports = {
  region: 'mideast',
  label: '중동',
  broadGeo: ['Middle East', '중동', 'Gulf', '걸프', 'MENA', 'GCC', 'Arab', '아랍'],  // 광역어 — 주체 판정 제외
  geoKeywords: [
    'Dubai', '두바이', 'Jebel Ali', '제벨알리', 'UAE', '아랍에미리트', 'Abu Dhabi', '아부다비',
    'Saudi', '사우디', 'Jeddah', '제다', 'Dammam', '담맘', 'Riyadh', '리야드',
    'Qatar', '카타르', 'Kuwait', '쿠웨이트', 'Oman', '오만', 'Bahrain', '바레인',
    'Iran', '이란', 'Bandar Abbas', '반다르압바스', 'Israel', '이스라엘', 'Haifa', '하이파',
    'Hormuz', '호르무즈', 'Red Sea', '홍해', 'Bab el-Mandeb', '바브엘만데브', 'NEOM', '네옴',
  ],
  koreaAnchors: [
    '한국발', '한국향', '부산', 'Korea', 'Korean shipper', 'Korean exporter', 'Korean importer',
    '플랜트', '건설', '조선', '방산', '석유화학', 'LNG', '중동 건설', '담수',
  ],
  policyAnchors: [
    '제재', 'sanctions', '이란 제재', '유가', 'oil price', 'OPEC', '감산', '증산',
    '수출통제', 'export control', '규제', 'regulation', '관세', 'tariff', '쿼터', 'quota', '무역장벽',
  ],
  tradeAnchors: [
    '무역량', 'trade volume', '물동량', 'throughput', '수출입', 'exports', 'imports',
    '교역량', 'TEU', 'container volume', '수출', '수입', '무역', '교역', '통관', 'customs',
  ],
  priorityTopics: [
    '호르무즈·홍해 항로 리스크·우회', '유가·OPEC 동향', '두바이·제벨알리 등 걸프 항만',
    '중동 플랜트·건설·조선 수주', '한-중동 교역',
  ],
  excludeKeywords: ['celebrity', '연예', '스포츠', 'football', 'soccer'],
  promptFocus: [
    '중동 물류를 한국 화주·제조사 관점에서 분석한다.',
    '호르무즈·홍해 항로 리스크, 유가·OPEC, 걸프 항만(두바이·제벨알리), 중동 플랜트·건설·조선을 우선한다.',
    '현상→원인→배경→전망 4단계. 권고가 아닌 "무엇을 왜 주시할지".',
  ].join(' '),
  extraSources: [],
};
