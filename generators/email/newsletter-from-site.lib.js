// generators/email/newsletter-from-site.lib.js
// 사이트(maritime_news) 내부 기사 → 데일리 뉴스레터 HTML (순수 함수만, I/O 없음)
'use strict';

const SITE = 'https://logisight.mtlship.com';
const SECTION_ORDER = ['해상', '항공', '철도', '무역', '물류'];
const SECTION_ICONS = { 해상: '🚢', 항공: '✈️', 철도: '🚂', 무역: '📜', 물류: '📦' };

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// KST(UTC+9) 기준 오늘 날짜 "YYYY-MM-DD"
function kstToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

// 섹션 대표 = is_hero(메인 기사) 우선, 그다음 최신 fetched_at
function isBetter(row, prev) {
  const rh = row.is_hero ? 1 : 0;
  const ph = prev.is_hero ? 1 : 0;
  if (rh !== ph) return rh > ph;
  return String(row.fetched_at || '') > String(prev.fetched_at || '');
}

// 카테고리당 대표 1건, SECTION_ORDER 순서로 정렬
function pickArticles(rows) {
  const byCategory = new Map();
  for (const row of rows || []) {
    if (!row || !row.slug || !row.title || !row.category) continue;
    const prev = byCategory.get(row.category);
    if (!prev || isBetter(row, prev)) {
      byCategory.set(row.category, row);
    }
  }
  return SECTION_ORDER.filter((c) => byCategory.has(c)).map((c) => byCategory.get(c));
}

function cardHtml(a) {
  const icon = SECTION_ICONS[a.category] || '📰';
  const url = `${SITE}/article/${encodeURIComponent(a.slug)}`;
  const imageHtml = a.image_url
    ? `<img src="${esc(a.image_url)}" width="560" style="width:100%;height:180px;object-fit:cover;display:block;" alt="">` +
      (a.image_credit
        ? `<div style="font-size:10px;color:#94A3B8;text-align:right;padding:2px 6px;">Photo: ${esc(a.image_credit)}</div>`
        : '')
    : `<div style="height:100px;background:#EFF6FF;text-align:center;line-height:100px;font-size:32px;">${icon}</div>`;

  return `
  <!-- ===== ${esc(a.category)} 카드 ===== -->
  <tr><td style="padding:20px 20px 0;">
    <div style="font-size:11px;font-weight:800;color:#0F2D5A;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">
      ${icon} ${esc(a.category)}
    </div>
    <a href="${url}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:block;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
             style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;background:#FFFFFF;">
        <tr><td>
          ${imageHtml}
          <div style="padding:16px 20px;">
            <h2 style="margin:0 0 8px;font-size:16px;font-weight:800;color:#0F2D5A;line-height:1.4;word-break:keep-all;">
              ${esc(a.title)}
            </h2>
            ${a.summary ? `<div style="font-size:13px;color:#475569;line-height:1.6;word-break:keep-all;">${esc(a.summary)}</div>` : ''}
            <div style="margin-top:10px;font-size:12px;color:#1B4D8C;font-weight:700;">기사 보기 →</div>
          </div>
        </td></tr>
      </table>
    </a>
  </td></tr>`;
}

function buildHtml(articles, dateIso) {
  const dateFormatted = (() => {
    try {
      return new Date(`${dateIso}T00:00:00+09:00`).toLocaleDateString('ko-KR', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Seoul',
      });
    } catch { return dateIso; }
  })();

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Logisight Daily — ${esc(dateIso)}</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"
       style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

  <!-- HEADER -->
  <tr><td style="background:#EFF6FF;padding:24px 28px 20px;border-bottom:3px solid #1B4D8C;">
    <div style="font-size:11px;font-weight:700;color:#1B4D8C;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:4px;">
      MTL Logisight Intelligence
    </div>
    <div style="font-size:24px;font-weight:800;color:#0F2D5A;line-height:1.2;margin-bottom:4px;">Logisight Daily</div>
    <div style="font-size:13px;color:#475569;">${esc(dateFormatted)}</div>
  </td></tr>

  ${articles.map(cardHtml).join('\n')}

  <!-- CTA -->
  <tr><td style="padding:20px 20px 4px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
           style="background:linear-gradient(135deg,#EFF6FF,#F0FDF4);border:1px solid #BFDBFE;border-radius:12px;">
      <tr><td style="padding:20px;">
        <div style="font-size:14px;font-weight:700;color:#0F2D5A;margin-bottom:4px;">📊 더 깊은 데이터가 필요하다면</div>
        <div style="font-size:12px;color:#475569;margin-bottom:12px;">SCFI·WCI·KCCI 실시간 + TCR/TSR 동향 + 화물 트래킹</div>
        <a href="${SITE}" target="_blank" rel="noopener noreferrer"
           style="display:inline-block;background:#1B4D8C;color:#FFFFFF;font-size:12px;font-weight:700;text-decoration:none;padding:8px 18px;border-radius:6px;">
          Logisight 대시보드 →
        </a>
      </td></tr>
    </table>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#1E293B;border-radius:0 0 16px 16px;padding:20px 24px;text-align:center;">
    <div style="font-size:12px;font-weight:700;color:#FFFFFF;margin-bottom:4px;">Logisight Daily</div>
    <div style="font-size:11px;color:#94A3B8;line-height:1.8;margin-bottom:8px;">
      발행: MTL Shipping Agency &nbsp;·&nbsp; newsletter@mtlship.com<br>${esc(dateFormatted)}
    </div>
    <div style="font-size:11px;">
      <a href="{{UNSUBSCRIBE_URL}}" style="color:#93C5FD;text-decoration:none;">수신 거부</a>
      &nbsp;&nbsp;|&nbsp;&nbsp;
      <a href="${SITE}/news" rel="noopener noreferrer" style="color:#93C5FD;text-decoration:none;">웹에서 보기</a>
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

module.exports = { kstToday, pickArticles, buildHtml, SECTION_ORDER, SITE };
