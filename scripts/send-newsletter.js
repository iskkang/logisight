// scripts/send-newsletter.js
// Resend API를 사용한 뉴스레터 발송
// 사용법:
//   node scripts/send-newsletter.js --type=daily
//   node scripts/send-newsletter.js --type=weekly

const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');

const resend = new Resend(process.env.RESEND_API_KEY);

const TYPE = process.argv.find(a => a.startsWith('--type='))?.split('=')[1] || 'daily';
const TO = process.env.SEND_TO || process.env.INTERNAL_EMAIL;
const FROM = 'Logisight <newsletter@logisight.mtlship.com>';

// ──────────────────────────────────────────
// 뉴스 데이터 로드 (수집기 결과 또는 fallback)
// ──────────────────────────────────────────
function loadNewsData() {
  const dataPath = path.resolve(__dirname, '../content/drafts/latest-news.json');
  if (fs.existsSync(dataPath)) {
    return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  }
  // fallback: 빈 데이터 (테스트용)
  return {
    date: new Date().toLocaleDateString('ko-KR'),
    shipping: [],
    air: [],
    rail: [],
    trade: [],
  };
}

// ──────────────────────────────────────────
// 매일 브리핑 HTML 템플릿 (카드형)
// ──────────────────────────────────────────
function buildDailyHtml(data) {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  function newsCards(items, max = 5) {
    if (!items || items.length === 0) {
      return '<p style="color:#6b7280;font-size:13px;padding:8px 0;">오늘 수집된 뉴스가 없습니다.</p>';
    }
    return items.slice(0, max).map(item => `
      <a href="${item.url}" target="_blank" style="text-decoration:none;display:block;margin-bottom:10px;">
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;transition:background 0.2s;">
          <div style="font-size:13px;font-weight:600;color:#111827;line-height:1.4;margin-bottom:4px;">
            ${item.title}
          </div>
          <div style="font-size:11px;color:#6b7280;">
            ${item.source} · ${new Date(item.published_at).toLocaleDateString('ko-KR')}
          </div>
        </div>
      </a>
    `).join('');
  }

  function section(emoji, title, items) {
    return `
      <div style="margin-bottom:28px;">
        <div style="font-size:14px;font-weight:700;color:#1B4D8C;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
          ${emoji} ${title}
        </div>
        ${newsCards(items)}
      </div>
    `;
  }

  return `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Logisight 일일 물류 브리핑</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:24px 16px;">

      <!-- Card -->
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1B4D8C 0%,#2E86AB 100%);padding:28px 32px;">
            <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.7);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">
              LOGISIGHT DAILY BRIEFING
            </div>
            <div style="font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">
              오늘의 물류 브리핑
            </div>
            <div style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:6px;">
              ${today}
            </div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">
            ${section('🚢', '해운·컨테이너', data.shipping)}
            ${section('✈️', '항공 화물', data.air)}
            ${section('🚂', '철도·CIS', data.rail)}
            ${section('📜', '무역·정책', data.trade)}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="font-size:12px;color:#6b7280;">
                    <strong style="color:#1B4D8C;">Logisight</strong> · MTL Shipping Agency<br>
                    <a href="https://logisight.mtlship.com" style="color:#1B4D8C;">logisight.mtlship.com</a>
                  </div>
                </td>
                <td align="right">
                  <a href="https://logisight.mtlship.com/market" 
                     style="background:#1B4D8C;color:#ffffff;font-size:12px;font-weight:600;text-decoration:none;padding:8px 16px;border-radius:6px;display:inline-block;">
                    운임 대시보드 →
                  </a>
                </td>
              </tr>
            </table>
            <div style="font-size:11px;color:#9ca3af;margin-top:12px;">
              본 메일은 Logisight 자동 수집 시스템이 발송했습니다. 수신 거부는 회신으로 요청하세요.
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>

</body>
</html>
  `.trim();
}

