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
      '중국-유럽 철도(TCR·일대일로), 시베리아 횡단철도(TSR), 한·중·중앙아·러시아 유라시아 철도에 한정. ' +
      '북미(UP·NS·BNSF)·서유럽 자국 철도는 다루지 말 것. ' +
      '★ 반드시 아래 4개 소제목 구조로 작성하여 지역 균형을 유지할 것. 특정 지역 데이터가 없으면 그 소제목 아래 "금월 데이터 미수집"으로 정직하게 표기(생략·창작 금지): ' +
      '## 04-1. 중국-유럽 철도 (TCR·일대일로) — 중구반열 운행량·물동량, 호르고스/알라산쿠 등 중국측 국경. ' +
      '## 04-2. 러시아 철도 (TSR·극동) — RZD 동향, 러-중 국경(자바이칼스크-만저우리 등), 극동 회랑, 대EU 물동량. ' +
      '## 04-3. 중앙아시아·국경 통관 — 카자흐(도스틱·알틴콜)·우즈벡·키르기스 환적, 미들코리더, 국경 정체·억류·리드타임. ' +
      '## 04-4. 종합 시사점 — 한국 화주·MTL 관점의 So what. ' +
      '각 소제목은 현상→원인→배경→전망 4단 + ☞ 시사점. 운임·물동량 수치는 출처(매체·기관) 병기.',
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
