# Weekly Briefing 자동 생성기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지난 7일 brief 기사에서 주제별(시황·기업·글로벌) 메인 1건씩을 DeepSeek으로 뽑아 `weekly_briefings` + `weekly_briefing_points`에 매주 월요일 자동 적재하는 생성기를 만든다.

**Architecture:** 순수 함수 lib(`weekly-briefing.lib.js` — 날짜·부제·프롬프트·point 변환)와 I/O 메인 스크립트(`generate-weekly-briefing.js` — Supabase 조회 + DeepSeek + upsert)를 분리한다. lib은 `node:test`로 단위 테스트. 월요일 cron 워크플로가 메인을 실행한다.

**Tech Stack:** Node.js (CommonJS), `@supabase/supabase-js`, `generators/lib/deepseek` 의 `callDeepSeekJson`(json_object 모드, 재시도 내장), `node:test` + `node:assert/strict`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-12-weekly-briefing-generator-design.md`

**⚠️ 시간대 주의:** 워크플로 cron이 `0 22 * * 0`(일요일 22:00 UTC = 월요일 07:00 KST). 날짜 계산은 모두 KST(UTC+9) 기준이어야 한다 — lib의 `mondayOf()`가 UTC+9 보정 후 월요일을 구한다.

**프론트 계약(불변):** point의 `agent_type`은 반드시 `'shipping'`/`'corp'`/`'brief'` 리터럴, `category`는 `'시황'`/`'기업'`/`'글로벌'`, display_order는 시황=1·기업=2·글로벌=3.

---

### Task 1: 순수 함수 lib — 날짜·부제·프롬프트·point 변환

**Files:**
- Create: `generators/web/lib/weekly-briefing.lib.js`
- Test: `generators/web/lib/weekly-briefing.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

`generators/web/lib/weekly-briefing.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mondayOf, subtitleFor, buildSelectionMessages, toPoints } = require('./weekly-briefing.lib');

test('mondayOf: 목요일(KST) → 같은 주 월요일', () => {
  // 2026-06-11은 목요일(KST). 그 주 월요일은 2026-06-08
  assert.equal(mondayOf(new Date('2026-06-11T03:00:00Z')), '2026-06-08');
});

test('mondayOf: 일요일 22:00 UTC = 월요일 07:00 KST → 그날(월) 반환', () => {
  // 2026-06-07T22:00:00Z = 2026-06-08 07:00 KST (월). 월요일은 2026-06-08
  assert.equal(mondayOf(new Date('2026-06-07T22:00:00Z')), '2026-06-08');
});

test('mondayOf: 월요일 00:30 KST(=일 15:30 UTC) → 그 월요일', () => {
  // 2026-06-07T15:30:00Z = 2026-06-08 00:30 KST (월)
  assert.equal(mondayOf(new Date('2026-06-07T15:30:00Z')), '2026-06-08');
});

test('subtitleFor: YYYY년 M월 W주 · 시황 · 기업 · 글로벌', () => {
  // 2026-06-08은 6월 둘째 주(1~7=1주, 8~14=2주)
  assert.equal(subtitleFor('2026-06-08'), '2026년 6월 2주 · 시황 · 기업 · 글로벌');
});

test('buildSelectionMessages: 기사 목록과 슬롯 지시가 프롬프트에 포함', () => {
  const msgs = buildSelectionMessages([
    { category: '해상', title: 'A운임 급등', summary: '4300弗' },
    { category: '물류', title: 'DSV 실적', summary: '매출 69%' },
  ]);
  assert.equal(msgs.length, 1);
  const text = msgs[0].content;
  assert.ok(text.includes('[해상] A운임 급등'));
  assert.ok(text.includes('[물류] DSV 실적'));
  assert.ok(text.includes('shipping'));
  assert.ok(text.includes('corp'));
  assert.ok(text.includes('brief'));
  assert.ok(text.includes('content'));
});

test('toPoints: 빈 슬롯 제외, display_order 시황1·기업2·글로벌3', () => {
  const points = toPoints('bid-1', { shipping: '시황 헤드', corp: '', brief: '글로벌 헤드' });
  assert.deepEqual(points, [
    { briefing_id: 'bid-1', agent_type: 'shipping', category: '시황', headline: '시황 헤드', display_order: 1 },
    { briefing_id: 'bid-1', agent_type: 'brief', category: '글로벌', headline: '글로벌 헤드', display_order: 3 },
  ]);
});

test('toPoints: 모든 슬롯 비면 빈 배열', () => {
  assert.deepEqual(toPoints('bid-1', { shipping: '', corp: '', brief: '' }), []);
  assert.deepEqual(toPoints('bid-1', {}), []);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test generators/web/lib/weekly-briefing.test.js`
