const STB_PAGE = 'https://www.stb.gov/reports-data/rail-service-data/';
const STB_CARRIERS = ['BNSF', 'UP', 'CN'];

const STB_CARRIER_CORRIDORS = {
  BNSF: ['LALB_CHI_BNSF'],
  UP: ['LALB_CHI_UP', 'LALB_DAL_UP'],
  CN: ['VAN_TOR_CN', 'PRR_CHI_CN'],
};

const STB_CHICAGO_CORRIDORS = {
  BNSF: ['LALB_CHI_BNSF'],
  UP: ['LALB_CHI_UP'],
  CN: ['PRR_CHI_CN'],
};

const STB_THRESHOLDS = {
  speedDeclinePct: { watch: 5, delayed: 10 },
  dwellIncreasePct: { watch: 15, delayed: 30 },
};

const STB_STATUS_SCORE = { watch: 30, delayed: 55 };

module.exports = {
  STB_PAGE,
  STB_CARRIERS,
  STB_CARRIER_CORRIDORS,
  STB_CHICAGO_CORRIDORS,
  STB_THRESHOLDS,
  STB_STATUS_SCORE,
};
