'use strict';
// generators/email/send-newsletter-jp.js
// 日本版ニュースレター。週3回(月・水・金)、配信に同意した会員にだけ送る。
//
// ■ 誰に送るか
// jp_profiles.newsletter_opt_in = true の行だけ。会員登録は「データを見るため」に
// 行われるもので、メールを受け取る同意とは別である。特定電子メール法はオプトイン
// 方式で、同意を得た相手にしか広告・宣伝を含むメールを送れない。
// アカウントがあることを同意とみなしてはいけない。
//
// ■ 必ず入れる表示(特定電子メール法)
//   - 送信者の氏名または名称
//   - 送信者の住所
//   - 配信停止の方法(リンク)と、その受付先
// これらは装飾ではなく法定の表示義務なので、テンプレートに直に埋め込む。
//
// ■ 一通ずつ送る
// 宛先をまとめると受信者どうしにアドレスが見える。配信停止リンクも個人ごとに
// 変わるので、まとめようがない。
//
// 実行: node generators/email/send-newsletter-jp.js [--dry-run] [--limit=N]

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const SITE = 'https://jpn.logisight.net';

// 発信元は韓国語版と同じ一か所から取る。ここに直書きしてはいけない。
//
// Resend の無料プランは検証できるドメインが1つしかなく、logisight.net へ移すときに
// アカウントごと差し替えている。日本語版だけ mtlb.co.kr を直書きしていたため、
// GitHub の RESEND_API_KEY が新しいアカウントの鍵に替わった 8月下旬から
// 403(ドメイン未検証)で配信が止まっていた。韓国語版は共有の定数を見ていたので
// 何も起きず、こちらだけが3回続けて静かに落ちた。
// 片方だけ取り残されないよう、定数を持たずに共有する。
const { NEWSLETTER_FROM: FROM } = require('../lib/site');

// 法定表示。フッターの記載と揃える。
const SENDER = {
  name: 'MTL JAPAN CO.,LTD.(株式会社脈日通運)',
  address: '〒102-0073 東京都千代田区九段北1-4-4 九段下ASNビル7F',
  contact: 'info@mtlb.co.kr',
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function rest(pathAndQuery) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`${pathAndQuery}: HTTP ${r.status}`);
  return r.json();
}

/** 配信対象。同意した人だけ。 */
async function recipients() {
  return rest('jp_profiles?select=user_id,email,name&newsletter_opt_in=is.true');
}

/** 前回配信から今日までの記事。無ければ送らない — 中身の無い便りは信用を削る。 */
async function articles(sinceDays = 3, limit = 8) {
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  return rest(
    'maritime_news?select=title,summary,slug,category,source,published_at,agent_type'
    + `&lang=eq.ja&published_at=gte.${since}`
    + '&order=published_at.desc&limit=' + limit,
  );
}

async function latestReport() {
  const rows = await rest(
    'reports?select=title,period_label,period_start&type=eq.monthly&lang=eq.ja'
    + '&order=period_start.desc&limit=1',
  );
  return rows[0] || null;
}

