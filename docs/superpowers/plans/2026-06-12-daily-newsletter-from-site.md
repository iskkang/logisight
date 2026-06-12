# Daily Newsletter — 사이트 기사 기반 재구성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 데일리 이메일이 수집·큐레이션을 재실행하지 않고, 사이트에 발행된 당일 shipping 기사(maritime_news)를 읽어 카드형 HTML(제목+이미지+소제목, 클릭 시 사이트 이동)을 만들어 발송하도록 재구성하고, 소비처 없는 daily_card 파이프라인을 폐기한다.

**Architecture:** 순수 함수 lib(`newsletter-from-site.lib.js` — 기사 선별·HTML 렌더링)와 Supabase 조회+파일 쓰기만 하는 메인 스크립트를 분리한다. lib은 `node:test`로 단위 테스트한다. 워크플로는 checkout → npm ci → 생성 → 발송 4스텝으로 축소된다.

**Tech Stack:** Node.js (CommonJS), `@supabase/supabase-js`, `node:test` + `node:assert/strict`, GitHub Actions, Resend (기존 send-newsletter.js 그대로 사용).

**Spec:** `docs/superpowers/specs/2026-06-12-daily-newsletter-from-site-design.md`

**⚠️ 시간대 주의 (계획 전체에 적용):** cron이 `0 23 * * *`(전일 UTC 23:00 = 당일 08:00 KST)로 바뀌므로, UTC 기준 날짜(`new Date().toISOString().slice(0,10)`, 셸 `date`)를 쓰면 KST보다 하루 빠른 날짜가 나온다. 파일명·쿼리 모두 **KST 기준 날짜**를 사용해야 한다 (lib의 `kstToday()`, 워크플로의 `TZ=Asia/Seoul date`).

---

### Task 1: 순수 함수 lib — 기사 선별 + HTML 렌더링

**Files:**
- Create: `generators/email/newsletter-from-site.lib.js`
- Test: `generators/email/newsletter-from-site.test.js`

**컨텍스트:** shipping 기사는 `generate-article-shipping.js`가 섹션당 1건씩 생성하며, `category`(해상|항공|철도|무역|물류)가 섹션과 1:1 매핑된다. `summary` 컬럼에는 기사 부제(subtitle)가 들어 있다. `slug`는 `{YYYY-MM-DD}-{section}-{slug}` 형식. 카드 디자인 토큰(색상·폰트)은 기존 `generators/email/generate-newsletter.js`의 것을 재사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`generators/email/newsletter-from-site.test.js` 생성:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { kstToday, pickArticles, buildHtml } = require('./newsletter-from-site.lib');

test('kstToday: UTC 23:00 = KST 다음날', () => {
  assert.equal(kstToday(new Date('2026-06-11T23:00:00Z')), '2026-06-12');
});

test('kstToday: UTC 오전 = KST 같은 날', () => {
  assert.equal(kstToday(new Date('2026-06-12T03:00:00Z')), '2026-06-12');
});

test('pickArticles: 카테고리당 최신 1건, 고정 순서(해상→항공→철도→무역→물류)', () => {
  const rows = [
    { slug: 'a', title: 'rail old', category: '철도', fetched_at: '2026-06-12T01:00:00Z' },
    { slug: 'b', title: 'rail new', category: '철도', fetched_at: '2026-06-12T02:00:00Z' },
    { slug: 'c', title: 'air',      category: '항공', fetched_at: '2026-06-12T01:00:00Z' },
    { slug: 'd', title: 'ocean',    category: '해상', fetched_at: '2026-06-12T01:00:00Z' },
  ];
  assert.deepEqual(pickArticles(rows).map((r) => r.title), ['ocean', 'air', 'rail new']);
});

test('pickArticles: slug/title/category 없는 행과 null 제외', () => {
  assert.deepEqual(pickArticles([{ title: 'no slug', category: '해상' }, null]), []);
});

