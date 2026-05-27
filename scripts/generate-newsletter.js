// scripts/generate-newsletter.js
// 통합 뉴스레터 HTML 생성
// 입력: curated-rail.json + curated-ocean.json
// 출력: newsletter-YYYY-MM-DD.html
// 구조: [Rail 메인 + 2 링크] + [Ocean 메인 + 2 링크]

const fs   = require('fs');
const path = require('path');

const RAIL_PATH  = path.resolve(__dirname, '../content/drafts/curated-rail.json');
const OCEAN_PATH = path.resolve(__dirname, '../content/drafts/curated-ocean.json');
const TODAY      = new Date().toISOString().slice(0, 10);
const OUT        = path.resolve(__dirname, `../content/drafts/newsletter-${TODAY}.html`);

const BLOCKED_DOMAINS = ['freightwaves.com', 'wsj.com', 'ft.com', 'bloomberg.com', 'lloydslist.com'];

function safeUrl(url, title) {
  try {
    const u = new URL(url);
    const isHomepage = !u.pathname || u.pathname === '/';
    const isBlocked  = BLOCKED_DOMAINS.some(d => u.hostname.includes(d));
    if (isHomepage || isBlocked) return 'https://www.google.com/search?q=' + encodeURIComponent(title);
    return url;
  } catch { return '#'; }
}

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function sectionHtml(data, opts) {
  if (!data || !data.main) return '';
  const { bgColor, borderColor, icon, label } = opts;
  const m = data.main;
  const links = (data.links || []).slice(0, 2);

  const imageHtml = m.image_url
    ? `<img src="${esc(m.image_url)}" width="560" style="width:100%;height:200px;object-fit:cover;border-radius:8px 8px 0 0;display:block;" alt="">
       <div style="font-size:10px;color:#94A3B8;text-align:right;padding:2px 6px;">Photo: Unsplash</div>`
    : `<div style="height:120px;border-radius:8px 8px 0 0;background:${bgColor};display:flex;align-items:center;justify-content:center;">
         <span style="font-size:32px;">${icon}</span>
       </div>`;

  const linkItems = links.map(l =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #F1F5F9;">
      <span style="color:#64748B;margin-right:6px;">▶</span>
      <a href="${safeUrl(l.url, l.title_ko || l.title)}" target="_blank" rel="noopener noreferrer"
         style="font-size:13px;color:#1B4D8C;text-decoration:none;font-weight:600;word-break:keep-all;">
        ${esc(l.title_ko || l.title)}</a>
      <span style="font-size:11px;color:#94A3B8;margin-left:6px;">${esc(l.source || '')}</span>
    </td></tr>`
  ).join('');

  return `
  <!-- ===== ${label} 섹션 ===== -->
  <tr><td style="padding:20px 20px 0;">
    <div style="font-size:11px;font-weight:800;color:#0F2D5A;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">
      ${icon} ${label}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
           style="border:2px solid ${borderColor};border-radius:10px;overflow:hidden;background:#FFFFFF;">
      <tr><td>
        ${imageHtml}
        <div style="padding:18px 20px;">
          <div style="font-size:11px;color:#64748B;margin-bottom:6px;">${esc(m.source || '')}</div>
          <h2 style="margin:0 0 14px;font-size:16px;font-weight:800;color:#0F2D5A;line-height:1.4;word-break:keep-all;">
            ${esc(m.title_ko || m.title)}
          </h2>

          <div style="margin-bottom:10px;">
            <div style="font-size:10px;font-weight:700;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">What</div>
            <div style="font-size:13px;color:#374151;line-height:1.6;word-break:keep-all;">${esc(m.what || '')}</div>
          </div>

          <div style="margin-bottom:10px;padding:12px;background:#F8FAFC;border-radius:6px;">
            <div style="font-size:10px;font-weight:700;color:#94A3B8;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">Why Now</div>
            <div style="font-size:13px;color:#374151;line-height:1.6;word-break:keep-all;">${esc(m.why_now || '')}</div>
          </div>

          <div style="margin-bottom:14px;padding:12px;background:#F0FDF4;border-radius:6px;border-left:3px solid #00A85A;">
            <div style="font-size:10px;font-weight:700;color:#00A85A;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">💡 체크포인트</div>
            <div style="font-size:13px;color:#374151;line-height:1.6;word-break:keep-all;">${esc(m.checkpoint || '')}</div>
          </div>

          <div style="text-align:right;">
            <a href="${safeUrl(m.url, m.title_ko || m.title)}" target="_blank" rel="noopener noreferrer"
               style="font-size:12px;color:${borderColor};font-weight:700;text-decoration:none;">원문 보기 →</a>
          </div>
        </div>
      </td></tr>
    </table>
  </td></tr>

  ${links.length > 0 ? `
  <!-- ${label} 추가 뉴스 링크 -->
  <tr><td style="padding:8px 20px 4px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      ${linkItems}
    </table>
  </td></tr>` : ''}`;
}

function build(rail, ocean) {
  const dateFormatted = (() => {
    try { return new Date(TODAY).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }); }
    catch { return TODAY; }
  })();

  const railHtml  = sectionHtml(rail,  { bgColor: '#EFF6FF', borderColor: '#1B4D8C', icon: '🚂', label: 'RAIL INTELLIGENCE'  });
  const oceanHtml = sectionHtml(ocean, { bgColor: '#ECFDF5', borderColor: '#0E7490', icon: '🚢', label: 'OCEAN INTELLIGENCE' });

  if (!railHtml && !oceanHtml) {
    console.warn('⚠️ rail + ocean 모두 없음 — HTML 생성 스킵');
    process.exit(0);
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Logisight Daily — ${TODAY}</title>
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
    <div style="font-size:13px;color:#475569;">${dateFormatted}</div>
  </td></tr>

  ${railHtml}
  ${oceanHtml}

  <!-- CTA -->
  <tr><td style="padding:20px 20px 4px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
           style="background:linear-gradient(135deg,#EFF6FF,#F0FDF4);border:1px solid #BFDBFE;border-radius:12px;">
      <tr><td style="padding:20px;">
        <div style="font-size:14px;font-weight:700;color:#0F2D5A;margin-bottom:4px;">📊 더 깊은 데이터가 필요하다면</div>
        <div style="font-size:12px;color:#475569;margin-bottom:12px;">SCFI·WCI·KCCI 실시간 + TCR/TSR 동향 + 화물 트래킹</div>
        <a href="https://logisight.mtlship.com" target="_blank" rel="noopener noreferrer"
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
      발행: MTL Shipping Agency &nbsp;·&nbsp; newsletter@mtlship.com<br>${dateFormatted}
    </div>
    <div style="font-size:11px;">
      <a href="#" style="color:#93C5FD;text-decoration:none;">수신 거부</a>
      &nbsp;&nbsp;|&nbsp;&nbsp;
      <a href="https://logisight.mtlship.com" rel="noopener noreferrer" style="color:#93C5FD;text-decoration:none;">웹에서 보기</a>
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

const rail  = loadJson(RAIL_PATH);
const ocean = loadJson(OCEAN_PATH);
const html  = build(rail, ocean);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf-8');
console.log(`✅ newsletter HTML 생성: ${OUT}`);