function buildHtml({ items, report, userId, name }) {
  const cards = items.map((a) => {
    const href = a.slug && a.agent_type !== 'external'
      ? `${SITE}/article/${encodeURIComponent(a.slug)}`
      : `${SITE}/news`;
    return `
      <tr><td style="padding:0 0 18px">
        <div style="font-size:11px;color:#8a929c;letter-spacing:.04em">${esc(a.category || '')} ・ ${esc(a.source || '')}</div>
        <a href="${href}" style="display:block;margin-top:4px;font-size:15px;font-weight:700;line-height:1.5;color:#0b2d52;text-decoration:none">${esc(a.title)}</a>
        ${a.summary ? `<div style="margin-top:6px;font-size:13px;line-height:1.75;color:#3c4652">${esc(a.summary)}</div>` : ''}
      </td></tr>`;
  }).join('');

  const reportBlock = report ? `
      <tr><td style="padding:22px 0 0;border-top:1px solid #e2e6ea">
        <div style="font-size:11px;color:#8a929c">月次レポート</div>
        <a href="${SITE}/reports" style="display:block;margin-top:4px;font-size:14px;font-weight:700;color:#0b2d52;text-decoration:none">${esc(report.period_label || '')} ${esc(report.title || '')}</a>
      </td></tr>` : '';

  const unsub = `${SITE}/unsubscribe?u=${encodeURIComponent(userId)}`;

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f6f8;font-family:'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #e2e6ea">
    <tr><td style="padding:22px 26px 14px;border-bottom:2px solid #0b2d52">
      <div style="font-size:17px;font-weight:800;color:#0b2d52">ロジサイト <span style="font-size:11px;letter-spacing:.24em">LOGISIGHT</span></div>
      <div style="margin-top:4px;font-size:12px;color:#6b7683">運賃・港湾・貿易の動き — 週3回のまとめ</div>
    </td></tr>
    <tr><td style="padding:22px 26px 8px">
      ${name ? `<div style="margin-bottom:16px;font-size:13px;color:#3c4652">${esc(name)} 様</div>` : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}${reportBlock}</table>
    </td></tr>
    <tr><td style="padding:18px 26px 26px">
      <a href="${SITE}" style="display:inline-block;background:#0b2d52;color:#fff;font-size:13px;font-weight:700;text-decoration:none;padding:10px 20px">サイトで最新の数値を見る</a>
    </td></tr>
    <!-- 特定電子メール法にもとづく表示。送信者名・住所・配信停止の方法を必ず載せる。 -->
    <tr><td style="padding:18px 26px 24px;border-top:1px solid #e2e6ea;font-size:11px;line-height:1.85;color:#8a929c">
      <div>本メールは、Logisight にご登録の際に配信をご希望いただいた方にお送りしています。</div>
      <div style="margin-top:8px">${esc(SENDER.name)}<br>${esc(SENDER.address)}<br>お問い合わせ: <a href="mailto:${SENDER.contact}" style="color:#0b2d52">${SENDER.contact}</a></div>
      <div style="margin-top:10px"><a href="${unsub}" style="color:#0b2d52">配信を停止する</a></div>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const limArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limArg ? Number(limArg.split('=')[1]) : Infinity;

  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('SUPABASE 환경변수 없음');
  if (!RESEND_KEY && !dry) throw new Error('RESEND_API_KEY 미설정');

  const [items, report, people] = await Promise.all([articles(), latestReport(), recipients()]);

  console.log(`📰 記事 ${items.length}件 · 👥 配信対象 ${people.length}名`);
  // 中身が無いのに送ると、次から開かれなくなる。送らないほうが良い。
  if (items.length === 0) { console.log('新しい記事が無いため送信しない。'); return; }
  if (people.length === 0) { console.log('配信に同意した会員がいないため送信しない。'); return; }

  const today = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric' });
  const subject = `【ロジサイト】${today} — ${items[0].title}`;

  let ok = 0, ng = 0;
  for (const p of people.slice(0, limit)) {
    const html = buildHtml({ items, report, userId: p.user_id, name: p.name });
    if (dry) { console.log(`· [dry] ${p.email} (${(p.name || '').slice(0, 12)})`); ok++; continue; }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [p.email], subject, html }),
    });
    if (r.ok) { ok++; console.log(`✅ ${p.email}`); }
    else { ng++; console.error(`❌ ${p.email}: ${r.status} ${(await r.text()).slice(0, 120)}`); }
  }
  console.log(`📊 送信 ${ok} · 失敗 ${ng}${dry ? ' (DRY RUN)' : ''} · 件名: ${subject}`);
  if (ng > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => { console.error('send-newsletter-jp 실패:', e.message); process.exit(1); });
}

module.exports = { buildHtml, SENDER, FROM };