test('pickArticles: 빈 배열·undefined 입력 시 빈 배열', () => {
  assert.deepEqual(pickArticles([]), []);
  assert.deepEqual(pickArticles(undefined), []);
});

test('buildHtml: 카드 링크는 사이트 /article/{slug}, 제목 HTML 이스케이프', () => {
  const html = buildHtml(
    [{ slug: '2026-06-12-ocean-x', title: '운임 <상승>', summary: '부제목', category: '해상', image_url: null, image_credit: null }],
    '2026-06-12',
  );
  assert.ok(html.includes('https://logisight.mtlship.com/article/2026-06-12-ocean-x'));
  assert.ok(html.includes('운임 &lt;상승&gt;'));
  assert.ok(html.includes('부제목'));
});

test('buildHtml: 푸터 "웹에서 보기"는 /news로 연결', () => {
  const html = buildHtml(
    [{ slug: 's', title: 't', summary: null, category: '물류', image_url: null, image_credit: null }],
    '2026-06-12',
  );
  assert.ok(html.includes('https://logisight.mtlship.com/news'));
});

test('buildHtml: summary 없으면 생략하고 undefined 문자열이 없어야 함', () => {
  const html = buildHtml(
    [{ slug: 's', title: 't', summary: null, category: '물류', image_url: null, image_credit: null }],
    '2026-06-12',
  );
  assert.ok(!html.includes('undefined'));
});

