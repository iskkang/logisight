'use strict';
// 주간 KPI 다이제스트 — 계측한 것을 실제로 보게 만드는 루프.
//
//   node scripts/kpi-weekly.js            # 콘솔 출력
//   node scripts/kpi-weekly.js --slack    # SLACK_WEBHOOK 으로도 전송
//
// 왜 필요한가: 지표를 쌓기만 하고 아무도 보지 않으면 계측은 없는 것과 같다.
//   매주 한 화면으로 "읽혔나 / 구독으로 이어졌나 / 예보는 맞았나"에 답하게 한다.
//
// 정직성: 데이터가 없으면 0으로 위장하지 않고 '—'로 표시한다.
//   오픈 전이라 대부분 0인 것이 정상이며, 그 0 자체가 기준선이다.
const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const { createClient } = require('@supabase/supabase-js');

const DAYS = 7;

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  return createClient(url, key, { auth: { persistSession: false } });
}

const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));

// 합계. 표본이 아예 없으면 null(— 표시) — 0건과 미수집을 구분한다.
function sum(rows, key) {
  if (!rows || !rows.length) return null;
  return rows.reduce((a, r) => a + Number(r[key] || 0), 0);
}

function delta(cur, prev) {
  if (cur == null || prev == null || prev === 0) return '';
  const p = ((cur - prev) / prev) * 100;
  const dir = p > 0.05 ? '▲' : p < -0.05 ? '▼' : '';
  return ` (${dir}${p > 0 ? '+' : ''}${p.toFixed(0)}% WoW)`;
}

const n = (v) => (v == null ? '—' : Number(v).toLocaleString());
const pctOf = (a, b) => (a == null || !b ? '—' : `${((a / b) * 100).toFixed(1)}%`);

// 순수 포맷터 — 조회 결과를 사람이 읽는 다이제스트로. 테스트 대상.
function formatDigest(d) {
  const L = [];
  L.push(`📊 Logisight 주간 KPI — ${d.periodStart} ~ ${d.periodEnd}`);
  L.push('');

  L.push('■ 구독자');
  L.push(`  활성 ${n(d.subscribers.active)}명 · 신규 ${n(d.subscribers.new7d)} · 해지 ${n(d.subscribers.unsub7d)}`);
  L.push('');

  L.push('■ 사이트');
  L.push(`  세션 ${n(d.site.sessions)}${delta(d.site.sessions, d.sitePrev.sessions)}`);
  L.push(`  페이지뷰 ${n(d.site.page_views)}${delta(d.site.page_views, d.sitePrev.page_views)}`);
  L.push(`  기사 완독(50%+) ${n(d.site.reads_50)} · 리포트 조회 ${n(d.site.report_views)} · 다운로드 ${n(d.site.report_downloads)}`);
  L.push(`  적중률 페이지 조회 ${n(d.site.track_record_views)}`);
  L.push('');

  L.push('■ 구독 전환');
  L.push(`  폼 노출 ${n(d.site.subscribe_opens)} → 제출 ${n(d.site.subscribe_submits)} → 완료 ${n(d.site.subscribe_done)}`);
  L.push(`  세션→구독 전환율 ${pctOf(d.site.subscribe_done, d.site.sessions)}`);
  L.push('');

  L.push('■ 뉴스레터');
  // 귀속이 깨지면 오픈율이 "아무도 안 열었다"처럼 보인다 — 0%로 오독하지 않도록 먼저 경고한다.
  if (d.orphanEvents) {
    L.push(`  ⚠ 캠페인 미귀속 반응 ${n(d.orphanEvents)}건 — Resend tag(campaign_id) 전달 확인 필요`);
  }
  if (!d.campaigns.length) {
    L.push('  이번 주 발송 없음');
  } else {
    for (const c of d.campaigns) {
      L.push(`  ${c.campaign_id} · 발송 ${n(c.recipients)} · 도달 ${n(c.delivered)}`
        + ` · 오픈 ${c.open_rate_pct == null ? '—' : c.open_rate_pct + '%'}`
        + ` · 클릭 ${c.click_rate_pct == null ? '—' : c.click_rate_pct + '%'}`);
    }
  }
  L.push('');

  L.push('■ 예보 트랙레코드 (누적)');
  if (!d.forecast.resolved) {
    L.push('  판정 완료 전망 없음');
  } else {
    L.push(`  판정 ${n(d.forecast.resolved)}건 · 적중 ${n(d.forecast.hit)} / 부분 ${n(d.forecast.partial)} / 빗나감 ${n(d.forecast.miss)}`);
    L.push(`  적중률 ${d.forecast.hitRatePct}% · 가중점수 ${d.forecast.weightedPct}%`
      + (d.forecast.resolved < 10 ? '  ⚠ 표본 부족(10건 미만)' : ''));
  }
  L.push(`  진행 중 전망 ${n(d.forecast.open)}건`);
  L.push('');

  L.push('■ 상위 콘텐츠');
  if (!d.topContent.length) {
    L.push('  집계 데이터 없음');
  } else {
    for (const c of d.topContent) {
      L.push(`  ${c.content_type === 'report' ? '[리포트]' : '[기사]'} ${c.content_key}`
        + ` — 조회 ${n(c.views)} / 완독 ${n(c.reads_50)}`);
    }
  }

  return L.join('\n');
}

