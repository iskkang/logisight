'use strict';
// maritime_news(external 원문)를 월간 리포트 아이템 풀로 로드·정규화.
// latest-news.json 아이템과 병합해 뉴스 소스를 확장(발행월 데이터 배제 상한 적용).
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
const { createClient } = require('@supabase/supabase-js');

const LOOKBACK_DAYS = 45;

function normalizeMaritimeRow(row) {
  return {
    title:        row.title || '',
    summary_en:   row.summary || '',
    content:      row.content || '',
    source:       row.source || '',
    url:          row.url || '',
    published_at: row.published_at || null,
    category:     null, // latest-news.json 카테고리 체계와 달라 키워드 매칭 경로로만 분류
    section:      null,
  };
}

function dedupeByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (it.url) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);
    }
    out.push(it);
  }
  return out;
}

function substanceLen(it) {
  return (it.summary_en || '').length + (it.content || '').length;
}

function rankAndCap(items, cap) {
  return [...items]
    .sort((a, b) => {
      const da = a.published_at || '';
      const db = b.published_at || '';
      if (db !== da) return db < da ? -1 : 1;          // 최신순
      return substanceLen(b) - substanceLen(a);         // 동일 날짜: 분량 긴 것 우선
    })
    .slice(0, cap);
}

async function loadMaritimeNewsItems({ monthEnd }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('  maritime-news-feed: Supabase 미설정 — 병합 스킵');
    return [];
  }
  const end   = new Date(`${monthEnd}T23:59:59Z`);
  const start = new Date(end.getTime() - LOOKBACK_DAYS * 86400000);
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.from('maritime_news')
    .select('title,summary,content,source,url,category,agent_type,published_at')
    .eq('agent_type', 'external')
    .gte('published_at', start.toISOString())
    .lte('published_at', end.toISOString())
    .order('published_at', { ascending: false })
    .limit(1000);
  if (error) { console.warn('  maritime-news-feed: 조회 실패:', error.message); return []; }
  const items = (data || []).map(normalizeMaritimeRow);
  console.log(`  maritime-news-feed: external ${items.length}건 로드 (${monthEnd} 기준 −${LOOKBACK_DAYS}d)`);
  return items;
}

module.exports = { normalizeMaritimeRow, dedupeByUrl, rankAndCap, loadMaritimeNewsItems };
