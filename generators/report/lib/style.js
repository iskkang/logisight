'use strict';
const fs   = require('fs');
const path = require('path');

const STYLE_PATH = path.resolve(__dirname, '../MONTHLY_REPORT_STYLE.md');

function loadStyleGuide() {
  if (!fs.existsSync(STYLE_PATH)) {
    console.warn('⚠️ MONTHLY_REPORT_STYLE.md 없음 — 기본 톤으로 생성됨');
    return '';
  }
  return fs.readFileSync(STYLE_PATH, 'utf-8');
}

module.exports = { loadStyleGuide };