// ──────────────────────────────────────────
// 매주 보고서 HTML 템플릿
// ──────────────────────────────────────────
function buildWeeklyHtml(data) {
  const weekStr = `${new Date().getFullYear()}년 W${Math.ceil(new Date().getDate() / 7)}`;

  return `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Logisight 주간 시장 보고서</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:24px 16px;">

      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1B4D8C 0%,#2E86AB 100%);padding:32px;">
            <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.7);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">
              LOGISIGHT WEEKLY REPORT · ${weekStr}
            </div>
            <div style="font-size:24px;font-weight:700;color:#ffffff;line-height:1.3;">
              주간 글로벌 물류 시황
            </div>
            <div style="margin-top:16px;display:flex;gap:16px;">
              ${[
                ['SCFI', data.indices?.scfi || '—'],
                ['WCI', data.indices?.wci || '—'],
                ['BDI', data.indices?.bdi || '—'],
              ].map(([k, v]) => `
                <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:10px 16px;text-align:center;">
                  <div style="font-size:10px;color:rgba(255,255,255,0.7);margin-bottom:2px;">${k}</div>
                  <div style="font-size:16px;font-weight:700;color:#ffffff;">${v}</div>
                </div>
              `).join('')}
            </div>
          </td>
        </tr>

        <!-- PDF 다운로드 배너 -->
        <tr>
          <td style="background:#EFF4FB;border-bottom:1px solid #e5e7eb;padding:16px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="font-size:13px;color:#1B4D8C;font-weight:600;">📄 전체 보고서 PDF</div>
                  <div style="font-size:12px;color:#6b7280;margin-top:2px;">상세 분석·차트 포함 전체 보고서</div>
                </td>
                <td align="right">
                  <a href="${data.pdf_url || '#'}" 
                     style="background:#1B4D8C;color:#ffffff;font-size:12px;font-weight:600;text-decoration:none;padding:8px 16px;border-radius:6px;display:inline-block;">
                    다운로드 →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- 주요 헤드라인 -->
        <tr>
          <td style="padding:28px 32px;">
            <div style="font-size:14px;font-weight:700;color:#1B4D8C;margin-bottom:16px;padding-bottom:6px;border-bottom:2px solid #e5e7eb;">
              📌 이번 주 핵심 이슈
            </div>
            ${(data.highlights || [
              '미주 동안 운임 3주 만에 반등, 선사 할증료 영향',
              'EU ETS 2단계 시행 임박, 해운사 비용 전가 가속',
              'TCR Q1 실적 사상 최고치, MTL 차별화 기회',
            ]).map((item, i) => `
              <div style="display:flex;align-items:flex-start;margin-bottom:10px;">
                <span style="background:#1B4D8C;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;margin-right:10px;white-space:nowrap;margin-top:2px;">
                  0${i + 1}
                </span>
                <span style="font-size:13px;color:#374151;line-height:1.5;">${item}</span>
              </div>
            `).join('')}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;">
            <div style="font-size:12px;color:#6b7280;">
              <strong style="color:#1B4D8C;">Logisight</strong> · MTL Shipping Agency ·
              <a href="https://logisight.mtlship.com" style="color:#1B4D8C;">logisight.mtlship.com</a>
            </div>
            <div style="font-size:11px;color:#9ca3af;margin-top:8px;">
              본 보고서는 공개 데이터 기반 자동 생성 자료입니다. 실제 운임은 MTL 영업팀에 문의하세요.
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>

</body>
</html>
  `.trim();
}

// ──────────────────────────────────────────
// 메인 발송 함수
// ──────────────────────────────────────────
async function send() {
  if (!TO) {
    console.error('❌ SEND_TO 또는 INTERNAL_EMAIL 환경변수가 없습니다.');
    process.exit(1);
  }

  const data = loadNewsData();
  let subject, html, attachments = [];

  if (TYPE === 'daily') {
    subject = `📦 Logisight 일일 브리핑 — ${new Date().toLocaleDateString('ko-KR')}`;
    html = buildDailyHtml(data);
  } else {
    subject = `📊 Logisight 주간 시장 보고서 — W${Math.ceil(new Date().getDate() / 7)}`;
    html = buildWeeklyHtml(data);

    // PDF 첨부 (있으면)
    const pdfFiles = fs.readdirSync(path.resolve(__dirname, '../content/published'))
      .filter(f => f.endsWith('.pdf'))
      .sort()
      .reverse();

    if (pdfFiles.length > 0) {
      const pdfPath = path.resolve(__dirname, '../content/published', pdfFiles[0]);
      attachments.push({
        filename: pdfFiles[0],
        content: fs.readFileSync(pdfPath).toString('base64'),
      });
      console.log(`📎 PDF 첨부: ${pdfFiles[0]}`);
    }
  }

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: [TO],
      subject,
      html,
      ...(attachments.length > 0 ? { attachments } : {}),
    });

    console.log(`✅ 이메일 발송 성공 → ${TO}`);
    console.log(`   ID: ${result.data?.id ?? result.id}`);
    console.log(`   제목: ${subject}`);
  } catch (error) {
    console.error('❌ 이메일 발송 실패:', error.message);
    process.exit(1);
  }
}

send();