test('buildHtml: image_url 있으면 img 태그, credit 캡션 포함', () => {
  const html = buildHtml(
    [{ slug: 's', title: 't', summary: 'x', category: '해상', image_url: 'https://img.example/a.jpg', image_credit: 'Unsplash' }],
    '2026-06-12',
  );
  assert.ok(html.includes('https://img.example/a.jpg'));
  assert.ok(html.includes('Photo: Unsplash'));
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test generators/email/`
Expected: FAIL — `Cannot find module './newsletter-from-site.lib'`

- [ ] **Step 3: lib 구현**

`generators/email/newsletter-from-site.lib.js` 생성:

```js
// generators/email/newsletter-from-site.lib.js
// 사이트(maritime_news) shipping 기사 → 데일리 뉴스레터 HTML (순수 함수만, I/O 없음)
'use strict';

const SITE = 'https://logisight.mtlship.com';
const SECTION_ORDER = ['해상', '항공', '철도', '무역', '물류'];
const SECTION_ICONS = { 해상: '🚢', 항공: '✈️', 철도: '🚂', 무역: '📜', 물류: '📦' };

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// KST(UTC+9) 기준 오늘 날짜 "YYYY-MM-DD"
function kstToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

// 카테고리당 최신(fetched_at) 1건, SECTION_ORDER 순서로 정렬
function pickArticles(rows) {
  const byCategory = new Map();
  for (const row of rows || []) {
    if (!row || !row.slug || !row.title || !row.category) continue;
    const prev = byCategory.get(row.category);
    if (!prev || String(row.fetched_at || '') > String(prev.fetched_at || '')) {
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
      <a href="#" style="color:#93C5FD;text-decoration:none;">수신 거부</a>
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test generators/email/`
Expected: 모든 테스트 PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add generators/email/newsletter-from-site.lib.js generators/email/newsletter-from-site.test.js
git commit -m "feat(newsletter): site-article newsletter lib (pickArticles, buildHtml, kstToday)"
```

---

### Task 2: 메인 스크립트 + npm 스크립트 등록

**Files:**
- Create: `generators/email/generate-newsletter-from-site.js`
- Modify: `package.json` (scripts에 `newsletter:from-site`, `test:email` 추가)

- [ ] **Step 1: 메인 스크립트 작성**

`generators/email/generate-newsletter-from-site.js` 생성:

```js
// generators/email/generate-newsletter-from-site.js
// 당일(KST) 사이트 발행 shipping 기사(maritime_news)를 읽어 뉴스레터 HTML 생성.
// 수집·큐레이션·LLM 호출 없음. 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// 출력: content/drafts/newsletter-YYYY-MM-DD.html (당일 기사 0건이면 미생성 + exit 0)
'use strict';

const fs = require('fs');
const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;

const { createClient } = require('@supabase/supabase-js');
const { kstToday, pickArticles, buildHtml } = require('./newsletter-from-site.lib');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { enabled: false },
  });

  const today = kstToday();
  const { data, error } = await supabase
    .from('maritime_news')
    .select('title,summary,slug,category,image_url,image_credit,fetched_at')
    .eq('agent_type', 'shipping')
    .not('slug', 'is', null)
    .gte('fetched_at', `${today}T00:00:00+09:00`)
    .order('fetched_at', { ascending: false });
  if (error) throw new Error(error.message);

  const articles = pickArticles(data);
  if (articles.length === 0) {
    console.warn('⚠️ 당일 shipping 기사 0건 — HTML 생성 스킵');
    return;
  }

  const out = path.resolve(__dirname, `../../content/drafts/newsletter-${today}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buildHtml(articles, today), 'utf-8');
  console.log(`✅ newsletter HTML 생성 (${articles.length}개 카드): ${out}`);
}

main().catch((e) => {
  console.error('❌ generate-newsletter-from-site 실패:', e.message);
  process.exit(1);
});
```

- [ ] **Step 2: package.json scripts 추가**

`package.json`의 `"newsletter:generate"` 줄 아래에 추가:

```json
    "newsletter:generate": "node generators/email/generate-newsletter.js",
    "newsletter:from-site": "node generators/email/generate-newsletter-from-site.js",
    "test:email": "node --test generators/email/",
```

(기존 `newsletter:generate`는 weekly-newsletter.yml이 사용하므로 유지.)

- [ ] **Step 3: 로컬 통합 실행으로 검증**

Run: `npm run newsletter:from-site`
Expected (당일 기사가 있는 경우): `✅ newsletter HTML 생성 (N개 카드): …/content/drafts/newsletter-2026-06-12.html`
Expected (없는 경우): `⚠️ 당일 shipping 기사 0건 — HTML 생성 스킵` + exit 0

생성된 경우 HTML을 열어 확인: 카드 링크가 모두 `https://logisight.mtlship.com/article/…` 형식인지, 본문(content)이 포함되지 않았는지.

검증 후 생성된 `content/drafts/newsletter-*.html`은 커밋하지 않는다.

- [ ] **Step 4: 테스트 전체 재실행**

Run: `npm run test:email`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add generators/email/generate-newsletter-from-site.js package.json
git commit -m "feat(newsletter): generate daily email from published site articles"
```

---

### Task 3: daily-newsletter.yml 축소 + 08:00 KST 변경

**Files:**
- Modify: `.github/workflows/daily-newsletter.yml` (전체 교체)

- [ ] **Step 1: 워크플로 전체 교체**

`.github/workflows/daily-newsletter.yml`을 아래 내용으로 교체:

```yaml
# .github/workflows/daily-newsletter.yml
# 사이트에 발행된 당일 기사(maritime_news)를 카드 이메일로 발송.
# 수집·큐레이션 없음 — 기사 생성은 daily-web-articles.yml(06:30 KST)이 담당.
# Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, INTERNAL_EMAIL
name: Daily Newsletter

on:
  schedule:
    - cron: '0 23 * * *'   # 08:00 KST (전일 UTC 23:00)
  workflow_dispatch:

jobs:
  newsletter:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Generate newsletter HTML from site articles
        run: npm run newsletter:from-site
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

      - name: Send newsletter
        run: |
          TODAY=$(TZ=Asia/Seoul date +%Y-%m-%d)
          HTML_PATH="content/drafts/newsletter-${TODAY}.html"
          if [ -f "$HTML_PATH" ]; then
            echo "📄 HTML 발송: $HTML_PATH"
            node generators/email/send-newsletter.js --html="$HTML_PATH"
          else
            echo "⚠️ HTML 없음 — 발송 스킵"
          fi
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          SEND_TO: ${{ secrets.INTERNAL_EMAIL }}
```

주의: 발송 스텝의 `TZ=Asia/Seoul date`는 필수다. 23:00 UTC 실행 시 UTC 날짜는 KST보다 하루 빠르므로, 스크립트(`kstToday()`)가 만든 파일명과 일치시키려면 KST로 계산해야 한다.

- [ ] **Step 2: YAML 문법 검증**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/daily-newsletter.yml','utf8');console.log(s.includes('cron')?'ok':'missing cron')"`
Expected: `ok` (또는 에디터/actionlint로 YAML 파싱 확인)

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/daily-newsletter.yml
git commit -m "feat(newsletter): send from site articles at 08:00 KST, drop collect/curate steps"
```

---

### Task 4: daily_card 파이프라인 폐기

**Files:**
- Delete: `.github/workflows/publish-daily-news.yml`
- Delete: `generators/web/publish-daily-cards-to-site.js`
- Modify: `package.json` (`publish:daily-cards`, `daily:cards` 스크립트 삭제)
- Modify: `db/SCHEMA.md` (daily_card 행에 폐기 표기)

- [ ] **Step 1: 파일 삭제**

```bash
git rm .github/workflows/publish-daily-news.yml
git rm generators/web/publish-daily-cards-to-site.js
```

- [ ] **Step 2: package.json 스크립트 삭제**

다음 두 줄을 삭제:

```json
    "publish:daily-cards": "node generators/web/publish-daily-cards-to-site.js",
```

```json
    "daily:cards": "npm run daily:collect && npm run daily:curate && npm run publish:daily-cards",
```

- [ ] **Step 3: db/SCHEMA.md의 daily_card 행 갱신**

기존:

```markdown
| `daily_card` | 이메일 일간 카드 | generators/web/publish-daily-cards-to-site.js |
```

변경:

```markdown
| `daily_card` | (2026-06-12 폐기 — 신규 생성 없음, 기존 행만 잔존) | (삭제됨) |
```

- [ ] **Step 4: 잔여 참조 0건 확인**

Run: `git grep -n "publish:daily-cards\|publish-daily-cards\|publish-daily-news" -- ':!docs' ':!node_modules'`
Expected: 출력 없음 (docs 폴더의 과거 계획·스펙 문서는 기록이므로 제외)

- [ ] **Step 5: 커밋**

```bash
git add package.json db/SCHEMA.md
git commit -m "chore(news): retire unused daily_card pipeline (publish-daily-news workflow)"
```

---

### Task 5: 최종 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 테스트 + 린트**

Run: `npm run test:email`
Expected: PASS

Run: `npm run lint`
Expected: 신규 파일에 대한 에러 0건 (기존 파일의 사전 존재 경고는 무시)

- [ ] **Step 2: 스펙 검증 기준 대조**

스펙(`2026-06-12-daily-newsletter-from-site-design.md`)의 검증 기준 5개 확인:
1. 로컬 실행으로 HTML 생성 ✓ (Task 2 Step 3)
2. 카드 링크 `…/article/{slug}` 형식 ✓ (Task 1 테스트 + Task 2 Step 3 육안 확인)
3. 0건 시 HTML 미생성 + exit 0 ✓ (스크립트 `return` 경로)
4. workflow_dispatch 수동 실행 → INTERNAL_EMAIL 수신 확인 — **push 후 GitHub Actions에서 사람이 확인** (이 계획 범위 밖, 사용자 액션)
5. `publish:daily-cards` 참조 0건 ✓ (Task 4 Step 4)

- [ ] **Step 3: push 및 수동 실행 안내**

```bash
git push
```

push 후 GitHub → Actions → "Daily Newsletter" → Run workflow로 수동 실행해 INTERNAL_EMAIL 수신을 확인한다 (검증 기준 4).
