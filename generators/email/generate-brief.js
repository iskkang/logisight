// scripts/generate-brief.js
// Reads content/drafts/latest-news-curated.json
// Generates SURFF-style HTML: 1 deep story (5 chapters) + supporting news (category tags only)
// Output: content/drafts/newsletter-YYYY-MM-DD.html

const fs   = require('fs');
const path = require('path');

const DATA  = path.resolve(__dirname, '../content/drafts/latest-news-curated.json');
const TODAY = new Date().toISOString().slice(0, 10);
const OUT   = path.resolve(__dirname, `../content/drafts/newsletter-${TODAY}.html`);

// Domains that block direct access (Cloudflare + paywall)
const BLOCKED_DOMAINS = [
  'freightwaves.com', 'wsj.com', 'ft.com', 'bloomberg.com',
  'seekingalpha.com', 'ttnews.com',
];

// If URL is a homepage-only or a known blocked domain, return Google search URL instead
function safeUrl(url, title) {
  try {
    const u = new URL(url);
    const isHomepage = !u.pathname || u.pathname === '/' || u.pathname === '';
    const isBlocked  = BLOCKED_DOMAINS.some(d => u.hostname.includes(d));
    if (isHomepage || isBlocked) {
      return 'https://www.google.com/search?q=' + encodeURIComponent(title);
    }
    return url;
  } catch {
    return '#';
  }
}

function load() {
  if (!fs.existsSync(DATA)) {
    console.error('❌ 큐레이션 파일 없음:', DATA);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(DATA, 'utf-8'));
}

