// 유럽 권역 — 한국 화주·제조사 관점
module.exports = {
  region: 'europe',
  label: '유럽',
  geoKeywords: [
    'Europe','유럽','European Union','EU','Eurozone',  // 일반 권역어 (국가·항만명만으론 '미주·유럽 노선' 등 누락)
    'Poland','폴란드','Hungary','헝가리','Czech','체코','Germany','독일',
    'UK','United Kingdom','영국','France','프랑스','Netherlands','네덜란드',
    'Belgium','벨기에','CEE','동유럽','중동부유럽',
    'Rotterdam','로테르담','Hamburg','함부르크','Antwerp','안트베르펜',
    'Felixstowe','Le Havre','Gdansk','그단스크','North Sea','Rhine','라인강',
    // 주체앵커 보강: 허브 도시·항만·유럽계 물류기업
    'Frankfurt','프랑크푸르트','Munich','뮌헨','Stuttgart','슈투트가르트','Duisburg','뒤스부르크',
    'Piraeus','피레우스','Valencia','발렌시아','Algeciras','알헤시라스','Bremerhaven','브레머하펜',
    'Zeebrugge','제브뤼헤','Barcelona','바르셀로나','Genoa','제노바','밀라노','마드리드',
    '바르샤바','부다페스트','프라하','Lufthansa','루프트한자','Hapag-Lloyd','하파크로이드',
  ],
  broadGeo: ['Europe', '유럽', 'European Union', 'EU', 'Eurozone'],  // 광역어 — 주체 판정에서 제외
  koreaAnchors: [
    'LG Energy Solution','LG에너지솔루션','Samsung SDI','삼성SDI',
    'SK On','SK온','Hyundai','현대차','Kia','기아','POSCO','포스코','Hanwha','한화',
    'battery','배터리','이차전지','EV','전기차','semiconductor','반도체','K-배터리',
    'Wroclaw','브로츠와프','Komarom','코마롬','God','괴드',
    'Korea-EU','한-EU','한국발','한국향','Korean shipper','Korean exporter','부산',
  ],
  policyAnchors: [
    '관세','tariff','반덤핑','anti-dumping','수출통제','export control','제재','sanctions',
    '쿼터','quota','보조금','subsidy','무역장벽','trade barrier','FTA','관세인상',
    'CBAM','탄소국경','EUDR','공급망실사','CSDDD','Foreign Subsidies',
  ],
  tradeAnchors: [
    '무역량','trade volume','물동량','throughput','수출입','exports','imports',
    '교역량','TEU','container volume','수출 증가','수출 감소','통관량',
    'customs volume','교역 규모','bilateral trade',
  ],
  priorityTopics: [
    'CEE 배터리/EV 공급망 (폴란드·헝가리 클러스터)',
    'North Sea 게이트웨이 항만 혼잡 (로테르담·함부르크·안트베르펜)',
    '라인강 수위·내륙운송',
    '홍해 우회가 유럽 도착에 미치는 영향',
    '한-EU 교역·관세 동향',
  ],
  excludeKeywords: ['football','soccer','celebrity','연예','스포츠'],
  promptFocus: [
    '유럽 권역의 물류·교역을 그 자체로 분석한다.',
    'CEE 배터리/EV 클러스터(폴란드·헝가리) 공급망, North Sea 게이트웨이 항만(로테르담·함부르크·안트베르펜), EU 무역·규제를 우선한다.',
    '현상→원인→배경→전망 4단계. 권고가 아닌 "무엇을 왜 주시할지".',
  ].join(' '),
  extraSources: [], // TODO: 유럽 특화 피드 추후 추가
};
