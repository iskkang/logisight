'use strict';
// 권역 배정: 거시/지수/전세계 라운드업은 강제 글로벌, 권역은 "주체" 게이트(제목+리드 지역특화 앵커 + 지배성 마진).
// 단순 본문 언급(스침)은 권역 배정 불가 — 그 국가/기업/항만이 주인공인 기사만 권역으로.
const { scoreArticle, matches } = require('./region-filter');

const REGIONS = ['europe', 'americas', 'russia', 'latam'];
const PRIORITY = ['russia', 'europe', 'americas', 'latam'];   // 동률 시 우선순위(MTL 핵심 권역 우선)

// 거시·지수·전세계 라운드업 = 권역 리포트 제외(글로벌 위클리 소관)
const MACRO_EXCLUDE = [
  // 운임 지수
  'SCFI', 'KCCI', 'WCI', 'CCFI', 'BDI', 'FBX', 'XSI', '운임지수', '운임 지수',
  '컨운임지수', '복합운임지수', 'freight index', 'freight rate index',
  // 항공 거시 데이터
  'WorldACD', '월드에이씨디', '월드에이시디', 'IATA', 'CTK', 'ACTK', '적재율',
  // 글로벌 범위 신호
  '글로벌', 'global', '전 세계', '전세계', '월드와이드', 'worldwide',
  '전 권역', '모든 권역', '각 지역', '지역별', '전 노선',
];

function textOf(a) {
  return [a.title || '', a.summary || a.description || '', a.content || ''].join(' ').toLowerCase();
}
function headText(a) {
  const lead = a.summary || a.description || (a.content || '').slice(0, 160);
  return ((a.title || '') + ' ' + lead).toLowerCase();
}

// 다국가/다권역 나열(라운드업): 4개 이상 권역/대륙 언급 → 글로벌
function multiRegionRoundup(a) {
  const t = textOf(a);
  const zones = ['유럽', 'europe', '미주', '북미', 'americas', 'north america',
    '아시아', 'asia', '중동', 'middle east', '아프리카', 'africa',
    '중남미', '남미', 'latin', '러시아', 'russia'];
  const hit = new Set();
  for (const z of zones) if (t.includes(z)) hit.add(z.replace(/\s/g, ''));
  return hit.size >= 4;
}

function isMacro(a) {
  const head = headText(a);   // 거시 신호는 제목+리드 기준(본문 한 줄 'global' 오탐 방지)
  return MACRO_EXCLUDE.some((k) => matches(head, k)) || multiRegionRoundup(a);
}

// 제목+리드에 있는 지역-특화 앵커 수(광역어 broadGeo 제외, 단어경계 매칭)
function subjectHits(a, cfg) {
  const head = headText(a);
  const broad = new Set((cfg.broadGeo || []).map((s) => String(s).toLowerCase()));
  return (cfg.geoKeywords || []).filter(
    (t) => !broad.has(String(t).toLowerCase()) && matches(head, t)
  ).length;
}

// 풀 → 권역 단일 배정(disjoint) + global 버킷. 거시/애매/다권역은 global.
function assignPool(articles, cfgs, opts = {}) {
  const MARGIN = opts.dominanceMargin != null ? opts.dominanceMargin : 1;
  const buckets = { europe: [], americas: [], russia: [], latam: [], global: [] };

  for (const a of articles) {
    // 1) 거시/지수/라운드업 → 무조건 글로벌
    if (isMacro(a)) { buckets.global.push(a); continue; }

    // 2) 권역별 "주체" 점수 = 제목+리드의 지역-특화 앵커 수 (+ scoreArticle pass 게이트)
    const cand = [];
    for (const r of REGIONS) {
      const s = scoreArticle(a, cfgs[r]);
      const subj = subjectHits(a, cfgs[r]);
      if (s.pass && subj >= 1) cand.push({ r, subj, key: subj * 3 + s.relevance, type: s.type });
    }
    if (cand.length === 0) { buckets.global.push(a); continue; }

    // 3) 지배성: 1위가 2위보다 subj 마진 이상이어야 단독 권역. 아니면 글로벌(애매한 다권역).
    cand.sort((x, y) => (y.subj - x.subj) || (y.key - x.key)
      || (PRIORITY.indexOf(x.r) - PRIORITY.indexOf(y.r)));
    const top = cand[0], second = cand[1];
    if (second && (top.subj - second.subj) < MARGIN) { buckets.global.push(a); continue; }

    buckets[top.r].push(Object.assign({}, a, { briefType: top.type, _assign: top.r }));
  }
  return buckets;
}

module.exports = { assignPool, isMacro, subjectHits, multiRegionRoundup, headText, REGIONS, PRIORITY, MACRO_EXCLUDE };
