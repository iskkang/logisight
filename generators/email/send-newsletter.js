// scripts/send-newsletter.js
// Resend API를 사용한 뉴스레터 발송
// 사용법:
//   node scripts/send-newsletter.js --type=daily
//   node scripts/send-newsletter.js --type=weekly

const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');
const { campaignId, withUtm } = require('./lib/campaign');

const resend = new Resend(process.env.RESEND_API_KEY);

const TYPE = process.argv.find(a => a.startsWith('--type='))?.split('=')[1] || 'daily';
const HTML_FILE = process.argv.find(a => a.startsWith('--html='))?.split('=').slice(1).join('=');
const TO = process.env.SEND_TO || process.env.INTERNAL_EMAIL;
// 발신 주소·사이트는 환경변수로 뺀다 — Logisight를 MTL 도메인에서 분리할 때 DNS/Resend 검증만 마치면
// 코드 변경 없이 전환된다. 미설정 시 현행 값 유지(동작 불변).
const FROM = process.env.NEWSLETTER_FROM || 'Logisight <newsletter@mtlb.co.kr>';
const SITE_URL = process.env.SITE_URL || 'https://logisight.mtlship.com';

// 수신거부 링크 주입 — 생성 HTML의 {{UNSUBSCRIBE_URL}} 치환, 없으면 본문 끝에 최소 푸터 추가.
// id 없는 내부 사본은 /news 로 대체.
function withUnsub(html, id) {
  const url = id ? `${SITE_URL}/unsubscribe?id=${id}` : `${SITE_URL}/news`;
  if (html.includes('{{UNSUBSCRIBE_URL}}')) return html.split('{{UNSUBSCRIBE_URL}}').join(url);
  const fallback = `<div style="font-size:11px;color:#94a3b8;text-align:center;padding:16px;">수신거부: <a href="${url}" style="color:#93c5fd;">구독 해지</a> · Logisight</div>`;
  return html.includes('</body>') ? html.replace('</body>', `${fallback}</body>`) : html + fallback;
}

// 활성 구독자 조회 — service_role 키로 PostgREST 직접 호출(RLS 우회, 의존성 최소화).
async function fetchActiveSubscribers() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  const res = await fetch(`${url}/rest/v1/newsletter_subscribers?select=id,email&status=eq.active`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`구독자 조회 실패: HTTP ${res.status}`);
  return res.json();
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ──────────────────────────────────────────
// 계측 — 발송 기록 (058)
// ──────────────────────────────────────────
// 발송 1회 = newsletter_sends 1행. 이게 있어야 오픈율의 분모가 생긴다.
// 계측 실패가 발송을 되돌리지는 않는다 — 경고만 남기고 진행한다(메일은 이미 나갔다).
async function recordSend({ campaign, kind, subject, recipients, failed }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.warn('⚠️ Supabase 미설정 — 발송 기록 생략'); return; }
  try {
    const res = await fetch(`${url}/rest/v1/newsletter_sends?on_conflict=campaign_id`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ campaign_id: campaign, kind, subject, recipients, failed }),
    });
    if (!res.ok) console.warn(`⚠️ 발송 기록 실패: HTTP ${res.status} ${await res.text()}`);
    else console.log(`📈 발송 기록: ${campaign} (수신자 ${recipients} / 실패 ${failed})`);
  } catch (e) {
    console.warn(`⚠️ 발송 기록 실패: ${e.message}`);
  }
}

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
                    <strong style="color:#1B4D8C;">Logisight</strong><br>
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
              'TCR Q1 실적 사상 최고치',
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
              <strong style="color:#1B4D8C;">Logisight</strong> ·
              <a href="https://logisight.mtlship.com" style="color:#1B4D8C;">logisight.mtlship.com</a>
            </div>
            <div style="font-size:11px;color:#9ca3af;margin-top:8px;">
              본 보고서는 공개 데이터 기반 자동 생성 자료입니다.
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
  const AUDIENCE = process.argv.find(a => a.startsWith('--audience='))?.split('=')[1] || 'internal';

  const data = loadNewsData();
  let subject, html, attachments = [];

  // --html=path 플래그가 있으면 외부 HTML 파일 직접 사용
  if (HTML_FILE) {
    const htmlPath = path.resolve(process.cwd(), HTML_FILE);
    if (!fs.existsSync(htmlPath)) {
      console.error(`❌ HTML 파일 없음: ${htmlPath}`);
      process.exit(1);
    }
    html = fs.readFileSync(htmlPath, 'utf-8');
    subject = `📦 Logisight 뉴스레터 — ${new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}`;
    console.log(`📄 외부 HTML 사용: ${HTML_FILE}`);
  } else if (TYPE === 'daily') {
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

  // ── 구독자 발송: 개별 발송으로 서로의 주소 노출 방지 + 수신거부 링크 개인화 ──
  if (AUDIENCE === 'subscribers') {
    const subs = await fetchActiveSubscribers();
    console.log(`👥 활성 구독자: ${subs.length}명`);
    const recipients = subs.map(s => ({ email: s.email, id: s.id }));
    if (process.env.INTERNAL_EMAIL) recipients.push({ email: process.env.INTERNAL_EMAIL, id: null }); // 모니터링 사본
    if (!recipients.length) {
      console.log('구독자가 없어 발송을 건너뜁니다.');
      return;
    }

    // 계측: 캠페인 ID를 Resend tag로 심어야 웹훅(오픈·클릭)이 이 발송으로 귀속된다.
    const kind = ['daily', 'weekly', 'report'].includes(TYPE) ? TYPE : 'daily';
    const campaign = campaignId(kind);
    const trackedHtml = withUtm(html, campaign, SITE_URL);

    let sent = 0, failed = 0;
    for (const group of chunk(recipients, 100)) {
      const payload = group.map(r => ({
        from: FROM, to: [r.email], subject, html: withUnsub(trackedHtml, r.id),
        tags: [{ name: 'campaign_id', value: campaign }],
      }));
      const result = await resend.batch.send(payload);
      if (result.error) {
        console.error('❌ 배치 발송 실패:', JSON.stringify(result.error));
        failed += group.length;
        continue;
      }
      sent += group.length;
    }
    console.log(`✅ 구독자 발송 완료 — 성공 ${sent} / 실패 ${failed} / 제목: ${subject}`);
    await recordSend({ campaign, kind, subject, recipients: sent, failed });
    if (failed > 0) process.exit(1);
    return;
  }

  // ── 내부 단일 발송 (기존 동작: 주간·수동) ──
  if (!TO) {
    console.error('❌ SEND_TO 또는 INTERNAL_EMAIL 환경변수가 없습니다.');
    process.exit(1);
  }
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: [TO],
      subject,
      html: withUnsub(html, null),
      ...(attachments.length > 0 ? { attachments } : {}),
    });

    // SDK v3: errors are returned in result.error, not thrown
    if (result.error) {
      console.error('❌ 이메일 발송 실패:', JSON.stringify(result.error));
      process.exit(1);
    }

    console.log(`✅ 이메일 발송 성공 → ${TO}`);
    console.log(`   ID: ${result.data?.id}`);
    console.log(`   제목: ${subject}`);
  } catch (error) {
    console.error('❌ 이메일 발송 실패:', error.message);
    process.exit(1);
  }
}

send();
