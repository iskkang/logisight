// 극동/러시아·CIS 권역 — MTL 핵심 권역
module.exports = {
  region: 'russia',
  label: '극동(러시아·CIS)',
  geoKeywords: [
    'Far East','극동','Eurasia','유라시아',  // 일반 권역어
    'Russia','러시아','Vladivostok','블라디보스토크','TSR','Trans-Siberian','시베리아횡단철도',
    'Vostochny','보스토치니','Moscow','모스크바','CIS','Kazakhstan','카자흐스탄',
    'Uzbekistan','우즈베키스탄','sanctions','제재','rerouting','우회','Central Asia','중앙아시아',
    // 주체앵커 보강: 러시아·CIS·중앙아 허브 도시·항만·기업
    'St. Petersburg','상트페테르부르크','Novorossiysk','노보로시스크','Nakhodka','나홋카',
    'Almaty','알마티','Tashkent','타슈켄트','Astana','아스타나','Baku','바쿠','Tbilisi','트빌리시',
    'Minsk','민스크','Belarus','벨라루스','Mongolia','몽골','Khorgos','호르고스','Dostyk','도스틱','FESCO','페스코',
  ],
  broadGeo: ['Far East', '극동', 'Eurasia', '유라시아', 'CIS', 'Central Asia', '중앙아시아'],  // 광역어 — 주체 판정에서 제외
  koreaAnchors: [
    '한국발','한국향','부산','TSR','CIS 환적','transshipment','중앙아시아 운임',
    '제재 우회','parallel import','평행수입','Korean cargo','MTL',
  ],
  policyAnchors: [
    '제재','sanctions','price cap','수출통제','export control','이중용도','dual-use',
    '우회수출','관세','tariff','쿼터','quota','무역장벽','trade barrier',
    '규제','regulation','수입규제','수출규제','수출금지','embargo','통관',
  ],
  tradeAnchors: [
    '무역량','trade volume','물동량','throughput','수출입','exports','imports',
    '교역량','TEU','container volume','수출 증가','수출 감소','통관량',
    'customs volume','교역 규모','bilateral trade',
    '무역','수입','수출','교역','대러 교역','대러 수출',
  ],
  priorityTopics: [
    'TSR 운임·운행 동향',
    '블라디보스토크 항만',
    '제재 하 물류 우회 경로',
    'CIS/중앙아시아 연계 운송',
    '한-러 잔존 교역 흐름',
  ],
  excludeKeywords: ['celebrity','연예','스포츠'],
  promptFocus: [
    '러시아·CIS 물류를 한국 및 중앙아시아 화주 관점에서 분석한다.',
    'TSR, 블라디보스토크, 제재 우회 경로, CIS/중앙아 환적을 우선한다. MTL의 핵심 권역임을 전제한다.',
    '현상→원인→배경→전망 4단계. 권고가 아닌 "무엇을 왜 주시할지".',
  ].join(' '),
  extraSources: [], // Landbridge(yaowen/kouan/russiainfo) 기존 보유 — 통합 검토
};
