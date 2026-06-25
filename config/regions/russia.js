// 극동/러시아·CIS 권역 — MTL 핵심 권역
module.exports = {
  region: 'russia',
  label: '극동(러시아·CIS)',
  geoKeywords: [
    'Russia','러시아','Vladivostok','블라디보스토크','TSR','Trans-Siberian','시베리아횡단철도',
    'Vostochny','보스토치니','Moscow','모스크바','CIS','Kazakhstan','카자흐스탄',
    'Uzbekistan','우즈베키스탄','sanctions','제재','rerouting','우회','Central Asia','중앙아시아',
  ],
  koreaAnchors: [
    '한국발','한국향','부산','TSR','CIS 환적','transshipment','중앙아시아 운임',
    '제재 우회','parallel import','평행수입','Korean cargo','MTL',
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
