// Score weights and thresholds. Tune here; pure logic modules should not
// duplicate these constants.
const EVENT_BASE_SCORE = {
  embargo: 90,
  derailment: 80,
  line_out_of_service: 80,
  service_interruption: 60,
  service_advisory: 45,
  congestion: 35,
  terminal_dwell: 40,
  stb_speed_decline: 25,
  weather: 20,
  construction: 20,
  normal_update: 0,
  unknown: 0,
};

const SCOPE_MULTIPLIER = {
  specific: 1.0,
  origin_wide: 0.8,
  carrier_wide: 0.5,
  none: 0,
};

const STATUS_THRESHOLDS = [
  { min: 80, status: 'severe' },
  { min: 55, status: 'delayed' },
  { min: 30, status: 'watch' },
];

module.exports = {
  EVENT_BASE_SCORE,
  SCOPE_MULTIPLIER,
  STATUS_THRESHOLDS,
};
