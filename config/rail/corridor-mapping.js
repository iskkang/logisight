// Human-reviewed corridor mapping rules. Update tokens here first; rule logic
// and scoring consume this config instead of hard-coding corridor knowledge.
const CORRIDOR_RULES = [
  {
    code: 'LALB_CHI_BNSF',
    railroads: ['BNSF'],
    coverage: 'bnsf',
    origin: ['los angeles', 'long beach', 'la/lb', 'san pedro'],
    routeLandmarks: ['southern transcon', 'transcon', 'barstow', 'needles', 'flagstaff', 'belen', 'amarillo', 'marceline', 'fort madison'],
    destination: ['chicago'],
  },
  {
    code: 'LALB_CHI_UP',
    railroads: ['UP', 'union pacific'],
    coverage: null,
    origin: ['los angeles', 'long beach', 'la/lb', 'san pedro'],
    routeLandmarks: ['overland route', 'las vegas', 'salt lake', 'cheyenne', 'north platte', 'omaha'],
    destination: ['chicago'],
  },
  {
    code: 'LALB_DAL_UP',
    railroads: ['UP', 'union pacific'],
    coverage: null,
    origin: ['los angeles', 'long beach', 'la/lb', 'san pedro'],
    routeLandmarks: ['sunset route', 'tucson', 'el paso'],
    destination: ['dallas'],
  },
  {
    code: 'VAN_TOR_CN',
    railroads: ['CN', 'canadian national'],
    coverage: 'cn',
    origin: ['vancouver'],
    routeLandmarks: ['kamloops', 'edmonton', 'winnipeg', 'thunder bay'],
    destination: ['toronto'],
  },
  {
    code: 'PRR_CHI_CN',
    railroads: ['CN', 'canadian national'],
    coverage: 'cn',
    origin: ['prince rupert', 'fairview'],
    routeLandmarks: ['prince george', 'edmonton', 'winnipeg', 'duluth'],
    destination: ['chicago'],
  },
];

// Port dwell maps to origin-side corridors. No severity is implied here.
const PORT_ORIGIN_MAP = {
  pola: ['LALB_CHI_BNSF', 'LALB_CHI_UP', 'LALB_DAL_UP'],
  polb: ['LALB_CHI_BNSF', 'LALB_CHI_UP', 'LALB_DAL_UP'],
  prince_rupert: ['PRR_CHI_CN'],
  vancouver: ['VAN_TOR_CN'],
};

const ALL_CORRIDORS = CORRIDOR_RULES.map((rule) => rule.code);

module.exports = { CORRIDOR_RULES, PORT_ORIGIN_MAP, ALL_CORRIDORS };
