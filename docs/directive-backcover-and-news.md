# Directive: Back Cover & News Pages — Monthly Report Standard

> Reference document for all monthly report generation agents.
> Applies to: `generators/report/monthly-report-pdf.js`, `generators/report/assemble-monthly-report.js`

---

## §1. PDF Renderer — Implementation Spec

### §1-1. `[[NEWS: url :: headline :: summary :: source·date]]` Token

**Token format** (placed in Markdown body):
```
[[NEWS: https://example.com/article :: 헤드라인 :: 요약 1~2문장 :: 출처·날짜]]
```

**Rendering** (in `main()` of `monthly-report-pdf.js`, after the OGIMG processing block):

```js
// [[NEWS: url :: headline :: summary :: source]] → news card
const newsRe = /<p>\s*\[\[NEWS:\s*([\s\S]*?)\]\]\s*<\/p>|\[\[NEWS:\s*([\s\S]*?)\]\]/g;
bodyHtml = bodyHtml.replace(newsRe, (_m, a, b) => {
  const inner = (a || b || '').replace(/<[^>]+>/g, '').trim();
  const parts = inner.split('::').map(s => s.trim());
  const [url, headline, summary, srcDate] = parts;
  if (!url || !headline) return '';
  return (
    '<div class="news-card">' +
    '<div class="news-headline">' + escapeHtml(headline) + '</div>' +
    (summary ? '<p class="news-summary">' + escapeHtml(summary) + '</p>' : '') +
    '<div class="news-meta">' + escapeHtml(srcDate || '') + '</div>' +
    '</div>'
  );
});
```

**CSS** (add after `.stat-cap` rule in `buildHtml` style block):
```css
/* 뉴스 카드 (03-4 / 04-3 기사 페이지) */
.news-card{background:#fff;border:1px solid var(--c-band-gray);border-top:3px solid var(--c-teal);
  padding:5mm 6mm;margin:4mm 0;break-inside:avoid}
.news-headline{font-family:var(--font-title);font-size:13pt;font-weight:800;color:var(--c-ink);
  margin-bottom:3mm;line-height:1.3}
.news-summary{font-size:9.5pt;color:var(--c-body);margin:0 0 3mm;line-height:1.6}
.news-meta{font-size:8pt;color:var(--c-caption);font-weight:600;letter-spacing:1px}
```

### §1-2. Back Cover

**Position**: Last page of PDF, after `<main class="flow">`.

**HTML template** (inject into `buildHtml`, after `</main>`):
```html
<section class="backcover">
  <div class="bc-brand">LOGISIGHT</div>
  <div class="bc-rule"></div>
  <div class="bc-statement">Global Logistics &amp; Market Intelligence<br>해운·항공·철도 운임과 공급망 동향 종합 분석</div>
  <div class="bc-disclaimer">본 리포트는 공개 출처 기반 분석이며, 수치는 Logisight 지표 대시보드를 참조 바람. 무단 전재·재배포 금지.</div>
  <div class="bc-contact">contact@logisight.com · www.logisight.com</div>
  <div class="bc-copy">© ${Number(YY)} Logisight / MTL Shipping Agency. All rights reserved.</div>
</section>
```
Note: `YY` and `MM` are already available as module-level constants in `monthly-report-pdf.js`.

**CSS** (add after `.chart-box.no-data` rule):
```css
/* 뒷표지 */
.backcover{width:210mm;height:296mm;position:relative;overflow:hidden;break-before:page;
  background:linear-gradient(160deg,#4D4D4D 0%,#363636 100%);
  color:#fff;padding:32mm 24mm;display:flex;flex-direction:column;justify-content:flex-end;gap:0}
.bc-brand{font-family:var(--font-title);font-size:22pt;font-weight:800;letter-spacing:3px;color:#fff;margin-bottom:6mm}
.bc-rule{width:24mm;height:3px;background:var(--c-primary);margin-bottom:8mm}
.bc-statement{font-size:11pt;color:rgba(255,255,255,.8);line-height:1.7;margin-bottom:auto;padding-bottom:20mm}
.bc-disclaimer{font-size:8pt;color:rgba(255,255,255,.5);line-height:1.6;margin-bottom:4mm}
.bc-contact{font-size:8.5pt;color:rgba(255,255,255,.65);margin-bottom:2mm}
.bc-copy{font-size:7.5pt;color:rgba(255,255,255,.4)}
```

**Bleed page rule** — add `.backcover` to the existing `@page bleed` selector:
```css
/* BEFORE */
.cover,.divider,.toc{page:bleed}

/* AFTER */
.cover,.divider,.toc,.backcover{page:bleed}
```

### §1-3. `stripCitations` URL-removal regex — protect OGIMG/NEWS tokens

The `stripCitations` function must NOT remove lines that contain `[[OGIMG:` or `[[NEWS:` tokens.

**Current line** (in `stripCitations` function body):
```js
.replace(/^[^\n]*https?:\/\/[^\s)]+[^\n]*$/gm, '')
```

**Replace with** (negative lookahead protects token lines):
```js
.replace(/^(?!.*\[\[(?:OGIMG|NEWS):)[^\n]*https?:\/\/[^\s)]+[^\n]*$/gm, '')
```

---

## §2. Assembler — News Page Injection Spec

### §2-1. News page selection criteria

When assembling, select 2 news articles per mode (air / rail) from `content/drafts/latest-news.json`:
1. **Mode match**: `section === 'air'` or `section === 'rail'` (or category match)
2. **OG image**: article has `ogImage` field (non-empty string)
3. **Relevance**: most recent `published_at` within the report month
4. **No duplicate**: not already cited in the section body

If 0 qualifying articles found → skip news page entirely (no empty page).

### §2-2. Insertion points

- Air news page `## 03-4. 이달의 항공 주요 기사` → inserted after `## 03-3.` content
- Rail news page `## 04-3. 이달의 철도 주요 기사` → inserted after `## 04-2.` content

### §2-3. Token generation

For each selected article:
```
[[NEWS: {url} :: {title_ko or title} :: {summary_ko or summary_en} :: {source}·{published_at.slice(0,10)}]]
```

Full page template:
```markdown
## 03-4. 이달의 항공 주요 기사

[[NEWS: https://... :: 헤드라인 :: 요약 1~2문장 :: 출처·YYYY-MM-DD]]

[[NEWS: https://... :: 헤드라인 :: 요약 1~2문장 :: 출처·YYYY-MM-DD]]
```

---

## §3. CSS Design Tokens (reference — do not change values)

All colors reference existing CSS variables from `monthly-report-pdf.js`:
```
--c-primary: #0070C0    (blue — accent)
--c-teal: #008C8C       (teal — news card top border)
--c-ink: #1A1A1A        (headings)
--c-body: #333333       (body text)
--c-body-soft: #555555  (labels)
--c-caption: #888888    (captions/meta)
--c-band-gray: #E6E6E6  (borders)
--font-title: 'GyeonggiTitle','Pretendard',...
--font-sans: 'Pretendard',...
```
