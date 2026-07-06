'use strict';
// generators/report/lib/forecast-store.js
// 월간 리포트 [전망] 클레임 저장/로드 — content/monthly-report/<month>/forecasts.json
// 다음 달 스코어카드(T4)가 실제 지수와 대조 판정하는 데 쓰는 시드 데이터.

const fs   = require('fs');
const path = require('path');

function forecastsPath(month) {
  return path.resolve(__dirname, '../../../content/monthly-report', month, 'forecasts.json');
}

function saveForecasts(month, claims) {
  const filePath = forecastsPath(month);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(claims, null, 2) + '\n', 'utf-8');
  return filePath;
}

function loadForecasts(month) {
  const filePath = forecastsPath(month);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(data) ? data : null;
  } catch (_e) {
    return null;
  }
}

module.exports = { saveForecasts, loadForecasts, forecastsPath };
