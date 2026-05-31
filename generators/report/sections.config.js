'use strict';

function matches(item, keywords) {
  const text = `${item.title} ${item.summary_en || ''} ${item.source || ''}`.toLowerCase();
  return keywords.some(k => text.includes(k.toLowerCase()));
}

const SECTIONS = [
  {
    id: 'index',
    title: '01. 이번 달 핵심 & 시황 총론',
    focus:
      '이번 달 가장 중요한 단일 핵심 이슈 1개를 선정하고, 전체 해운·물류 시황을 총론으로 정리. ' +
      '[이번 달 핵심]은 이슈 1개 / 문장 1개 / 현상…원인…전망 구조 / 말줄임표 최대 1개 / 명사형 종결 필수.',
    filterItems: (items) => items,
  },
  {
    id: 'ocean',
    title: '02. 해운 시황',
    focus:
      '컨테이너 운임 시황 — 아시아-북미/아시아-유럽/인트라-아시아 항로별 등락, ' +
      '선사 운임 정책(GRI/FAK), 선복 공급·수요, 블랭크 세일링, 운임 지수(SCFI/WCI/FBX) 동향.',
    filterItems: (items) => {
      const kw = [
        'freight', 'ocean', 'container', 'shipping', 'vessel', 'carrier',
        'SCFI', 'WCI', 'FBX', 'GRI', 'FAK', 'TEU', 'FEU',
        'blank sailing', 'alliance', 'Freightos',
        '운임', '해운', '선박', '선복', '선사', '컨테이너',
        'asia', 'europe', 'transpacific', 'intra-asia',
      ];
      return items.filter(i => matches(i, kw) || i.category === 'carrier_update');
    },
  },
  {
    id: 'air',
    title: '03. 항공 화물',
    focus:
      '항공 화물 운임·물동량 동향 — WorldACD·TAC Index 기반 노선별 등락, ' +
      '전자상거래·특송 수요, 성수기 공급 전망.',
    filterItems: (items) => {
      const kw = [
        'air cargo', 'airfreight', 'air freight', 'WorldACD', 'TAC', 'IATA',
        'e-commerce', 'express', 'charter', 'belly',
        '항공', '에어카고', '특송', '국제항공',
      ];
      return items.filter(i => matches(i, kw));
    },
  },
  {
    id: 'rail',
    title: '04. 철도 시황',
    focus:
      'CIS·중앙아시아 철도 운송 동향 — TCR(중국횡단철도)/TSR(시베리아횡단철도) 운임·리드타임·운행 현황, ' +
      '블록 트레인 공급, 한국-CIS 구간 지연 이슈.',
    filterItems: (items) => {
      const kw = [
        'rail', 'TCR', 'TSR', 'TITR', 'TMR', 'train', 'block train',
        'silk road', 'belt and road', 'Almaty', 'Andijan', 'Bishkek',
        'Kazakhstan', 'Uzbekistan', 'Kyrgyz',
        '철도', '중앙아시아', '시베리아', '중국횡단', '대륙철도',
        '카자흐스탄', '우즈베키스탄', '키르기즈',
      ];
      return items.filter(i => matches(i, kw));
    },
  },
  {
    id: 'region',
    title: '05. 지역별 이슈',
    focus:
      '한국·캐나다·유럽·독일 등 주요 지역 물류 이슈 — 항만 혼잡, 인프라 투자, ' +
      '포워딩 환경 변화, 공급망 재편 관련 지역 특화 이슈.',
    filterItems: (items) => {
      const kw = [
        'Korea', 'Canada', 'Germany', 'EU', 'Europe', 'Japan',
        'infrastructure', 'port', 'congestion', 'hub',
        '한국', '캐나다', '독일', '유럽', '일본',
        '항만', '인프라', '허브', '혼잡', '포워더',
      ];
      return items.filter(i => matches(i, kw));
    },
  },
  {
    id: 'macro',
    title: '06. 거시경제·지정학',
    focus:
      '글로벌 거시경제 및 지정학 리스크가 해운·물류에 미치는 영향 — ' +
      '미·중 무역 분쟁, 관세, 지정학 긴장(호르무즈·홍해), 유가·USD 동향.',
    filterItems: (items) => {
      const kw = [
        'tariff', 'trade war', 'sanction', 'geopolit',
        'Hormuz', 'Red Sea', 'Suez', 'oil', 'USD', 'macro',
        'supply chain', 'IEEPA',
        '관세', '무역전쟁', '제재', '지정학', '호르무즈', '홍해', '유가',
        '원자재', '환율', '무역', '공급망',
      ];
      return items.filter(i => matches(i, kw));
    },
  },
  {
    id: 'policy',
    title: '07. 규제·정책',
    focus:
      '글로벌 무역·해운 규제 및 정책 변화 — 미국 IEEPA 관세·법원 공방, ' +
      'EU CBAM, IMO 환경 규제, 한국 통관·관세 정책.',
    filterItems: (items) => {
      const kw = [
        'regulation', 'policy', 'law', 'court', 'tariff', 'customs',
        'IEEPA', 'CBP', 'CIT', 'CBAM', 'IMO', 'compliance',
        'legislation', 'bill', 'act', 'ruling', 'Flexport',
        '규제', '정책', '법원', '통관', '관세', '입법', '법령',
      ];
      return items.filter(i => matches(i, kw));
    },
  },
];

module.exports = SECTIONS;