Expected: FAIL — `Cannot find module './weekly-briefing.lib'`

- [ ] **Step 3: lib 구현**

`generators/web/lib/weekly-briefing.lib.js`:

```js
// generators/web/lib/weekly-briefing.lib.js
// 주간 브리핑 생성 보조 — 순수 함수만 (I/O·DeepSeek 호출 없음)
'use strict';

// 슬롯 정의: 프론트 계약 (agent_type 리터럴 + 한글 라벨 + 순서)
const SLOTS = [
  { key: 'shipping', category: '시황', order: 1 },
  { key: 'corp', category: '기업', order: 2 },
  { key: 'brief', category: '글로벌', order: 3 },
];

// KST(UTC+9) 기준 그 주 월요일을 "YYYY-MM-DD"로
function mondayOf(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const dow = kst.getUTCDay(); // 0=일 … 1=월
  const diff = (dow + 6) % 7;  // 월요일까지 거슬러 갈 일수
  const monday = new Date(kst.getTime() - diff * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

// "YYYY년 M월 W주 · 시황 · 기업 · 글로벌"  (W = 그 달의 몇째 주, day 1~7=1주)
function subtitleFor(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const week = Math.floor((d - 1) / 7) + 1;
  return `${y}년 ${m}월 ${week}주 · 시황 · 기업 · 글로벌`;
}

// 지난 7일 brief 기사 목록 → DeepSeek messages 1개
function buildSelectionMessages(articles) {
  const list = articles
    .map((a, i) => `${i + 1}. [${a.category || ''}] ${a.title || ''} — ${a.summary || ''}`)
    .join('\n');
  const content = `당신은 한국 해운·물류 전문 매체의 주간 브리핑 편집장이다.
아래는 지난 7일간 발행된 기사 목록이다. 세 주제별로 가장 중요한 기사 1건씩을 고르고,
각 기사를 KSG(코리아쉬핑가제트) 스타일 헤드라인(명사형 종결, 25~40자, 수치·한자기호 弗·億·%·↑↓ 적극 활용)으로 다시 써라.

주제 정의:
- shipping(시황): 해상·항공·철도 운임/시황 동향
- corp(기업): 선사·포워더·물류기업(Maersk·MSC·HMM·DSV·DHL·FedEx 등) 동향·실적·M&A
- brief(글로벌): 무역·정책·공급망·지정학

또한 위 3건을 엮은 주간 시황 분석 본문(content)을 KSG 문체로 600~1,000자, 평문 산문으로 작성하라.
~입니다·~합니다는 쓰지 말고 ~기록했다·~밝혔다·~전망했다 어미를 사용한다.

해당 주제에 적합한 기사가 없으면 그 값은 빈 문자열("")로 둔다.
반드시 아래 JSON 형식으로만 응답하라:
{"shipping":"헤드라인 또는 \\"\\"","corp":"...","brief":"...","content":"주간 분석 본문"}

