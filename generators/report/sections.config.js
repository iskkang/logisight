'use strict';

function matches(item, keywords) {
  const text = `${item.title} ${item.summary_en || ''} ${item.source || ''}`.toLowerCase();
  return keywords.some(k => text.includes(k.toLowerCase()));
}

// 단신·가십 필터: 본문 합산 150자 미만 항목 제외
function hasSubstance(item) {
  return (item.summary_en || '').length + (item.content || '').length >= 150;
}

const SECTIONS = [
  {
    id: 'index',
    title: '01. 이번 달 핵심 & 시황 총론',
    focus:
      '이번 달 가장 중요한 단일 핵심 이슈 1개를 선정하고, 전체 해운·물류 시황을 총론으로 정리. ' +
      '[이번 달 핵심]은 이슈 1개 / 문장 1개 / 현상…원인…전망 구조 / 말줄임표 최대 1개 / 명사형 종결 필수.',
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
      '## 02-7. 역내(Intra-Asia) 운임 — KCCI 역내 항로(중국·일본·동남아) 기반 역내 운임 동향. ' +
      '글로벌 운임과의 디커플링 여부, 역내 수요·공급 시사점. 데이터 미수집 시 생략. ' +
      '각 지수는 현상에서 원인·전망으로 자연스럽게 이어지는 산문으로 서술(대괄호 라벨·머리표 금지). ' +
      '특정 기업·영업 관점·독자 행동 권유 없이 객관적 시장 전망으로 마무리. 항로 등락 원인은 주어진 기사에 근거. ' +
      '분량 엄수: 지수 블록(02-N)은 표+차트+해설이 한 페이지에 들어가도록 해설을 2문단 이내로 압축(문단당 4~5줄). ' +
      '마지막 문단 한 줄 때문에 다음 페이지로 넘어가지 않도록 문장을 줄여 fit.',
    filterItems: (items) => {
      const kw = [
        'freight', 'ocean', 'container', 'shipping', 'vessel', 'carrier',
        'SCFI', 'WCI', 'FBX', 'GRI', 'FAK', 'TEU', 'FEU',
        'blank sailing', 'alliance', 'Freightos',
        '운임', '해운', '선박', '선복', '선사', '컨테이너',
        'asia', 'europe', 'transpacific', 'intra-asia',
      ];
      return items.filter(i =>
        hasSubstance(i) && (
          i.category === 'lane_causal'    ||
          i.category === 'carrier_update' ||
          i.category === 'deep_analysis'  ||
          matches(i, kw)
        )
      );
    },
  },
  {
    id: 'air',
    title: '03. 항공 화물',
    focus:
      '항공 화물 운임·물동량 동향 — TAC/BAI 스냅샷, Superset 추세, IATA 권역별, Xeneta 분석. 아래 4개 소제목 구조 필수. ' +
      '## 03-1. TAC/BAI 항공 운임 스냅샷 — 제공된 BAI00·출발지별(홍콩·상하이·프랑크푸르트) WoW 스냅샷 표 기반 현황 서술. 표는 시스템 주입. ' +
      '## 03-2. 항공 운임 추세 — Superset 시계열 차트는 시스템 주입. 차트 미수집 시 "추세 차트 미수집" 정직 표기(수치 창작 금지). ' +
      '## 03-3. IATA 권역별 공급·수요·적재율 — 제공된 CTK·ACTK·CLF 권역별 표 기반 수요(CTK) vs 공급(ACTK) 증감·적재율 분석. 표는 시스템 주입. ' +
      '데이터 미수집 시 "IATA 데이터 미수집" 정직 표기 후 기사 기반 권역별 동향 서술. ' +
      '## 03-4. Xeneta 공개 운임 분석 — 제공된 Xeneta factText 수치 기반 주요 노선 운임 동향 서술 + 분석. 수치 없을 경우 생략. ' +
      '전자상거래·특송 수요, 성수기 공급 전망. ' +
      '각 소제목은 현상→원인→전망 산문(대괄호 라벨·영업 시사점 금지). ' +
      '★ 운임 수치 창작 절대 금지: 제공된 TAC Index(Superset)·BAI(aircargoweek.com)·Xeneta factText에 있는 수치만 사용. ' +
      '그 외 외부 운임 지수·데이터 소스 언급 및 수치 생성 금지.',
    filterItems: (items) => {
      const kw = [
        'air cargo', 'airfreight', 'air freight', 'TAC', 'IATA', 'BAI', 'Xeneta',
        'e-commerce', 'express', 'charter', 'belly', 'air rate',
        '항공', '에어카고', '특송', '국제항공',
      ];
      const EXCLUDE = ['fraud', 'scam', 'crime', '사기', 'north american rail', 'union pacific', 'deutsche bahn'];
      return items.filter(i =>
        hasSubstance(i) &&
        matches(i, kw) &&
        !EXCLUDE.some(k => `${i.title} ${i.summary_en || ''}`.toLowerCase().includes(k))
      );
    },
  },
  {
    id: 'rail',
    title: '04. 철도 시황 (TCR·TSR·유라시아)',
    focus:
      '중국 일대일로·中欧班列(중구반열)·TCR을 중심으로 한 유라시아 철도 시황 분석. 아래 2개 소제목 구조 필수. ' +
      '데이터 없는 항목은 "금월 데이터 미수집" 정직 표기. ' +
      '## 04-1. 중국-유럽 철도 (TCR·中欧班列·일대일로) — ' +
      '제공된 Landbridge factText의 수치(편수·물동량·货值·YoY)를 중심으로 서술. ' +
      '호르고스(霍尔果斯)·아라산쿠(阿拉山口)·만저우리(满洲里) 등 중국측 국경 통과량 포함. ' +
      '소스: China State Railway Group·RailFreight·CRCT·Landbridge·Xinhua 등. ' +
      '비교 가능한 핵심 수치 3개 이상이 있으면 도입 문단 뒤에 [[STATS: 값|라벨|up/down ; … :: 캡션(출처·기준일)]] 삽입. ' +
      '## 04-2. 러시아 TSR·중앙아 회랑 — RZD 동향, 러-중 국경, 중앙아시아 인프라(보조, 1개 단락 이내). ' +
      '각 소제목은 현상→원인→배경→전망 산문(대괄호 라벨·머리표 금지). ' +
      '특정 기업·영업 관점·행동 권유 없이 객관적 전망으로 마무리. ' +
      '시각자료 토큰: [[STATS:]]가 없는 소제목 블록에는 해당 블록 대표 출처 URL을 [[OGIMG: URL]] 한 줄로 삽입(도입 문단 뒤, 블록당 최대 1장). ' +
      '★ B-2 이벤트 게이팅: factText에 "B-2 혼잡 신호: ... 감지"가 있을 때만 혼잡 블록 작성. ' +
      '"B-2 혼잡 게이팅: ... 미감지"면 혼잡·적체·국경 지연 블록 완전 생략 — 정량(편수·물동량·货值 YoY)만으로 마무리. ' +
      '이벤트성 블록 일반 원칙: 파업·폐쇄·사고 등 "이벤트" 블록도 factText에 해당 월 근거가 있을 때만 기재. ' +
      '★ 중국어 번역 필수: Landbridge 등 중국어 소스의 모든 내용을 한국어로 번역한다. 출력에 한자(漢字)를 남기지 말 것. ' +
      '변환 규칙: 中欧班列→중국-유럽 화물열차(첫 등장만 필요 시 병기), 列→편(열차 수), 万→만, 货值/货値→화물가치, ' +
      '集装箱→컨테이너, 口岸→국경(통상구). 숫자·TEU·USD·%는 유지.',
    filterItems: (items) => {
      const INCLUDE = [
        'TCR','TSR','TITR','TMR','china-europe','china europe','중구반열','中欧班列',
        'belt and road','일대일로','silk road','block train','블록 트레인','중앙아시아','central asia',
        'kazakhstan','카자흐스탄','uzbekistan','우즈베키스탄','kyrgyz','키르기스',
        'khorgos','호르고스','alashankou','알라산쿠','알라샨커우','dostyk','도스틱',
        'manzhouli','만저우리','alataw','알라타우',
        'china state railway','CSRG','중국 철도','중국철도','chinese railway',
        'china rail freight','중구반열','中欧班列','railfreight','CRCT',
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
        if (!hasSubstance(i)) return false;
        const t = txt(i);
        if (EXCLUDE.some(k => t.includes(k.toLowerCase()))) return false;
        return i.section === 'rail' || INCLUDE.some(k => t.includes(k.toLowerCase()));
      });
    },
  },
  {
    id: 'region',
    maxItems: 25,
    title: '05. 지역별 이슈',
    focus:
      '한국·캐나다·유럽·독일 등 주요 지역 물류 이슈 — 항만 혼잡, 인프라 투자, ' +
      '포워딩 환경 변화, 공급망 재편 관련 지역 특화 이슈. ' +
      '시각자료 토큰: ① 소제목 블록에 비교 가능한 핵심 수치 3개 이상이 있으면 도입 문단 뒤에 [[STATS: 값|라벨|up/down ; … :: 캡션(출처·기준일)]] 한 줄 삽입(수치 3개 미만이면 생략, 수치는 본문과 반드시 일치). ② [[STATS:]]가 없는 소제목 블록에는 해당 블록 대표 출처 URL을 [[OGIMG: URL]] 한 줄로 삽입(도입 문단 뒤, 블록당 최대 1장). ' +
      '★ 지역별 이슈에서 미국(관세·CBP·USTR·항만·공급망) 관련 기사 1건 이상 반드시 포함.',
    filterItems: (items) => {
      const kw = [
        'Korea', 'Canada', 'Germany', 'EU', 'Europe', 'Japan',
        'United States', 'USA', 'America', 'USTR', 'CBP',
        'infrastructure', 'port', 'congestion', 'hub',
        '한국', '캐나다', '독일', '유럽', '일본', '미국',
        '항만', '인프라', '허브', '혼잡', '포워더',
      ];
      return items.filter(i => hasSubstance(i) && matches(i, kw));
    },
  },
  {
    id: 'macro',
    maxItems: 30,
    title: '06. 거시경제·지정학',
    focus:
      '글로벌 거시경제 및 지정학 리스크가 해운·물류에 미치는 영향. 아래 3개 소제목 구조 필수. ' +
      '지수 표·차트는 시스템이 자동 주입하므로 본문에 표나 수치를 그리지 말 것. ' +
      '## 06-1. 거시경제·지정학 리스크 — 미·중 무역 분쟁·관세·IEEPA, 지정학 긴장(호르무즈·홍해·수에즈), 유가·USD 동향. ' +
      '## 06-2. 컨테이너 물동량 현황 — 제공된 "컨테이너 항만 물동량 지수" 블록 기반 글로벌 처리량 동향. 표·차트는 시스템 주입. ' +
      '데이터 미수집 시 주요 항만·물류 기사 기반 물동량 방향성 서술. ' +
      '## 06-3. 수급 교차 분석 — 항만 물동량 지수 방향 vs 컨테이너 운임 방향(기사 수치 인용) 대비. ' +
      '운임↑·물동량↓ 시 "공급 조절(결항·감속) 주도" 해석, 운임↑·물동량↑ 시 "실수요 회복" 해석. 명사형 종결. ' +
      '시각자료 토큰: ① 소제목 블록에 비교 가능한 핵심 수치 3개 이상이 있으면 도입 문단 뒤에 [[STATS: 값|라벨|up/down ; … :: 캡션(출처·기준일)]] 한 줄 삽입(수치 3개 미만이면 생략, 수치는 본문과 반드시 일치). ② [[STATS:]]가 없는 소제목 블록에는 해당 블록 대표 출처 URL을 [[OGIMG: URL]] 한 줄로 삽입(도입 문단 뒤, 블록당 최대 1장).',
    filterItems: (items) => {
      const kw = [
        'tariff', 'trade war', 'sanction', 'geopolit',
        'Hormuz', 'Red Sea', 'Suez', 'oil', 'USD', 'macro',
        'supply chain', 'IEEPA',
        'throughput', 'cargo volume', 'container demand', 'volume',
        '관세', '무역전쟁', '제재', '지정학', '호르무즈', '홍해', '유가',
        '원자재', '환율', '무역', '공급망', '물동량', '처리량', '수요',
      ];
      return items.filter(i => hasSubstance(i) && matches(i, kw));
    },
  },
];

module.exports = SECTIONS;
