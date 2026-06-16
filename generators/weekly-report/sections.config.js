'use strict';
// 주간 리포트 5섹션 고정. table: 'ocean'|'air'|'summary'|null (코드 주입 표 종류).
const SECTIONS = [
  {
    id: 'overview', title: '1. 주간 글로벌 시황 정리', table: 'summary',
    keywords: ['hormuz', 'iran', 'rate', 'scfi', 'kcci', 'tariff', 'blank', 'market pulse'],
  },
  {
    id: 'ocean', title: '2. 해상', table: 'ocean',
    keywords: ['freight', 'rate', 'scfi', 'kcci', 'wci', 'ccfi', 'bdi', 'container',
      'blank sailing', 'surcharge', 'pss', 'fak', 'gri', 'hormuz', 'red sea',
      'cma', 'maersk', 'msc', 'hapag', 'cosco', 'market pulse', 'capacity'],
  },
  {
    id: 'air', title: '3. 항공', table: 'air',
    keywords: ['air cargo', 'airfreight', 'air freight', 'iata', 'tac', 'bai',
      'belly', 'charter', 'express', 'e-commerce', 'capacity', 'demand', 'cargolux'],
  },
  {
    id: 'logistics', title: '4. 물류 사업 전반', table: null,
    keywords: ['acqui', 'merger', 'm&a', 'invest', 'digital', 'forwarder',
      'integrat', 'subsidiary', 'partnership', 'logistics provider', '3pl'],
  },
  {
    id: 'trade', title: '5. 무역', table: null,
    keywords: ['tariff', 'trade', 'sanction', 'iran', 'geopolit', 'policy',
      'customs', 'export control', 'panama', 'reflag', 'wto', 'fta', 'ustr', 'cbp'],
  },
];
module.exports = SECTIONS;