기사 목록:
${list}`;
  return [{ role: 'user', content }];
}

// 선정 JSON → weekly_briefing_points 행 배열 (빈 슬롯 제외)
function toPoints(briefingId, selection) {
  const out = [];
  for (const slot of SLOTS) {
    const headline = (selection && selection[slot.key] ? String(selection[slot.key]) : '').trim();
    if (!headline) continue;
    out.push({
      briefing_id: briefingId,
      agent_type: slot.key,
      category: slot.category,
      headline,
      display_order: slot.order,
    });
  }
  return out;
}

module.exports = { mondayOf, subtitleFor, buildSelectionMessages, toPoints, SLOTS };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test generators/web/lib/weekly-briefing.test.js`
Expected: 7 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add generators/web/lib/weekly-briefing.lib.js generators/web/lib/weekly-briefing.test.js
git commit -m "feat(weekly): briefing lib (mondayOf, subtitleFor, selection prompt, toPoints)"
```

---

### Task 2: 메인 스크립트 + npm 스크립트

**Files:**
- Create: `generators/web/generate-weekly-briefing.js`
- Modify: `package.json` (scripts에 `weekly:briefing` 추가)

**컨텍스트:** `weekly_briefings`(id,title,subtitle,week_of UNIQUE,published_at,content) 와
`weekly_briefing_points`(id,briefing_id FK,category,agent_type,headline,display_order)는
마이그레이션 `supabase/migrations/20260601000018_weekly_briefings.sql`에 정의됨. service_role 쓰기.
`callDeepSeekJson({ messages, max_tokens })`는 파싱된 JS 객체를 반환한다.

- [ ] **Step 1: 메인 스크립트 작성**

`generators/web/generate-weekly-briefing.js`:

```js
// generators/web/generate-weekly-briefing.js
// 지난 7일 brief 기사 → DeepSeek 주제별 톱 선정 → weekly_briefings + points 적재.
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEEPSEEK_API_KEY
'use strict';

const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;

const { createClient } = require('@supabase/supabase-js');
const { callDeepSeekJson } = require('../lib/deepseek');
const {
  mondayOf,
  subtitleFor,
  buildSelectionMessages,
  toPoints,
} = require('./lib/weekly-briefing.lib');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 없음');
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { enabled: false },
  });

  const weekOf = mondayOf();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: articles, error } = await supabase
    .from('maritime_news')
    .select('title,summary,category,fetched_at')
    .eq('agent_type', 'brief')
    .not('slug', 'is', null)
    .gte('fetched_at', since)
    .order('fetched_at', { ascending: false });
  if (error) throw new Error(error.message);

  if (!articles || articles.length === 0) {
    console.warn('⚠️ 지난 7일 brief 기사 0건 — 주간 브리핑 적재 스킵');
    return;
  }

  const selection = await callDeepSeekJson({
    messages: buildSelectionMessages(articles),
    max_tokens: 3000,
  });

  const { data: briefing, error: bErr } = await supabase
    .from('weekly_briefings')
    .upsert({
      title: '주간 시장 브리핑',
      subtitle: subtitleFor(weekOf),
      week_of: weekOf,
      published_at: new Date().toISOString(),
      content: selection.content || null,
    }, { onConflict: 'week_of' })
    .select('id')
    .single();
  if (bErr) throw new Error(bErr.message);

  // 기존 point 삭제 후 재삽입 (재실행 멱등)
  const { error: dErr } = await supabase
    .from('weekly_briefing_points')
    .delete()
    .eq('briefing_id', briefing.id);
  if (dErr) throw new Error(dErr.message);

  const points = toPoints(briefing.id, selection);
  if (points.length > 0) {
    const { error: pErr } = await supabase.from('weekly_briefing_points').insert(points);
    if (pErr) throw new Error(pErr.message);
  }

  console.log(`✅ 주간 브리핑 적재: week_of=${weekOf}, points=${points.length}`);
  for (const p of points) console.log(`   [${p.category}] ${p.headline}`);
}

main().catch((e) => {
  console.error('❌ generate-weekly-briefing 실패:', e.message);
  process.exit(1);
});
```

- [ ] **Step 2: package.json 스크립트 추가**

`package.json`의 `"publish:curated"` 줄 아래에 추가:

```json
    "publish:curated": "node generators/web/publish-curated-to-site.js",
    "weekly:briefing": "node generators/web/generate-weekly-briefing.js",