async function collect(sb, now = new Date()) {
  const start = daysAgo(DAYS);
  const prevStart = daysAgo(DAYS * 2);

  const [kpiCur, kpiPrev, campaigns, top, subsActive, subsNew, subsUnsub, forecasts, orphan] = await Promise.all([
    sb.from('v_kpi_daily').select('*').gte('day', start),
    sb.from('v_kpi_daily').select('*').gte('day', prevStart).lt('day', start),
    sb.from('v_newsletter_campaign_stats').select('*').gte('sent_at', start).order('sent_at', { ascending: false }),
    sb.from('v_content_engagement').select('*').order('views', { ascending: false }).limit(5),
    sb.from('newsletter_subscribers').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    sb.from('newsletter_subscribers').select('id', { count: 'exact', head: true }).gte('subscribed_at', start),
    sb.from('newsletter_subscribers').select('id', { count: 'exact', head: true }).gte('unsubscribed_at', start),
    sb.from('forecasts').select('status,outcome').in('status', ['published', 'resolved']),
    // 캠페인에 붙지 않은 반응 = Resend tag 유실. 조용히 0%로 보이는 사고를 막는 감시 지표.
    sb.from('newsletter_events').select('id', { count: 'exact', head: true })
      .is('campaign_id', null).gte('created_at', start),
  ]);

  for (const r of [kpiCur, kpiPrev, campaigns, top, forecasts]) {
    if (r.error) throw new Error(r.error.message);
  }

  const site = (rows) => ({
    sessions: sum(rows, 'sessions'),
    page_views: sum(rows, 'page_views'),
    reads_50: sum(rows, 'reads_50'),
    report_views: sum(rows, 'report_views'),
    report_downloads: sum(rows, 'report_downloads'),
    track_record_views: sum(rows, 'track_record_views'),
    subscribe_opens: sum(rows, 'subscribe_opens'),
    subscribe_submits: sum(rows, 'subscribe_submits'),
    subscribe_done: sum(rows, 'subscribe_done'),
  });

  const fRows = forecasts.data || [];
  const judged = fRows.filter((f) => f.outcome != null);
  const hit = judged.filter((f) => f.outcome === 'hit').length;
  const partial = judged.filter((f) => f.outcome === 'partial').length;

  return {
    periodStart: start,
    periodEnd: iso(now),
    subscribers: {
      active: subsActive.count ?? null,
      new7d: subsNew.count ?? null,
      unsub7d: subsUnsub.count ?? null,
    },
    site: site(kpiCur.data),
    sitePrev: site(kpiPrev.data),
    campaigns: campaigns.data || [],
    orphanEvents: orphan.count ?? 0,
    topContent: top.data || [],
    forecast: {
      resolved: judged.length,
      hit,
      partial,
      miss: judged.filter((f) => f.outcome === 'miss').length,
      open: fRows.length - judged.length,
      hitRatePct: judged.length ? Math.round((hit / judged.length) * 1000) / 10 : null,
      weightedPct: judged.length ? Math.round(((hit + partial * 0.5) / judged.length) * 1000) / 10 : null,
    },
  };
}

async function main() {
  const text = formatDigest(await collect(client()));
  console.log(text);

  if (process.argv.includes('--slack') && process.env.SLACK_WEBHOOK) {
    const res = await fetch(process.env.SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '```\n' + text + '\n```' }),
    });
    if (!res.ok) console.warn(`⚠️ Slack 전송 실패: HTTP ${res.status}`);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('KPI 집계 실패:', e.message); process.exit(1); });
}

module.exports = { formatDigest, sum, delta };
