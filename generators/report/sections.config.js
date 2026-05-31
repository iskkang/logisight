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
    // 지표 표(코드 주입) + 심층 분석 요약 일부만 → 전체 기사 오염 차단
    filterItems: (items) => items.filter(i => i.category === 'deep_analysis').slice(0, 5),
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
      return items.filter(i =>
        i.category === 'lane_causal'    ||   // Linerlytica·gCaptain 항로 원인 — 무조건 포함
        i.category === 'carrier_update' ||   // Freightos·Flexport 시황 업데이트
        i.category === 'deep_analysis'  ||   // JOC 심층 분석
        matches(i, kw)
      );
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
    title: '04. 철도 시황 (TCR·TSR·유라시아)',
    focus:
      '중국-유럽 철도(TCR, 중유반열·일대일로), 시베리아 횡단철도(TSR) 등 ' +
      '한국·중국·중앙아시아·러시아를 잇는 유라시아 대륙철도 동향에 한정. ' +
      '국경 통관 정체(호르고스·알라산쿠·도스틱 등), 블록 트레인 공급·수요, 운임, 리드타임을 다룸. ' +
      '★ 미국·캐나다 등 북미 대륙철도(UP·NS·BNSF), 독일·서유럽 자국 내 철도 이슈는 이 섹션에서 다루지 말 것.',
    filterItems: (items) => {
      const INCLUDE = [
        'TCR','TSR','TITR','TMR','china-europe','china europe','중유반열','중구반열',
        'belt and road','일대일로','silk road','block train','블록 트레인','중앙아시아','central asia',
        'kazakhstan','카자흐스탄','uzbekistan','우즈베키스탄','kyrgyz','키르기스',
        'khorgos','호르고스','alashankou','알라산쿠','알라샨커우','dostyk','도스틱',
        'rzd','시베리아','trans-siberian','eurasia','유라시아','중국횡단','시베리아횡단',
        'xian','시안','chongqing','충칭','연운항','blank train',
      ];
      const EXCLUDE = [
        'union pacific','norfolk southern','UP-NS','UP/NS','BNSF','CSX','CN rail','CPKC',
        'STB','surface transportation board','미국 철도','북미 대륙','대륙횡단 철도 합병',
        'german rail','deutsche bahn','독일 북부 철도','독일 철도',
      ];
      const txt = i => `${i.title} ${i.summary_en||''} ${i.content||''} ${i.source||''}`.toLowerCase();
      return items.filter(i => {
        const t = txt(i);
        if (EXCLUDE.some(k => t.includes(k.toLowerCase()))) return false;   // 북미·서유럽 우선 배제
        return i.section === 'rail' || INCLUDE.some(k => t.includes(k.toLowerCase()));
      });
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