```

- [ ] **Step 3: 로컬 실행 검증**

Run: `npm run weekly:briefing`
Expected (7일 brief 기사가 있을 때): `✅ 주간 브리핑 적재: week_of=YYYY-MM-DD, points=N` 와
각 `[시황]/[기업]/[글로벌]` 헤드라인 로그.
Expected (0건일 때): `⚠️ 지난 7일 brief 기사 0건 — 주간 브리핑 적재 스킵` + exit 0.

DeepSeek/Supabase 키가 `.env.local`에 있어야 실제 적재가 일어난다. 적재 후 Supabase에서
`weekly_briefings` 최신 행과 `weekly_briefing_points` 3행을 확인한다.

- [ ] **Step 4: 단위 테스트 재확인**

Run: `node --test generators/web/lib/`
Expected: PASS (weekly-briefing + news-pipeline 테스트 모두)

- [ ] **Step 5: 커밋**

```bash
git add generators/web/generate-weekly-briefing.js package.json
git commit -m "feat(weekly): generate weekly briefing from past-7-day brief articles"
```

---

### Task 3: 월요일 워크플로

**Files:**
- Create: `.github/workflows/weekly-briefing.yml`

- [ ] **Step 1: 워크플로 작성**

`.github/workflows/weekly-briefing.yml`:

```yaml
# .github/workflows/weekly-briefing.yml
# 지난 7일 brief 기사에서 주제별 메인을 뽑아 weekly_briefings에 적재 (홈 주간 브리핑 카드).
# Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEEPSEEK_API_KEY
name: Weekly Briefing

on:
  schedule:
    - cron: '0 22 * * 0'   # 월요일 07:00 KST (일요일 22:00 UTC)
  workflow_dispatch:

jobs:
  briefing:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Generate weekly briefing
        run: npm run weekly:briefing
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
```

- [ ] **Step 2: YAML 검증**

Run: `node -e "const s=require('fs').readFileSync('.github/workflows/weekly-briefing.yml','utf8');console.log(s.includes('cron')&&s.includes('weekly:briefing')?'ok':'check failed')"`
Expected: `ok`

- [ ] **Step 3: 커밋**

```bash
git add .github/workflows/weekly-briefing.yml
git commit -m "feat(weekly): Monday 07:00 KST workflow for weekly briefing"
```

---

### Task 4: SCHEMA.md 소유관계 갱신

**Files:**
- Modify: `db/SCHEMA.md`

- [ ] **Step 1: weekly_briefings 소유자 표기 수정**

`db/SCHEMA.md`에서 다음 두 줄을 찾는다:

```markdown
| weekly_briefings | 018 | pipeline/generators/email | Lovable /news | ✅ | |
| weekly_briefing_points | 018 | pipeline/generators/email | Lovable /news | ✅ | |
```

다음으로 교체:

```markdown
| weekly_briefings | 018 | generators/web/generate-weekly-briefing.js | Lovable /news | ✅ | 매주 월요일 자동 적재 |
| weekly_briefing_points | 018 | generators/web/generate-weekly-briefing.js | Lovable /news | ✅ | shipping/corp/brief 슬롯 |
```

- [ ] **Step 2: 커밋**

```bash
git add db/SCHEMA.md
git commit -m "docs(schema): weekly_briefings owned by generate-weekly-briefing.js"
```

---

### Task 5: 최종 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 테스트**

Run: `node --test generators/web/lib/`
Expected: PASS (weekly-briefing 7개 + 기존 news-pipeline 6개)

- [ ] **Step 2: 스펙 검증 기준 대조**

스펙 `2026-06-12-weekly-briefing-generator-design.md`의 검증 기준 5개:
1. `npm run weekly:briefing` → weekly_briefings 1행 + points 최대 3행 — Task 2 Step 3
2. point agent_type 'shipping'/'corp'/'brief' 리터럴 — Task 1 toPoints 테스트 + Task 2
3. week_of KST 이번 주 월요일 — Task 1 mondayOf 테스트
4. 7일 0건 시 exit 0 스킵 — Task 2 스크립트 early return
5. `node --test generators/web/lib/` 통과 — Task 5 Step 1

- [ ] **Step 3: push 및 수동 실행 안내**

```bash
git push
```

push 후 GitHub → Actions → "Weekly Briefing" → Run workflow로 수동 실행, Supabase에서
`weekly_briefings`·`weekly_briefing_points` 적재 확인 + 홈 카드 갱신 확인 (검증 기준 1·2).
