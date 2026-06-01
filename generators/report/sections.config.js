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
      '컨테이너·건화물 운임 시황. 아래 7개 소제목 구조 필수. ' +
      '지수 표·차트는 시스템이 자동 주입하므로 본문에 표나 수치를 그리지 말 것. ' +
      '제공된 "해운 운임 지수" 데이터의 수치만 인용하고, 그 외 운임 수치 창작 금지. ' +
      '## 02-1. KCCI (한국형 컨테이너 운임지수) — KCCI 종합 및 13개 항로 등락, 한국 수출입 운임 시사점. ' +
      '## 02-2. SCFI (상하이 컨테이너운임지수) — 아시아-북미·유럽·동안 항로 등락 현황. ' +
      '## 02-3. CCFI (중국 컨테이너운임지수) — 중국 수출 컨테이너 시장 전반 동향. ' +
      '## 02-4. WCI (드류리 세계 컨테이너 운임지수) — 주요 항로 현물 운임(USD/FEU) 월간 추이. ' +
      '## 02-5. BDI (건화물선운임지수) — 건화물 시황 및 컨테이너 시장 선행 시사점. ' +
      '## 02-6. 블랭크 세일링(결항) — Drewry 트래커 기반 향후 N주 결항률·항로별 현황. ' +
      '결항률↔유효 선복↔KCCI/SCFI 운임 수급 연계, 향후 N주 선복 영향 서술. ' +
      '데이터 미수집 시 SCFI·KCCI 수급 연계 관점으로 공급 전망 대체. ' +
      '## 02-7. 종합 전망 — 지수 간 수렴·발산과 시장 방향성 종합. ' +
      '각 지수는 현상에서 원인·전망으로 자연스럽게 이어지는 산문으로 서술(대괄호 라벨·머리표 금지). ' +
      '특정 기업·영업 관점·독자 행동 권유 없이 객관적 시장 전망으로 마무리. 항로 등락 원인은 주어진 기사에 근거. 소제목당 4~6문장 간결.',
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
      '중국-유럽(TCR·일대일로), TSR, 한·중·중앙아·러시아 유라시아 철도에 한정. 북미·서유럽 자국 철도 제외. ' +
      '아래 3개 소제목 구조 필수, 데이터 없는 지역은 "금월 데이터 미수집" 정직 표기: ' +
      '## 04-1. 중국-유럽 철도 (TCR·일대일로) — 중구반열 운행·물동량, 중국측 국경. ' +
      '## 04-2. 러시아 철도 (TSR·극동) — RZD 동향, 러-중 국경, 대EU 물동량. ' +
      '## 04-3. 종합 전망 — 유라시아 회랑 시장의 구조적 방향성 종합. ' +
      '각 소제목은 현상에서 원인·배경·전망으로 자연스럽게 이어지는 산문(대괄호 라벨·머리표 금지). ' +
      '특정 기업·영업 관점·행동 권유 없이 객관적 전망으로 마무리. 운임·스페이스는 다루지 말 것(데이터 제외).',
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
