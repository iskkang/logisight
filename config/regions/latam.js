// 남미 권역 — 한국 자원수입·이차전지 공급망 관점
module.exports = {
  region: 'latam',
  label: '남미',
  geoKeywords: [
    'Brazil','브라질','Chile','칠레','Peru','페루','Argentina','아르헨티나','Colombia','콜롬비아',
    'Santos','산토스','Paranagua','파라나구아','Valparaiso','발파라이소','San Antonio',
    'lithium','리튬','copper','구리','iron ore','철광석',
  ],
  koreaAnchors: [
    'lithium','리튬','이차전지 원료','battery raw material','POSCO','포스코','LG','Samsung','삼성',
    'iron ore','철광석','grain','곡물','copper','구리','nickel','니켈',
    '한국발','한국향','Korean importer','부산',
  ],
  priorityTopics: [
    '리튬·구리 등 배터리 원료 공급',
    '브라질 철광·곡물 수출',
    '남미 주요 항만',
    '한국 자원 수입 흐름',
  ],
  excludeKeywords: ['celebrity','연예','스포츠','football','soccer'],
  promptFocus: [
    '남미(브라질·칠레) 물류를 한국 자원수입·이차전지 공급망 관점에서 분석한다.',
    '리튬·구리·철광·곡물 흐름과 주요 항만을 우선한다.',
    '현상→원인→배경→전망 4단계. 권고가 아닌 "무엇을 왜 주시할지".',
  ].join(' '),
  extraSources: [],
};