function esc(s)     { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function nl2p(s)    { return esc(s).replace(/\n/g, '<br>'); }

function catTag(text) {
  const t = (text || '').toLowerCase();
  if (/rail|tcr|tsr|철도|railway/.test(t))               return { label: '철도', bg: '#FEF3C7', fg: '#92400E' };
  if (/air|항공|aircraft/.test(t))                        return { label: '항공', bg: '#D1FAE5', fg: '#065F46' };
  if (/ets|trade|policy|정책|supply chain/.test(t))       return { label: '정책', bg: '#F3E8FF', fg: '#6B21A8' };
  return { label: '해운', bg: '#DBEAFE', fg: '#1E40AF' };
}

function img(url, h, radius) {
  if (url) return `
    <img src="${url}" width="600" height="${h}"
         style="width:100%;height:${h}px;object-fit:cover;border-radius:${radius};display:block;" alt="">
    <div style="font-size:10px;color:#94A3B8;text-align:right;padding:2px 8px;">Photo: Unsplash</div>`;
  return `<div style="height:${h}px;border-radius:${radius};background:#DBEAFE;"></div>`;
}

function checkpoints(list) {
  if (!list || !list.length) return '';
  return list.map(c => `
    <div style="display:flex;align-items:flex-start;margin-bottom:10px;last-child:margin-bottom:0;">
      <span style="color:#00A85A;font-weight:800;margin-right:8px;flex-shrink:0;margin-top:1px;">✓</span>
      <span style="font-size:13px;color:#374151;line-height:1.65;word-break:keep-all;">${esc(c)}</span>
    </div>`).join('');
}

function build(d) {
  const s    = d.main_story || {};
  const ch   = s.chapters  || {};
  const subj = d.subject || d.email_subject || '';
  const note = d.editor_note || '';
  const date = d.date || TODAY;

  // support both ch1_what and what field names
  const ch1 = ch.ch1_what    || ch.what        || '';
  const ch2 = ch.ch2_why_now || ch.why         || '';
  const ch3 = ch.ch3_numbers || ch.data        || '';
  const ch4 = ch.ch4_action  || {};
  const ch5 = ch.ch5_watch   || ch.mtl_insight || '';

  const checkpointList = Array.isArray(ch4.shipper_checkpoint) ? ch4.shipper_checkpoint : [];
  const mtlPoint       = ch4.mtl_point || ch5 || '';

  const mainCat = catTag((s.source || '') + ' ' + (s.title_ko || s.title || ''));

  const dateFormatted = (() => {
    try {
      return new Date(date).toLocaleDateString('ko-KR', {
        year:'numeric', month:'long', day:'numeric', weekday:'long'
      });
    } catch { return date; }
  })();

  const supportingCards = (d.supporting_news || []).map(n => {
    const tag = catTag((n.source || '') + ' ' + (n.title_ko || n.title || ''));
    return `
    <tr>
      <td style="padding:0 0 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
               style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;background:#FFFFFF;">
          <tr><td>
            ${img(n.image_url, 160, '8px 8px 0 0')}
            <div style="padding:16px 18px;">
              <div style="margin-bottom:8px;">
                <span style="display:inline-block;background:${tag.bg};color:${tag.fg};
                             font-size:10px;font-weight:700;padding:2px 7px;
                             border-radius:4px;letter-spacing:0.06em;">${tag.label}</span>
                <span style="font-size:11px;color:#94A3B8;margin-left:6px;">${esc(n.source || '')}</span>
              </div>
              <div style="font-size:14px;font-weight:700;color:#1E293B;line-height:1.4;
                           margin-bottom:10px;word-break:keep-all;">
                ${esc(n.title_ko || n.title || '')}
              </div>
              <div style="font-size:13px;color:#374151;line-height:1.7;word-break:keep-all;
                           margin-bottom:14px;">
                ${nl2p(n.summary_ko || '')}
              </div>
              <a href="${safeUrl(n.url, n.title_ko || n.title || '')}" target="_blank" rel="noopener noreferrer"
                 style="font-size:12px;color:#1B4D8C;font-weight:700;text-decoration:none;">
                원문 보기 →
              </a>
            </div>
          </td></tr>
        </table>
      </td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Logisight Daily — ${date}</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr><td align="center" style="padding:24px 16px;">

<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"
       style="max-width:600px;width:100%;background:#FFFFFF;
              border-radius:16px;overflow:hidden;
              box-shadow:0 2px 12px rgba(0,0,0,0.08);">

  <!-- ===== HEADER: light bg, dark navy text ===== -->
  <tr>
    <td style="background:#EFF6FF;padding:28px 32px 24px;border-bottom:3px solid #1B4D8C;">
      <div style="font-size:11px;font-weight:700;color:#1B4D8C;
                   letter-spacing:0.12em;text-transform:uppercase;margin-bottom:6px;">
        MTL Logisight Intelligence
      </div>
      <div style="font-size:26px;font-weight:800;color:#0F2D5A;line-height:1.2;margin-bottom:6px;">
        Logisight Daily
      </div>
      <div style="font-size:13px;color:#475569;font-weight:500;margin-bottom:20px;">
        ${dateFormatted}
      </div>
      <div style="padding:14px 18px;background:#FFFFFF;border-radius:10px;
                   border-left:4px solid #1B4D8C;">
        <div style="font-size:14px;color:#0F2D5A;font-weight:700;
                     line-height:1.5;word-break:keep-all;">
          ${esc(subj)}
        </div>
      </div>
    </td>
  </tr>

  <!-- ===== EDITOR'S NOTE: 📌 emoji ===== -->
  <tr>
    <td style="background:#FFFFFF;padding:18px 32px;border-bottom:1px solid #E2E8F0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td valign="top" style="width:26px;padding-right:10px;font-size:20px;line-height:1;">📌</td>
          <td>
            <div style="font-size:11px;font-weight:700;color:#1B4D8C;
                         letter-spacing:0.08em;text-transform:uppercase;margin-bottom:5px;">
              Editor's Note
            </div>
            <div style="font-size:13px;color:#374151;line-height:1.65;word-break:keep-all;">
              ${esc(note)}
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ===== TODAY'S DEEP STORY ===== -->
  <tr>
    <td style="padding:20px 20px 6px;background:#F8FAFC;">
      <div style="font-size:11px;font-weight:800;color:#0F2D5A;
                   letter-spacing:0.1em;text-transform:uppercase;">
        ★ Today's Deep Story
      </div>
    </td>
  </tr>
  <tr>
    <td style="padding:0 20px 24px;background:#F8FAFC;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
             style="border:2px solid #1B4D8C;border-radius:12px;overflow:hidden;background:#FFFFFF;">
        <tr><td>

          ${img(s.image_url, 220, '10px 10px 0 0')}

          <div style="padding:24px;">

            <!-- category tag + source -->
            <div style="margin-bottom:12px;">
              <span style="display:inline-block;background:${mainCat.bg};color:${mainCat.fg};
                           font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;
                           letter-spacing:0.06em;margin-right:6px;">${mainCat.label}</span>
              <span style="font-size:11px;color:#64748B;">${esc(s.source || '')}</span>
            </div>

            <!-- title -->
            <h2 style="margin:0 0 20px;font-size:18px;font-weight:800;
                        color:#0F2D5A;line-height:1.35;word-break:keep-all;">
              ${esc(s.title_ko || s.title || '')}
            </h2>

            <!-- What -->
            <div style="margin-bottom:16px;">
              <div style="font-size:10px;font-weight:700;color:#94A3B8;
                           letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">What</div>
              <div style="font-size:14px;color:#374151;line-height:1.7;word-break:keep-all;">
                ${nl2p(ch1)}
              </div>
            </div>

            <!-- Why Now -->
            <div style="margin-bottom:16px;padding:14px 16px;background:#F8FAFC;border-radius:8px;">
              <div style="font-size:10px;font-weight:700;color:#94A3B8;
                           letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">Why Now</div>
              <div style="font-size:13px;color:#374151;line-height:1.7;word-break:keep-all;">
                ${nl2p(ch2)}
              </div>
            </div>

            <!-- Numbers -->
            <div style="margin-bottom:16px;padding:14px 16px;background:#F1F5F9;border-radius:8px;">
              <div style="font-size:10px;font-weight:700;color:#94A3B8;
                           letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">Numbers</div>
              <div style="font-size:13px;color:#374151;line-height:1.7;word-break:keep-all;">
                ${nl2p(ch3)}
              </div>
            </div>

            <!-- Action — green box -->
            <div style="margin-bottom:16px;padding:16px;
                         background:#F0FDF4;border-radius:8px;border-left:4px solid #00A85A;">
              <div style="font-size:11px;font-weight:800;color:#00A85A;
                           letter-spacing:0.08em;text-transform:uppercase;margin-bottom:10px;">
                💡 화주·포워더 체크포인트
              </div>
              ${checkpoints(checkpointList)}
            </div>

            ${mtlPoint ? `
            <!-- MTL Point — amber box -->
            <div style="margin-bottom:16px;padding:16px;
                         background:#FFFBEB;border-radius:8px;border-left:4px solid #F59E0B;">
              <div style="font-size:11px;font-weight:800;color:#D97706;
                           letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;">
                ⭐ MTL 영업 포인트
              </div>
              <div style="font-size:13px;color:#374151;line-height:1.65;word-break:keep-all;">
                ${nl2p(mtlPoint)}
              </div>
            </div>` : ''}

            <div style="text-align:right;padding-top:8px;border-top:1px solid #E2E8F0;">
              <a href="${safeUrl(s.url, s.title_ko || s.title || '')}" target="_blank" rel="noopener noreferrer"
                 style="font-size:12px;color:#1B4D8C;font-weight:700;text-decoration:none;">
                원문 보기 →
              </a>
            </div>

          </div>
        </td></tr>
      </table>
    </td>
  </tr>

  <!-- ===== SUPPORTING NEWS (category tags only, no section headers) ===== -->
  ${(d.supporting_news || []).length > 0 ? `
  <tr>
    <td style="padding:20px 20px 4px;">
      <div style="font-size:11px;font-weight:800;color:#0F2D5A;
                   letter-spacing:0.1em;text-transform:uppercase;margin-bottom:14px;">
        오늘의 뉴스
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        ${supportingCards}
      </table>
    </td>
  </tr>` : ''}

  <!-- ===== MTL CTA ===== -->
  <tr>
    <td style="padding:4px 20px 24px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
             style="background:linear-gradient(135deg,#EFF6FF,#F0FDF4);
                    border:1px solid #BFDBFE;border-radius:12px;">
        <tr><td style="padding:24px;">
          <div style="font-size:15px;font-weight:700;color:#0F2D5A;margin-bottom:6px;">
            📊 더 깊은 시장 데이터가 필요하다면
          </div>
          <div style="font-size:13px;color:#475569;margin-bottom:16px;line-height:1.6;">
            SCFI·WCI·KCCI 실시간 + TCR/TSR 동향 + 화물 트래킹
          </div>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding-right:10px;">
                <a href="https://logisight.mtlship.com" target="_blank" rel="noopener noreferrer"
                   style="display:inline-block;background:#1B4D8C;color:#FFFFFF;
                          font-size:13px;font-weight:700;text-decoration:none;
                          padding:10px 20px;border-radius:8px;">
                  Logisight 대시보드 →
                </a>
              </td>
              <td>
                <a href="mailto:logistics@mtlb.co.kr"
                   style="display:inline-block;background:transparent;color:#1B4D8C;
                          font-size:13px;font-weight:700;text-decoration:none;
                          padding:9px 20px;border-radius:8px;border:2px solid #1B4D8C;">
                  MTL 영업 문의
                </a>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td>
  </tr>

  <!-- ===== FOOTER ===== -->
  <tr>
    <td style="background:#1E293B;border-radius:0 0 16px 16px;padding:24px 28px;text-align:center;">
      <div style="font-size:12px;font-weight:700;color:#FFFFFF;margin-bottom:6px;">Logisight Daily</div>
      <div style="font-size:11px;color:#94A3B8;line-height:1.8;margin-bottom:10px;">
        발행: MTL Shipping Agency &nbsp;·&nbsp; newsletter@mtlship.com<br>
        ${dateFormatted}
      </div>
      <div style="font-size:11px;color:#64748B;margin-bottom:10px;">
        본 메일은 Logisight 자동 큐레이션 시스템이 발송했습니다.
      </div>
      <div style="font-size:11px;">
        <a href="#" style="color:#93C5FD;text-decoration:none;">수신 거부</a>
        &nbsp;&nbsp;|&nbsp;&nbsp;
        <a href="https://logisight.mtlship.com" rel="noopener noreferrer" style="color:#93C5FD;text-decoration:none;">웹에서 보기</a>
      </div>
    </td>
  </tr>

</table>
</td></tr>
</table>

</body>
</html>`;
}

const data = load();
const html = build(data);
fs.writeFileSync(OUT, html, 'utf-8');
console.log(`✅ HTML 생성: ${OUT}`);
