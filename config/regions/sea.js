// 동남아(+남아시아) 권역 — 한국 화주 관점(환적 허브·생산기지·니어쇼어링)
module.exports = {
  region: 'sea',
  label: '동남아',
  broadGeo: ['Asia', '아시아', 'Southeast Asia', '동남아시아', '동남아', 'ASEAN', '아세안', 'South Asia', '남아시아', 'APAC'],
  geoKeywords: [
    'Singapore', '싱가포르', 'Vietnam', '베트남', 'Thailand', '태국', 'Malaysia', '말레이시아',
    'Indonesia', '인도네시아', 'Philippines', '필리핀',
    'Ho Chi Minh', '호치민', 'Hai Phong', '하이퐁', 'Cai Mep', '까이맵', 'Laem Chabang', '램차방',
    'Port Klang', '클랑', 'Tanjung Pelepas', 'Tanjung Priok', 'Jakarta', '자카르타', 'Manila', '마닐라',
    // 남아시아(인도 포함)
    'India', '인도', 'Mumbai', '뭄바이', 'Nhava Sheva', 'Mundra', '문드라', 'Chennai', '첸나이',
    'Colombo', '콜롬보', 'Bangladesh', '방글라데시', 'Chittagong', '치타공',
  ],
  koreaAnchors: [
    '한국발', '한국향', '부산', 'Korea', 'Korean shipper', 'Korean exporter', 'Korean importer',
    '베트남 삼성', '삼성', 'LG', '니어쇼어링', '생산기지', '이차전지', '전자', '봉제', '반도체',
  ],
  policyAnchors: [
    '관세', 'tariff', 'RCEP', 'FTA', '반덤핑', 'anti-dumping', '수출통제', 'export control',
    '규제', 'regulation', '쿼터', 'quota', '원산지', '무역장벽', 'trade barrier',
  ],
  tradeAnchors: [
    '무역량', 'trade volume', '물동량', 'throughput', '수출입', 'exports', 'imports',
    '교역량', 'TEU', 'container volume', '수출', '수입', '무역', '교역', '통관', 'customs',
  ],
  priorityTopics: [
    '싱가포르 환적 허브', '베트남·인도 생산기지·니어쇼어링', '동남아 주요 항만(램차방·클랑 등)',
    '한-아세안/한-인도 교역', '이차전지·전자 공급망',
  ],
  excludeKeywords: ['celebrity', '연예', '스포츠', 'football', 'soccer'],
  promptFocus: [
    '동남아·남아시아(인도) 물류를 한국 화주·제조사 관점에서 분석한다.',
    '싱가포르 환적 허브, 베트남·인도 생산기지·니어쇼어링, 동남아 항만, 한-아세안/한-인도 교역을 우선한다.',
    '현상→원인→배경→전망 4단계. 권고가 아닌 "무엇을 왜 주시할지".',
  ].join(' '),
  extraSources: [],
};
