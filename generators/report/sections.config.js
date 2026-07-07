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
    title: '01. 핵심지표 & 시황 총론',
    focus:
      '이번 달 가장 중요한 단일 핵심 이슈 1개를 선정하고, 전체 해운·물류 시황을 총론으로 정리. ' +
      '[이번 달 핵심]은 이슈 1개 / 문장 1개 / 현상…원인…전망 구조 / 말줄임표 최대 1개 / 명사형 종결 필수. ' +
      '★ 본 섹션은 리포트에서 마지막에 생성됨 — 프롬프트의 [본 리포트 각 섹션의 핵심] 다이제스트를 종합해 ' +
      '이달을 관통하는 단일 프레임을 제시하고, 해운-항공-철도-거시 간 연결(모드 간 파급)을 최소 1개 서술. ' +
      '뉴스 재요약이 아니라 섹션들이 확정한 사실의 상위 종합. 수치는 주입된 운임 지수 표의 값만 인용. ' +
      '스코어카드가 주입되면 "지난달 전망 점검" 소제목으로 표와 1문단 해설(적중·빗나감 모두 서술, 변명 금지) 포함.',
    filterItems: (items) => items.filter(i => i.category === 'deep_analysis').slice(0, 5),
  },
  {
    id: 'ocean',
    title: '02. 해운 시황',
    focus:
      '컨테이너·건화물 운임 시황. 아래 9개 소제목 구조 필수. ' +
      '지수 표·차트는 시스템이 자동 주입하므로 본문에 표나 수치를 그리지 말 것. ' +
      '제공된 "해운 운임 지수" 데이터의 수치만 인용하고, 그 외 운임 수치 창작 금지. ' +
      '## 02-1. KCCI (한국형 컨테이너 운임지수) — KCCI 종합 및 13개 항로 등락, 한국 수출입 운임 시사점. ' +
      '## 02-2. SCFI (상하이 컨테이너운임지수) — 아시아-북미·유럽·동안 항로 등락 현황. ' +
      '## 02-3. CCFI (중국 컨테이너운임지수) — 중국 수출 컨테이너 시장 전반 동향. ' +
      '계약-스팟 갭·전이 시차 수치가 주입되면 그 수치로 전이 속도를 서술(창작 금지). ' +
      '## 02-4. WCI (드류리 세계 컨테이너 운임지수) — 주요 항로 현물 운임(USD/FEU) 월간 추이. ' +
      '## 02-5. BDI (건화물선운임지수) — 건화물 시황 및 컨테이너 시장 선행 시사점. ' +
      '## 02-6. 블랭크 세일링(결항) — Drewry Cancelled Sailings Tracker 기반 향후 5주 예정 출항·결항 편수·결항률. ' +
      '미래 전망 구간임을 명확히 서술하고, 결항률↔유효 선복↔KCCI/SCFI 운임 수급 연계 서술. ' +
      'Drewry 공개 헤드라인 미수집 시 02-6 블록 생략. 대체 proxy 수치 생성 금지. ' +
      '## 02-7. 역내(Intra-Asia) 운임 — KCCI 역내 항로(중국·일본·동남아) 기반 역내 운임 동향. ' +
      '글로벌 운임과의 디커플링 여부, 역내 수요·공급 시사점. 데이터 미수집 시 생략. ' +
      '## 02-8. 벙커유 가격 추이 — 시스템이 주입하는 벙커유 차트의 위치를 확보. KITA 참고운임과 별도 블록으로 유지. ' +
      '## 02-9. KITA 부산발 해상 운임 — 제공된 "KITA 해상 참고운임" factText의 부산발 TEU/FEU 참고운임을 ' +
      'KCCI·SCFI(중국 상하이발 기준)와 대비해 한국 수출 화주 관점의 운임 차이·시사점을 1문단으로 서술. ' +
      'KITA 수치 미제공 시 02-9 블록 통째로 생략 — 운영 문구 금지. 표·차트는 시스템 주입(본문에 표 금지). ' +
      '각 지수는 현상에서 원인·전망으로 자연스럽게 이어지는 산문으로 서술(대괄호 라벨·머리표 금지). ' +
      '각 페이지는 다른 지수/페이지를 최소 1회 참조하고 [전망]으로 마무리. `➔`/`☞` 시사점·행동 권고 라인 금지(스타일 가이드 §5). 특정 회사 영업 문구 금지. 항로 등락 원인은 주어진 기사에 근거. ' +
      '분량 엄수: 02-1부터 02-9까지는 페이지 밀도를 기준으로 배치. 표·차트 행 수가 많은 주제는 해설을 먼저 줄이고, 내용 밀도가 낮은 인접 주제는 2열 병합 가능. 02-5+02-6과 02-7+02-8은 각각 한 페이지 병합을 전제로 각 블록을 2문단 이내로 압축. ' +
      '★ 소제목은 반드시 "## 02-N." 개별 형식 — "## 02-7+02-8." 같은 병합 제목 절대 금지(병합 배치는 시스템 렌더러 담당, 제목을 합치면 표·차트 주입이 깨짐). ' +
      '02-1 KCCI와 02-9 KITA는 표가 길므로 해설 1~2문단, 700자 이내. 02-2·02-4·02-7은 해설 2문단, 900자 이내. ' +
      '02-3은 해설 2~3문단, 1,100자 이내. 02-5·02-6·02-7·02-8은 병합 배치를 위해 각 2문단, 750자 이내. ' +
      '관련 기사 근거가 부족하면 숫자·원인을 창작하지 말고 확인 가능한 범위만 서술. 마지막 문단 한 줄 때문에 다음 페이지로 넘어가지 않도록 문장을 줄여 fit.',
    topicGuides: [
      { id: '02-1', title: 'KCCI', target: '긴 표: 핵심 원양·역내 대비만 압축', keywords: ['KCCI', 'KOBC', 'korea', 'peak season', 'container freight'] },
      { id: '02-2', title: 'SCFI', target: '아시아-북미·유럽 현물 흐름 중심', keywords: ['SCFI', 'shanghai', 'transpacific', 'asia-us', 'asia-europe'] },
      { id: '02-3', title: 'CCFI', target: '현물 대비 계약 운임 전이 분석', keywords: ['CCFI', 'contract rate', 'spot rate', 'china export', 'container freight'] },
      { id: '02-4', title: 'WCI', target: 'Drewry 항로별 차별화 분석', keywords: ['WCI', 'world container index', 'drewry', 'shanghai-rotterdam', 'shanghai-los angeles'] },
      { id: '02-5', title: 'BDI', target: '건화물 수급과 컨테이너 시사점', keywords: ['BDI', 'dry bulk', 'capesize', 'panamax', 'bulk carrier'] },
      { id: '02-6', title: '블랭크 세일링', target: '짧은 표: 공급 관리·신뢰도 분석 보강', keywords: ['blank sailing', 'cancelled sailing', 'capacity management', 'schedule reliability', 'rolled'] },
      { id: '02-7', title: '역내 운임', target: '원양 대비 탈동조화 여부 분석', keywords: ['intra-asia', 'regional cargo', 'feeder', 'southeast asia', 'bunker costs'] },
      { id: '02-8', title: '벙커유', target: '차트 중심: 연료비·할증·지정학 분석 보강', keywords: ['bunker', 'VLSFO', 'HSFO', 'fuel cost', 'fuel surcharge', 'hormuz'] },
      { id: '02-9', title: 'KITA 부산발 해상 운임', target: '긴 표: 한국발 권역 차이만 압축', keywords: ['busan', 'korea export', 'long beach', 'rotterdam', 'singapore', 'dubai'] },
    ],
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
      '항공 화물 운임·물동량 동향 — 표·차트는 시스템이 자동 주입하므로 본문에 표를 그리지 말 것(중복 표 금지). IATA 권역별 통계를 최우선으로 정리하고, KITA 한국발 참고운임과 TAC/BAI 보조 추세를 순서대로 배치. 아래 3개 소제목 구조 필수. ' +
      '## 03-1. IATA 권역별 공급·수요·적재율 — 제공된 CTK·ACTK·CLF 권역별 표 기반 수요(CTK) vs 공급(ACTK) 증감·적재율 분석. 표는 시스템 주입. ' +
      '## 03-2. KITA 인천발 항공 운임 — 제공된 KITA 항공 참고운임 factText 기반 한국발 노선 동향 서술. 표·차트는 시스템 주입. ' +
      '## 03-3. TAC/BAI 항공 운임 보조 추세 — Superset 시계열 차트와 BAI00·출발지별 스냅샷은 시스템 주입. 차트 미주입 시 가용 지표(BAI·제트유)와 기사 기반으로 자연스럽게 서술 — "미수집/실패" 등 운영 문구 절대 금지(수치 창작도 금지). ' +
      '★ 03-3 서술은 이슈 나열 금지: 가장 중요한 이슈 1~2개만 골라 [현상][원인][배경][전망] 심층 전개, 나머지 기사는 버림. ' +
      'IATA 데이터 미주입 시 03-1 정량 블록 없이 기사 기반 권역별 동향만 서술 — 운영 문구 금지. ' +
      '전자상거래·특송 수요, 성수기 공급 전망. ' +
      '03-2와 03-3은 각각 별도 페이지로 배치(병합 안 함). ★ 소제목은 반드시 "## 03-2."와 "## 03-3." 개별 형식 — 병합 제목(03-2+03-3) 절대 금지(병합 배치는 시스템 렌더러 담당). 도쿄 노선은 표에서 제외되며, 각 블록 해설은 2문단 이내로 압축. ' +
      '표·차트가 긴 페이지는 분석 문장을 줄이고, 마지막 한 문장이 다음 페이지로 넘어가면 실패로 간주. ' +
      '각 소제목은 현상→원인→배경→전망 산문(대괄호 라벨 금지)으로 쓰고 [전망]으로 마무리 — `➔`/`☞` 시사점·행동 권고 금지(스타일 가이드 §5). ' +
      '★ 운임 수치 창작 절대 금지: 제공된 KITA 참고운임·TAC Index(Superset)·BAI(aircargoweek.com)에 있는 수치만 사용. ' +
      '그 외 외부 운임 지수·데이터 소스 언급 및 수치 생성 금지.',
    filterItems: (items) => {
      const kw = [
        'air cargo', 'airfreight', 'air freight', 'TAC', 'IATA', 'BAI',
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
      '데이터 없는 항목은 해당 블록을 통째로 생략 — "미수집" 등 운영 문구 절대 금지. ' +
      '## 04-1. 중국-유럽 철도 (TCR·中欧班列·일대일로) — ' +
      '제공된 Landbridge factText의 수치(편수·물동량·货值·YoY)를 중심으로 서술. ' +
      '호르고스(霍尔果斯)·아라산쿠(阿拉山口)·만저우리(满洲里) 등 중국측 국경 통과량 포함. ' +
      '소스: China State Railway Group·RailFreight·CRCT·Landbridge·Xinhua 등. ' +
      '비교 가능한 핵심 수치 3개 이상이 있으면 도입 문단 뒤에 [[STATS: 값|라벨|up/down ; … :: 캡션(출처·기준일)]] 삽입. ' +
      '## 04-2. 러시아 TSR·중앙아 회랑 — RZD 동향, 러-중 국경, 중앙아시아 인프라. 정량 수치 3개 이상이면 [[STATS: 값|라벨|up/down ; ... :: 출처]] 카드 삽입. ' +
      '## 04-3. {이달 최대 철도 이슈의 헤드라인} — 제공된 기사 중 가장 중요한 단일 이슈를 골라 심층 분석. ' +
      '소제목 자체를 그 이슈의 의역 헤드라인(명사형, 28자 안팎)으로 작성 — "이달의 주요 기사" 같은 무내용 제목 금지(스타일 가이드 §13-6). ' +
      '★ 04-3은 04-1·04-2에서 이미 다룬 주제(예: 동일 회랑·동일 노선)와 겹치지 않는 별개 이슈를 선정 — 같은 이슈의 3번째 반복 금지. ' +
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
      '★ 큐레이션 기준(엄수): 한국 화주·포워더의 비용·리드타임·규제 리스크에 "직접" 영향을 주는 이슈만 선정 — 주요 교역권(북미·유럽·중국·동남아·중동)의 항만 정책·관세·대형 항로 개편·물동량 구조 변화 급. 외교·보안 협력 MOU, 소규모 단일 서비스 개설(주 1항차 급), 지역 지원 프로그램 발표 같은 마이크로 이슈는 제외. 후보가 부족하면 4건 미만으로 줄여도 됨(잡보로 채우지 말 것). ' +
      '단일 기업의 시설 투자·경미한 운영권 연장·지역 소식성 잡보는 제외. 각 이슈는 왜 이달에 중요한지 첫 문장에서 명시. ' +
      '선정 이슈는 2문단 스침이 아니라 [현상][배경][전망] 심층으로 서술. ' +
      '시각자료 토큰: ① 소제목 블록에 비교 가능한 핵심 수치 3개 이상이 있으면 도입 문단 뒤에 [[STATS: 값|라벨|up/down ; … :: 캡션(출처·기준일)]] 한 줄 삽입(수치 3개 미만이면 생략, 수치는 본문과 반드시 일치). ② [[STATS:]]가 없는 소제목 블록에는 해당 블록 대표 출처 URL을 [[OGIMG: URL]] 한 줄로 삽입(도입 문단 뒤, 블록당 최대 1장). ' +
      '★ 지역별 이슈에서 미국(관세·CBP·USTR·항만·공급망) 관련 기사 1건 이상 반드시 포함. ' +
      '지역 이슈들은 일반 플로우로 이어 쓰며(병합 페이지 아님), 각 이슈는 2~3문단으로 서술. ' +
      '★ 각 이슈 블록의 구조 고정: 소제목(반드시 "### 05-N. 헤드라인" 번호 형식) → 도입 문단 → 시각 요소 1개(수치 3개 이상이면 [[STATS:]], 아니면 원기사 URL로 [[OGIMG: URL]] — 반드시 해당 이슈의 실제 기사 URL) → 분석·전망 문단. 시각 요소 없는 텍스트 슬래브 금지. ' +
      '동일 출처의 같은 이미지(기관 로고류)가 여러 블록에 반복되지 않도록 블록마다 서로 다른 기사 URL 사용(시스템이 중복 이미지를 자동 제거함).',
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
      '★ 거시 결론의 근거 규칙: 단일 기업 사례(예: 특정 화주의 비용 발표)를 시장 전체 결론의 근거로 쓰지 말 것 — 보조 예시로 1회만 허용. ' +
      '거시 지표 인용 시 지표명·발표 기관·기준월을 반드시 병기(예: "S&P Global 미국 제조업 PMI, 2026-06"). ' +
      '지수 표·차트는 시스템이 자동 주입하므로 본문에 표나 수치를 그리지 말 것. ' +
      '## 06-1. 거시경제·지정학 리스크 — 미·중 무역 분쟁·관세·IEEPA, 지정학 긴장(호르무즈·홍해·수에즈), 유가·USD 동향. ' +
      '## 06-2. 컨테이너 물동량 현황 — 제공된 "컨테이너 항만 물동량 지수" 블록 기반 글로벌 처리량 동향. 표·차트는 시스템 주입. ' +
      '물동량 지수 미주입 시 주요 항만·물류 기사 기반으로 방향성만 서술 — "미수집" 등 운영 문구 절대 금지. ' +
      '06-1·06-2는 병합 페이지 대상이므로 각각 분석 본문 3문단 이상([현상][배경][전망])으로 밀도 유지(스타일 가이드 §13-1-2 분량 하한). ' +
      '## 06-3. 수급 교차 분석 — 항만 물동량 지수 방향 vs 컨테이너 운임 방향(기사 수치 인용) 대비. ' +
      '운임↑·물동량↓ 시 "공급 조절(결항·감속) 주도" 해석, 운임↑·물동량↑ 시 "실수요 회복" 해석. 명사형 종결. ' +
      '혼잡-운임 교차 신호 판정이 주입되면 이를 수급 판정의 1차 근거로 사용. ' +
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
  {
    id: 'closing',
    title: '07. 이달의 프레임 — 맺음말',
    focus:
      '리포트 전체를 닫는 5문단 에세이. 표·차트·소제목 없이 산문만 — 본문에 표 절대 금지. ' +
      '재료는 두 가지뿐: [본 리포트 각 섹션의 핵심] 다이제스트와 [파생 지표] 수치. ' +
      '★ 재료에 없는 회사명·인명·협상 조건·인프라 사업 등 새 사실·수치 도입은 그럴듯해도 전부 실격(창작 판정) — 모델 자체 지식 사용 금지. ' +
      '★ 해석 렌즈(스타일 가이드 §13-7)를 반드시 적용 — 파생 지표를 숫자 재진술이 아니라 ' +
      '"시장 참여자(선사·화주)가 지금 무엇을 확신하고 움직이는가"로 변환해 서술. ' +
      '구조: 1문단 = 이달을 규정하는 단일 프레임 선언(예: 공급충격의 계약화). ' +
      '2~3문단 = 그 프레임을 파생 지표 2~3개로 입증. ★각 문단에 [파생 지표] 블록의 수치를 반드시 1개 이상 원문 그대로 인용(예: 스프레드 값, CCFI/SCFI %, 전이 시차 N주, 공시 갭 %, 탈동조화 %p, 벙커 괴리 %p) 후 렌즈로 해석 — 수치 인용 없이 렌즈 용어("전이 시차 단축" 등)만 차용하는 것은 실격. ' +
      '4문단 = 프레임에 반하는 신호 1개를 정직하게 제시(반증 가능성 — 물동량 보합 등). ' +
      '5문단 = 다음 달 이 프레임의 유지/붕괴를 판별할 관전 트리거 2~3개(구체 지표+임계값, 권고 아님). ' +
      '전 문단 명사형 종결 — "~이다." "~한다." "~점이다." 등 평서체 종결 절대 금지(명사형·"~하는 중"·"~할 전망"만). 권고 금지(§5). 각 문단 3~5문장. 제목(# 07...)은 시스템이 붙이므로 본문만.',
    filterItems: (items) => items.filter(i => i.category === 'deep_analysis').slice(0, 3),
  },
];

module.exports = SECTIONS;
