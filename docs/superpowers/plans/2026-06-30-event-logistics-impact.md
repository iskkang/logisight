# Event → Logistics Impact (climate:event) 생성 파이프라인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (또는 executing-plans)로 태스크 단위 실행. 체크박스(`- [ ]`)로 추적.

**Goal:** 관측 이벤트(홍수·태풍 등)가 물류 자산(특히 신규 내륙 거점)에 근접하면 Claude로 3단 영향 초안을 만들어 `forecasts(module='climate', metric_ref='climate:event:<id>')`에 적재 → logisight-core `/climate`의 RegionImpact 섹션을 채운다.

**Architecture:** 기존 route-centric `generators/web/climate/`(event→passage→route)는 그대로 두고, 병렬로 event-centric 모듈 `generators/web/climate-event/`를 추가. 이벤트 × 자산(200km, 내륙 포함) 게이트 → 가드 통과 narrate → 자동발행(코드 가드). 기존 climate 생성기와 동일 발행 철학.

**Tech Stack:** Node CommonJS (`generators/web/`), `node --test`, `@supabase/supabase-js` service-role, `forecast/llm.js`의 `callClaude`(claude-sonnet-4-6), Deno Edge Function(risk-refresh), Supabase SQL migration, GitHub Actions.

## Global Constraints

- 발행 정책 = **기존 climate와 동일**: narrate 가드 통과 + 자산 귀속 명확 → `status='published'`(auto). 가드 실패/귀속 불명 → `draft` 보류(+`auto_held` 플래그). CRITICAL 특례 없음.
- 게이트 반경 정본: `ASSET_RADIUS_KM=200`, `ROUTE_RADIUS_KM=1000`. 판정은 이벤트 원본 `severity`('r'/'a'), `severityTier` 미사용.
- `metric_ref='climate:event:<event_id>'`, `module='climate'`, `model_version='climate-event-v1'`.
- 더미·임의 수치 금지. narrate는 입력 실데이터만, 확률·추정 표현 강제, 인과 단정 금지.
- Supabase 쓰기: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, `createClient(..., {auth:{persistSession:false}, realtime:{enabled:false}})`. Node<22 `globalThis.WebSocket = require('ws')` 폴리필. dotenv `.env.local`.
- 기존 `generators/web/climate/` 동작 회귀 금지(단 Task 6 purge 범위 한정은 의도된 변경).
- 라이브러리 추가 금지. 기존 패턴·스타일 준수(logisight CLAUDE.md).

## File Structure

- `supabase/migrations/20260630000050_inland_assets.sql` (Create) — type 제약 완화 + 내륙 자산 시드
- `generators/web/climate-event/gate.js` (Create) — 순수 게이트 + `gate.test.js`
- `generators/web/climate-event/narrate.js` (Create) — buildEventPrompt + narrate(가드는 climate/narrate.js 재사용) + `narrate.test.js`
- `generators/web/climate-event/row.js` (Create) — mapEventRow/publishDecision/basis + `row.test.js`
- `generators/web/climate-event/generate.js` (Create) — 메인 루프 + `generate.test.js`
- `generators/web/climate/generate.js` (Modify) — purge 범위를 비-event 키로 한정
- `supabase/functions/risk-refresh/index.ts` (Modify) — inland 채점 분기
- `package.json` (Modify) + `.github/workflows/climate-event-generate.yml` (Create) — 스케줄

---

## Task 1: 내륙 자산 시드 마이그레이션

**Files:** Create `supabase/migrations/20260630000050_inland_assets.sql`

**Interfaces:** Produces — `assets` 테이블에 `type='inland'` 행 ~12개.

- [ ] **Step 1: 마이그레이션 작성**

기존 `supabase/migrations/20260622000037_v2_assets.sql`의 insert 패턴을 따른다. `assets.type` CHECK 제약이 `('port','choke')`로 남아 있으면 rail/inland insert가 막히므로 먼저 제약을 제거/완화한다.

```sql
-- 내륙 물류 거점(intermodal/rail hub) 자산 추가 — event→물류 영향(climate:event) 게이트 대상.
-- assets.type CHECK가 port/choke로 한정돼 있으면 완화(rail은 이미 v2에서 들어와 제약이 사라졌을 수 있음 → if exists).
alter table public.assets drop constraint if exists assets_type_check;
alter table public.assets add constraint assets_type_check
  check (type in ('port','choke','rail','inland'));

insert into public.assets (id,name,type,lon,lat,freeze_prone) values
  ('chicago',     'Chicago (intermodal)',      'inland', -87.63,  41.88, false),
  ('memphis',     'Memphis (intermodal)',      'inland', -90.05,  35.15, false),
  ('dallas',      'Dallas–Fort Worth (inland)','inland', -96.80,  32.78, false),
  ('kansas_city', 'Kansas City (intermodal)',  'inland', -94.58,  39.10, false),
  ('atlanta',     'Atlanta (inland)',          'inland', -84.39,  33.75, false),
  ('newark_inland','NY/NJ Inland (intermodal)','inland', -74.17,  40.73, false),
  ('duisburg',    'Duisburg (inland)',         'inland',   6.76,  51.43, false),
  ('milan_inland','Milan (inland terminal)',   'inland',   9.19,  45.46, false),
  ('madrid_inland','Madrid (inland terminal)', 'inland',  -3.70,  40.42, false),
  ('zhengzhou',   'Zhengzhou (inland hub)',    'inland', 113.62,  34.75, false),
  ('chongqing',   'Chongqing (inland hub)',    'inland', 106.55,  29.56, false),
  ('delhi_inland','Delhi (inland terminal)',   'inland',  77.10,  28.70, false)
on conflict (id) do update set
  name = excluded.name, type = excluded.type, lon = excluded.lon, lat = excluded.lat, freeze_prone = excluded.freeze_prone;
```

- [ ] **Step 2: SQL 정합성 검토(수동)**

좌표가 육지(내륙) 지점인지, id가 기존과 충돌하지 않는지 확인. (이 레포는 로컬 DB 적용 도구가 없으므로 적용은 Supabase 마이그레이션 배포 시. 검증 = SQL 문법·좌표 리뷰.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260630000050_inland_assets.sql
git commit -m "feat(climate-event): 내륙 물류 거점 자산 시드(type=inland)"
```

---

## Task 2: 이벤트×자산 게이트 (TDD)

**Files:** Create `generators/web/climate-event/gate.js`, `generators/web/climate-event/gate.test.js`

**Interfaces:** Produces —
- `ASSET_RADIUS_KM=200`, `ROUTE_RADIUS_KM=1000`
- `haversineKm(a,b)` (a,b=[lon,lat])
- `gateEvent(event, assets, routes, nodes)` → `{ tier:'LINKED_HIGH'|'LINKED_WATCH'|'LIMITED', nearestAsset, nearestKm, linkedAssets:[{id,name,type,km}], linkedRoutes:[{id,name}] }`. logisight-core `src/lib/climate-gate.ts`와 동일 규칙(정본 동기화).

- [ ] **Step 1: 실패 테스트 작성** — `gate.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { gateEvent } = require('./gate');

const asset = (id, lon, lat, type = 'inland') => ({ id, name: id, type, lon, lat, freeze_prone: false });
const ev = (o) => ({ id: 'e1', source: 'nws', kind: 'flood', severity: 'r', lon: 0, lat: 0, track: null, ...o });

test('자산 위 severity r → LINKED_HIGH (NWS 통과)', () => {
  const v = gateEvent(ev({ source: 'nws', severity: 'r' }), [asset('chi', 0, 0)], [], {});
  assert.equal(v.tier, 'LINKED_HIGH');
  assert.equal(v.linkedAssets.length, 1);
});
test('위도 1°(~111km) severity r → LINKED_HIGH', () => {
  assert.equal(gateEvent(ev({ lat: 1 }), [asset('chi', 0, 0)], [], {}).tier, 'LINKED_HIGH');
});
test('위도 2°(~222km) 단일 자산 → LIMITED, nearestKm>200', () => {
  const v = gateEvent(ev({ lat: 2 }), [asset('chi', 0, 0)], [], {});
  assert.equal(v.tier, 'LIMITED');
  assert.ok(v.nearestKm > 200);
});
test('반경 내 severity a → LINKED_WATCH', () => {
  assert.equal(gateEvent(ev({ severity: 'a' }), [asset('chi', 0, 0)], [], {}).tier, 'LINKED_WATCH');
});
test('severity 없음 → LIMITED', () => {
  assert.equal(gateEvent(ev({ severity: '' }), [asset('chi', 0, 0)], [], {}).tier, 'LIMITED');
});
test('좌표 없음 → LIMITED, nearestAsset null', () => {
  const v = gateEvent(ev({ lon: null, lat: null }), [asset('chi', 0, 0)], [], {});
  assert.equal(v.tier, 'LIMITED');
  assert.equal(v.nearestAsset, null);
});
test('노선 waypoint 근접(자산은 멀리) → LINKED_HIGH, linkedRoutes', () => {
  const routes = [{ id: 'r1', name: 'R1', waypoints: [[0, 0]] }];
  const v = gateEvent(ev({ severity: 'r' }), [asset('far', 100, 80)], routes, {});
  assert.equal(v.tier, 'LINKED_HIGH');
  assert.equal(v.linkedRoutes[0].name, 'R1');
  assert.equal(v.linkedAssets.length, 0);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test generators/web/climate-event/gate.test.js`
Expected: FAIL — `Cannot find module './gate'`.

- [ ] **Step 3: 게이트 구현** — `gate.js`

```js
'use strict';
// 이벤트×자산/노선 근접 게이트(결정론). logisight-core src/lib/climate-gate.ts와 동일 규칙.
// 반경 비교는 비반올림 거리, 표시 km만 반올림. 판정은 이벤트 원본 severity('r'/'a').
const ASSET_RADIUS_KM = 200;
const ROUTE_RADIUS_KM = 1000;
const R = 6371;
function haversineKm(a, b) { // a,b = [lon,lat]
  const t = Math.PI / 180;
  const dLat = (b[1] - a[1]) * t, dLon = (b[0] - a[0]) * t;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function routeCoords(r, nodes) {
  return (r.waypoints || [])
    .map((w) => (typeof w === 'string' ? (nodes[w] ? [nodes[w].lon, nodes[w].lat] : null) : w))
    .filter(Boolean);
}
function gateEvent(event, assets, routes, nodes) {
  if (event.lon == null || event.lat == null) {
    return { tier: 'LIMITED', nearestAsset: null, nearestKm: null, linkedAssets: [], linkedRoutes: [] };
  }
  const e = [event.lon, event.lat];
  const linkedAssets = [];
  let nearest = null, nearestRaw = Infinity;
  for (const a of assets) {
    const raw = haversineKm(e, [a.lon, a.lat]);
    const la = { id: a.id, name: a.name, type: a.type, km: Math.round(raw) };
    if (raw < nearestRaw) { nearest = la; nearestRaw = raw; }
    if (raw <= ASSET_RADIUS_KM) linkedAssets.push(la);
  }
  linkedAssets.sort((x, y) => x.km - y.km);
  const linkedRoutes = [];
  for (const r of routes || []) {
    let min = Infinity;
    for (const c of routeCoords(r, nodes)) { const d = haversineKm(e, c); if (d < min) min = d; }
    if (min <= ROUTE_RADIUS_KM) linkedRoutes.push({ id: r.id, name: r.name });
  }
  const linked = linkedAssets.length > 0 || linkedRoutes.length > 0;
  const sev = event.severity;
  const tier = !linked ? 'LIMITED' : sev === 'r' ? 'LINKED_HIGH' : sev === 'a' ? 'LINKED_WATCH' : 'LIMITED';
  return { tier, nearestAsset: nearest, nearestKm: nearest ? nearest.km : null, linkedAssets, linkedRoutes };
}
module.exports = { gateEvent, haversineKm, ASSET_RADIUS_KM, ROUTE_RADIUS_KM };
```

- [ ] **Step 4: 통과 확인**

Run: `node --test generators/web/climate-event/gate.test.js`
Expected: PASS (7).

- [ ] **Step 5: Commit**

```bash
git add generators/web/climate-event/gate.js generators/web/climate-event/gate.test.js
git commit -m "feat(climate-event): 이벤트-자산 근접 게이트(순수)+테스트"
```

---

## Task 3: 이벤트 narrate (프롬프트 + 가드 재사용)

**Files:** Create `generators/web/climate-event/narrate.js`, `generators/web/climate-event/narrate.test.js`

**Interfaces:**
- Consumes: `validateClimate`, `safeParse` from `../climate/narrate` (재사용 — 가드는 동일).
- Produces: `buildEventPrompt(ctx)` → `{system,user}`; `narrateEventImpact(callLLM, ctx, {maxRetries})` → `{weather,impact,action,needs_editor}`.
- `ctx` 형태: `{ asof:Date, event:{name,title,kind,severity,lon,lat,area,track}, linkedAssets:[{name,type,km,risk}], linkedRoutes:[{name}], gazetteer:[], allowedPlaces:Set }`.

- [ ] **Step 1: 실패 테스트 작성** — `narrate.test.js`

`../climate/narrate.test.js`를 템플릿으로 사용. callLLM 스텁이 유효한 3필드 JSON(+event_echo)을 반환하면 `needs_editor=false`, 단정 표현("반드시")이 들어가면 `needs_editor=true`가 되는지 검증.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { narrateEventImpact, buildEventPrompt } = require('./narrate');

const ctx = {
  asof: new Date('2026-06-30T00:00:00Z'),
  event: { name: 'Flood Warning', title: 'Flood Warning (NJ)', kind: 'flood', severity: 'r', lon: -74.17, lat: 40.73, area: 'NJ', track: null },
  linkedAssets: [{ name: 'NY/NJ Inland (intermodal)', type: 'inland', km: 5, risk: null }],
  linkedRoutes: [],
  gazetteer: ['NY/NJ Inland (intermodal)'],
  allowedPlaces: new Set(['NY/NJ Inland (intermodal)', 'NJ']),
};
const good = JSON.stringify({ weather: '홍수 경보가 인근에 발효됐다. 강수로 침수 가능성이 있다고 추정된다.', impact: '내륙 통관 후 철도 연결 리드타임 +1~2일가량 지연 가능성이 있다고 추정된다.', action: '해당 거점 경유 화물의 ETA 버퍼 확보를 권고한다.', event_echo: 'Flood Warning' });

test('유효 JSON → needs_editor=false', async () => {
  const r = await narrateEventImpact(async () => good, ctx);
  assert.equal(r.needs_editor, false);
  assert.match(r.impact, /추정/);
});
test('단정 표현 → needs_editor=true', async () => {
  const bad = JSON.stringify({ weather: '반드시 침수된다', impact: '반드시 지연된다', action: 'x', event_echo: 'Flood Warning' });
  const r = await narrateEventImpact(async () => bad, ctx, { maxRetries: 0 });
  assert.equal(r.needs_editor, true);
});
test('프롬프트에 연관 자산명이 들어간다', () => {
  const { user } = buildEventPrompt(ctx);
  assert.match(user, /NY\/NJ Inland/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test generators/web/climate-event/narrate.test.js`
Expected: FAIL — `Cannot find module './narrate'`.

- [ ] **Step 3: 구현** — `narrate.js`

`../climate/narrate.js`의 `buildClimatePrompt`를 event 프레이밍으로 변형. 출력 JSON·가드(`validateClimate`)·`safeParse`는 그대로 재사용한다. 핵심 차이: 귀속 근거 = "이벤트가 물류 자산(특히 내륙 거점)에 근접". 3단 = ① 기상/재해 상황 → ② 해당 거점·노선의 리드타임/적체 영향(내륙은 항만 통관 후 철도·트럭 구간) → ③ 권장 행동 1개.

```js
'use strict';
// 이벤트→물류 영향 AI 초안. 가드(validateClimate)·safeParse는 climate/narrate.js 재사용.
const { validateClimate, safeParse } = require('../climate/narrate');

function buildEventPrompt(ctx) {
  const { event, linkedAssets = [], linkedRoutes = [] } = ctx;
  const isSeismic = event.kind === 'earthquake' || event.kind === 'tsunami';
  const system = [
    '당신은 글로벌 물류 리스크 분석가다. 아래 "실데이터"만 사용해 한국어로 이벤트의 물류 영향 초안을 쓴다. 입력에 없는 자산·노선·수치·사실을 만들지 않는다.',
    '[중요 — 귀속 근거] 이 이벤트가 물류에 영향을 주는 이유는 "이벤트가 물류 자산(항만·내륙 거점 등)에 근접"하기 때문이다. 반드시 가장 가까운 연관 자산을 본문에 명시하라(왜 이 자산인지 = 이벤트가 근접해서).',
    '[중요 — 신호 가중] asset_risk score는 평시 기상장만 반영하며 활성 이벤트는 별개 신호다. 점수가 낮아도 활성 이벤트가 근접하면 리스크는 높을 수 있다.',
    '[내륙 거점] type=inland 자산은 항만 통관 후 철도·트럭 연결 구간이다. 영향은 "항만 통관 후 내륙 연결 지연" 관점으로 서술하라.',
    '[본문 — JSON 3필드]',
    `1) weather(${isSeismic ? '재해 상황' : '기상 리스크 변화'}): 이벤트 강도·현재 위치. ${event.track ? '예보트랙이 있으면 진행 방향만(점별 예보시각 없음 — "+N일" 시점 단정 금지).' : '점 이벤트이므로 이동 경로/시점을 지어내지 마라.'}`,
    '2) impact(영향): 연관 자산(거점)·노선의 리드타임·적체 가능성. 정량은 범위+추정만(예: "+1~3일가량 추정"), 근거 없으면 정성만. 가짜 정밀 금지.',
    '3) action(권장 행동): 화주·운영자 행동 1개.',
    '[분량] weather·impact 각 4~5문장 이내, action 1~2문장.',
    '[표현 규칙] 확률·추정 표현, 인과 단정 금지(정합/추정/상관). "확실/반드시/틀림없/분명히/~할 것이다" 금지.',
    '출력은 JSON 하나: {"weather":"...","impact":"...","action":"...","event_echo":"<이벤트명 그대로>"}.',
  ].join('\n');
  const facts = {
    기준일: ctx.asof.toISOString().slice(0, 10),
    이벤트: { 명칭: event.name, 원문_타이틀: event.title, 종류: event.kind, 심각도: event.severity === 'r' ? '경보(red)' : '주의(orange)', 현재좌표: event.lon != null ? [event.lon, event.lat] : null, 권역: event.area || null },
    예보트랙: Array.isArray(event.track) && event.track.length ? { 점수: event.track.length, 주의: '점별 예보시각 없음 — 시점 단정 금지' } : '없음(점 이벤트)',
    연관_자산: linkedAssets.map((a) => ({ 이름: a.name, 유형: a.type, 거리_km: a.km, 평시리스크: a.risk ? { score: a.risk.score, level: a.risk.level, driver: a.risk.driver } : '데이터 없음' })),
    연관_노선: linkedRoutes.map((r) => r.name),
  };
  const user = `다음 실데이터로 이벤트 물류 영향 초안을 작성하라(JSON만).\n${JSON.stringify(facts, null, 2)}`;
  return { system, user };
}

async function narrateEventImpact(callLLM, ctx, { maxRetries = 1 } = {}) {
  const prompt = buildEventPrompt(ctx);
  let last = { issues: ['미실행'] };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const parsed = safeParse(await callLLM(prompt));
    const v = validateClimate(parsed, ctx);
    last = v;
    if (v.ok) return { weather: parsed.weather.trim(), impact: parsed.impact.trim(), action: parsed.action.trim(), needs_editor: false };
  }
  return { weather: null, impact: null, action: null, needs_editor: true, validation_issues: last.issues };
}

module.exports = { buildEventPrompt, narrateEventImpact };
```

> 주의: `validateClimate`는 `ctx.event.name`, `ctx.gazetteer`, `ctx.allowedPlaces`를 참조한다 — Task 5 generate.js가 ctx에 이 필드를 채워야 한다(gazetteer=연관/근접 자산명, allowedPlaces=연관 자산명+event.area).

- [ ] **Step 4: 통과 확인**

Run: `node --test generators/web/climate-event/narrate.test.js`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add generators/web/climate-event/narrate.js generators/web/climate-event/narrate.test.js
git commit -m "feat(climate-event): 이벤트 영향 narrate(프롬프트+가드 재사용)+테스트"
```

---

## Task 4: forecasts row 빌더 (자동발행 게이트, TDD)

**Files:** Create `generators/web/climate-event/row.js`, `generators/web/climate-event/row.test.js`

**Interfaces:**
- Produces: `publishDecisionEvent(ctx, prose)` → `{publish, reason}`; `buildEventBasis(ctx)` → string[]; `mapEventRow(ctx, prose, asof)` → forecasts row.
- `ctx` 추가 필드: `event`, `linkedAssets`, `linkedRoutes`. `MODEL_VERSION='climate-event-v1'`.

- [ ] **Step 1: 실패 테스트 작성** — `row.test.js`

`../climate/row.test.js` 템플릿. 검증:
- 가드 통과 + 연관 자산 있음 → `status='published'`, `published_at` 채워짐, `metric_ref==='climate:event:e1'`, `module==='climate'`.
- `needs_editor=true` → `status='draft'`, `data_quality_flags`에 `auto_held` 포함.
- 연관 자산/노선 없음(귀속 불명) → draft 보류.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mapEventRow, publishDecisionEvent } = require('./row');

const asof = new Date('2026-06-30T00:00:00Z');
const baseCtx = {
  event: { id: 'e1', name: 'Flood Warning', title: 'Flood Warning (NJ)', kind: 'flood', severity: 'r', area: 'NJ' },
  linkedAssets: [{ name: 'NY/NJ Inland (intermodal)', type: 'inland', km: 5, risk: null }],
  linkedRoutes: [],
};
const goodProse = { weather: 'w', impact: 'i', action: 'a', needs_editor: false };

test('가드 통과+자산 귀속 → published', () => {
  const row = mapEventRow(baseCtx, goodProse, asof);
  assert.equal(row.module, 'climate');
  assert.equal(row.metric_ref, 'climate:event:e1');
  assert.equal(row.status, 'published');
  assert.ok(row.published_at);
  assert.ok(row.data_quality_flags.includes('auto_published'));
});
test('needs_editor → draft 보류(auto_held)', () => {
  const row = mapEventRow(baseCtx, { weather: null, impact: null, action: null, needs_editor: true }, asof);
  assert.equal(row.status, 'draft');
  assert.ok(row.data_quality_flags.some((f) => f.startsWith('auto_held')));
});
test('연관 자산/노선 없음 → 보류', () => {
  const d = publishDecisionEvent({ ...baseCtx, linkedAssets: [], linkedRoutes: [] }, goodProse);
  assert.equal(d.publish, false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test generators/web/climate-event/row.test.js` → FAIL (`Cannot find module './row'`).

- [ ] **Step 3: 구현** — `row.js`

`../climate/row.js` 패턴을 따른다(EDITOR_PLACEHOLDER, statement 3단 결합, `[기상 리스크 변화]`/`[영향]` 헤더 + `[권장 행동]` impact_note, publish 시 flags `auto_published`).

```js
'use strict';
// 이벤트→물류 영향 forecasts 행. 자동발행 게이트 = narrate 가드 통과 + 자산/노선 귀속.
const { validateClimate } = require('../climate/narrate'); // 재사용 안 함 — 자리표시자만 필요 시 제거
const MODEL_VERSION = 'climate-event-v1';
const GATE_VERSION = 'climate-event-gate-v1';
const EDITOR_PLACEHOLDER = '[AI 초안 · 에디터 검수 필요 — 본문 작성]';
const SEV_KO = { r: '경보(red)', a: '주의(orange)' };
const SITUATION_HEADER = { earthquake: '[지진 상황]', tsunami: '[쓰나미 상황]' };

function addDays(d, n) { return new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10); }

function publishDecisionEvent(ctx, prose) {
  if (prose.needs_editor) return { publish: false, reason: 'guard_fail' };
  if (!(ctx.linkedAssets && ctx.linkedAssets.length) && !(ctx.linkedRoutes && ctx.linkedRoutes.length)) return { publish: false, reason: 'no_attribution' };
  return { publish: true, reason: null };
}

function buildEventBasis(ctx) {
  const { event, linkedAssets = [], linkedRoutes = [] } = ctx;
  const b = [`이벤트: ${event.title} · ${SEV_KO[event.severity] || event.severity}`];
  if (linkedAssets[0]) b.push(`연관 거점: ${linkedAssets[0].name}(${linkedAssets[0].type}) · ${linkedAssets[0].km}km`);
  for (const a of linkedAssets.slice(1, 3)) b.push(`연관 거점: ${a.name}(${a.type}) · ${a.km}km`);
  if (linkedRoutes.length) b.push(`연관 노선: ${linkedRoutes.map((r) => r.name).join(', ')}`);
  return b;
}

function mapEventRow(ctx, prose, asof) {
  const { event } = ctx;
  const { publish, reason } = publishDecisionEvent(ctx, prose);
  const head = SITUATION_HEADER[event.kind] || '[기상 리스크 변화]';
  const statement = prose.needs_editor
    ? EDITOR_PLACEHOLDER
    : `${head}\n${prose.weather}\n\n[영향]\n${prose.impact}`;
  const confidence = event.severity === 'r' && event.kind === 'cyclone' ? 'medium' : 'low';
  const gateFlags = publish ? ['auto_published'] : ['auto_held', `hold:${reason}`];
  return {
    module: 'climate',
    metric_ref: `climate:event:${event.id}`,
    statement,
    impact_note: prose.needs_editor ? null : `[권장 행동] ${prose.action}`,
    horizon_date: addDays(asof, 3),
    confidence,
    confidence_reason: publish ? `자산 근접 자동발행(${GATE_VERSION}): ${(ctx.linkedAssets[0] || {}).name || (ctx.linkedRoutes[0] || {}).name} 근접 — 코드 가드 통과` : `보류: ${reason}`,
    invalidation_condition: '이벤트 해제·경보 하향 시 무효',
    basis: buildEventBasis(ctx),
    data_quality_flags: ['climate_event', ...gateFlags, `gate:${GATE_VERSION}`],
    model_version: MODEL_VERSION,
    status: publish ? 'published' : 'draft',
    published_at: publish ? asof.toISOString() : null,
  };
}

module.exports = { mapEventRow, publishDecisionEvent, buildEventBasis, MODEL_VERSION, EDITOR_PLACEHOLDER };
```

> 정리: 위 `const { validateClimate } = require(...)` 줄은 사용하지 않으면 **삭제**(orphan import 금지). 구현 시 실제 필요 없으면 빼라.

- [ ] **Step 4: 통과 확인** — `node --test generators/web/climate-event/row.test.js` → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add generators/web/climate-event/row.js generators/web/climate-event/row.test.js
git commit -m "feat(climate-event): forecasts row 빌더(자동발행 게이트)+테스트"
```

---

## Task 5: 생성 메인 루프 (TDD)

**Files:** Create `generators/web/climate-event/generate.js`, `generators/web/climate-event/generate.test.js`

**Interfaces:**
- Consumes: `gateEvent` (Task 2), `narrateEventImpact` (Task 3), `mapEventRow` (Task 4).
- Produces: `generateEventDrafts(supabase, callLLM, {asof, dryRun})` → 통계. `../climate/generate.js`의 `generateClimateDrafts` 구조(주입식 supabase+callLLM, dedup, purge)를 모델로 한다.

핵심 차이 vs climate/generate.js:
- 입력 = `events` + `assets` + `asset_risk`(+`routes` for linkedRoutes). `event_route_impacts` 안 씀.
- 각 이벤트에 `gateEvent` 적용 → `tier !== 'LIMITED'`만 처리(LINKED_HIGH/WATCH).
- `nodes` = assetId→asset 맵(노선 문자열 waypoint 해소용).
- ctx: `{ asof, event:{...,name}, linkedAssets:[{...,risk:riskH0[id]}], linkedRoutes, gazetteer:assets 이름, allowedPlaces:Set(연관자산명+event.area) }`.
- dedup/insert/update: climate/generate.js와 동일(`metric_ref`+`model_version='climate-event-v1'`).
- **purge: `metric_ref like 'climate:event:%'` 이고 이번 currentKeys에 없는 draft만 삭제**(다른 climate 키 건드리지 않음).

- [ ] **Step 1: 실패 테스트 작성** — `generate.test.js`

`../climate/generate.test.js`를 템플릿으로 fake supabase(메모리 배열) + 스텁 callLLM 사용. 검증:
- 자산 위 severity r 이벤트 1건 → forecasts insert 1건, `metric_ref='climate:event:<id>'`, `status='published'`.
- LIMITED 이벤트(자산 멀리)는 forecasts 미생성.

(fake supabase는 climate/generate.test.js의 헬퍼 형태를 그대로 복제해 `from(table)`별 select/insert/update/delete/eq 체이닝을 흉내낸다. 그 파일을 참고해 동일 패턴으로 작성.)

- [ ] **Step 2: 실패 확인** — `node --test generators/web/climate-event/generate.test.js` → FAIL.

- [ ] **Step 3: 구현** — `generate.js`

`../climate/generate.js`를 모델로 작성하되 위 "핵심 차이"를 반영. main()은 climate/generate.js와 동일(dotenv, ws 폴리필, createClient, callClaude 주입, dry-run 플래그). 루프 골격:

```js
'use strict';
const path = require('path');
const { gateEvent } = require('./gate');
const { narrateEventImpact } = require('./narrate');
const { mapEventRow, MODEL_VERSION } = require('./row');

function eventName(title) { return String(title || '').replace(/\s*\(.*\)\s*$/, '').trim() || '이벤트'; }

async function generateEventDrafts(supabase, callLLM, { asof = new Date(), dryRun = false } = {}) {
  const [{ data: events }, { data: assets }, { data: routes }, { data: risk }] = await Promise.all([
    supabase.from('events').select('id,source,kind,title,severity,lon,lat,area,track'),
    supabase.from('assets').select('id,name,type,lon,lat'),
    supabase.from('routes').select('id,name,waypoints'),
    supabase.from('asset_risk').select('asset_id,horizon_days,score,level,driver'),
  ]);
  const nodes = {}; (assets || []).forEach((a) => { nodes[a.id] = a; });
  const riskH0 = {}; (risk || []).forEach((r) => { if (r.horizon_days === 0) riskH0[r.asset_id] = r; });
  const gazetteer = (assets || []).map((a) => a.name).filter(Boolean);

  const res = { events: (events || []).length, linked: 0, inserted: 0, updated: 0, skippedExisting: 0, needsEditor: 0, errors: 0, purged: 0 };
  const currentKeys = new Set();

  for (const e of events || []) {
    const v = gateEvent(e, assets || [], routes || [], nodes);
    if (v.tier === 'LIMITED') continue;
    res.linked++;
    const linkedAssets = v.linkedAssets.map((a) => ({ ...a, risk: riskH0[a.id] || null }));
    const allowedPlaces = new Set([e.area, ...linkedAssets.map((a) => a.name)].filter(Boolean));
    const ctx = { asof, event: { ...e, name: eventName(e.title) }, linkedAssets, linkedRoutes: v.linkedRoutes, gazetteer, allowedPlaces };
    const prose = await narrateEventImpact(callLLM, ctx);
    if (prose.needs_editor) res.needsEditor++;
    const row = mapEventRow(ctx, prose, asof);
    currentKeys.add(row.metric_ref);
    if (dryRun) { console.log(`· [dry:${row.status}] ${row.metric_ref} (${ctx.event.name})`); continue; }
    const { data: existing } = await supabase.from('forecasts').select('id,status').eq('metric_ref', row.metric_ref).eq('model_version', MODEL_VERSION).limit(1);
    let error = null, action = 'insert';
    if (existing && existing.length) {
      if (existing[0].status !== 'draft') { res.skippedExisting++; continue; }
      action = 'update';
      ({ error } = await supabase.from('forecasts').update(row).eq('id', existing[0].id));
    } else {
      ({ error } = await supabase.from('forecasts').insert(row));
    }
    if (error) { res.errors++; console.error(`❌ ${action} [${row.metric_ref}]: ${error.message}`); }
    else { action === 'update' ? res.updated++ : res.inserted++; console.log(`✅ ${row.status} [${row.metric_ref}] ${ctx.event.name}`); }
  }

  // purge: 이번에 재생성 안 된 climate:event draft만 삭제(다른 climate 키 불간섭).
  if (!dryRun) {
    const { data: old } = await supabase.from('forecasts').select('id,metric_ref').eq('module', 'climate').eq('status', 'draft').like('metric_ref', 'climate:event:%');
    for (const d of (old || []).filter((x) => !currentKeys.has(x.metric_ref))) {
      const { error } = await supabase.from('forecasts').delete().eq('id', d.id);
      if (!error) res.purged++;
    }
  }
  return res;
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.local') });
  if (typeof globalThis.WebSocket === 'undefined') { try { globalThis.WebSocket = require('ws'); } catch (_) {} }
  const dryRun = process.argv.includes('--dry-run');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE 환경변수 없음');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 미설정');
  const { createClient } = require('@supabase/supabase-js');
  const { callClaude } = require('../forecast/llm');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, realtime: { enabled: false } });
  const res = await generateEventDrafts(supabase, callClaude, { dryRun });
  console.log(`📊 events ${res.events} · linked ${res.linked} · 신규 ${res.inserted} · 갱신 ${res.updated} · 보존 ${res.skippedExisting} · 폐기 ${res.purged} · 에디터필요 ${res.needsEditor} · 오류 ${res.errors}${dryRun ? ' (DRY RUN)' : ''}`);
}
if (require.main === module) main().catch((e) => { console.error('climate-event generate 실패:', e.message); process.exit(1); });
module.exports = { generateEventDrafts };
```

> `.like(...)` 체이닝이 fake supabase 테스트에서도 동작하도록 테스트 헬퍼에 `like`를 포함시킬 것.

- [ ] **Step 4: 통과 확인** — `node --test generators/web/climate-event/generate.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add generators/web/climate-event/generate.js generators/web/climate-event/generate.test.js
git commit -m "feat(climate-event): 생성 메인 루프(이벤트×자산 게이트→자동발행)+테스트"
```

---

## Task 6: 기존 climate purge 범위 한정 (교차삭제 방지)

**Files:** Modify `generators/web/climate/generate.js`

**문제:** `climate/generate.js`의 purge(line ~109)는 `module='climate' status='draft'` 전체에서 자기 currentKeys에 없는 것을 삭제 → Task 5가 만든 `climate:event:%` draft를 지운다. 반대로 Task 5 purge는 이미 `climate:event:%`로 한정돼 안전.

- [ ] **Step 1: purge 쿼리에 prefix 제외 추가**

`generators/web/climate/generate.js`의 기존:
```js
    const { data: old } = await supabase.from('forecasts').select('id,metric_ref').eq('module', 'climate').eq('status', 'draft');
    for (const d of (old || []).filter((x) => !currentKeys.has(x.metric_ref))) {
```
교체:
```js
    const { data: old } = await supabase.from('forecasts').select('id,metric_ref').eq('module', 'climate').eq('status', 'draft');
    // climate:event:%(이벤트-자산 생성기 소관)는 이 route-centric purge에서 제외 — 교차삭제 방지.
    for (const d of (old || []).filter((x) => !currentKeys.has(x.metric_ref) && !String(x.metric_ref).startsWith('climate:event:'))) {
```

- [ ] **Step 2: 기존 climate 테스트 회귀 확인**

Run: `node --test generators/web/climate/` 
Expected: 기존 테스트 모두 PASS(이 변경은 event 키만 추가 제외).

- [ ] **Step 3: Commit**

```bash
git add generators/web/climate/generate.js
git commit -m "fix(climate): route purge에서 climate:event 키 제외(교차삭제 방지)"
```

---

## Task 7: risk-refresh 내륙 자산 채점

**Files:** Modify `supabase/functions/risk-refresh/index.ts` (Deno Edge Function)

**목표:** inland 자산도 asset_risk 행을 생성(강수 침수 + 극한 기온). 미생성 시 logisight-core 프론트가 inland를 expectedRows에서 제외(가드)하지만, 채점하면 지구본 색·신호가 산다.

- [ ] **Step 1: isInland 분기 추가**

`risk-refresh/index.ts`의 자산-유형 분기(`isSea`/`rail`/`freeze_prone`)에 `type === 'inland'` 분기를 추가. 내륙 해저드: 강수(침수) + 극한 고온/저온. `CUT`에 `precip`(침수)·`heat` 임계 추가, `cand[]`에 inland 점수 push. 파고(wave)는 inland에서 호출하지 않음(육지). 기존 sea/rail 분기 로직은 변경 금지.

(정확한 임계·Open-Meteo 변수는 기존 파일의 sea/rail 스코어러 패턴을 따라 구현. precip 일일 합 임계 예: a=50mm, r=100mm; heat 일최고 임계 예: a=38°C, r=43°C — 구현 시 기존 CUT 스타일로.)

- [ ] **Step 2: 타입체크(가능 시) / 코드 리뷰**

Deno 함수는 로컬 실행이 어려우므로 검토 = 분기 정확성·기존 분기 무변경 확인.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/risk-refresh/index.ts
git commit -m "feat(risk-refresh): 내륙 자산 채점(강수 침수·극한 기온)"
```

---

## Task 8: 스케줄 배선 (package.json + GitHub Actions)

**Files:** Modify `package.json`; Create `.github/workflows/climate-event-generate.yml`

- [ ] **Step 1: package.json 스크립트 추가**

`scripts`에 추가(기존 `generate:climate` 옆):
```json
    "generate:climate-event": "node generators/web/climate-event/generate.js",
    "test:climate-event": "node --test generators/web/climate-event/",
```

- [ ] **Step 2: 워크플로 작성**

`.github/workflows/climate-generate.yml`을 템플릿으로 복제, 이름·스크립트만 변경. event-ingest(2h) 직후 돌도록 cron을 이벤트 인제스트보다 약간 뒤로(예: `45 */2 * * *`). 시크릿: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.

```yaml
name: Climate Event — Logistics Impact Draft
on:
  schedule:
    - cron: '45 */2 * * *'   # event-ingest(:15)·impact-judge(:25) 이후
  workflow_dispatch:
jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run generate:climate-event
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

(기존 `climate-generate.yml`의 cron 시간대(UTC)·node 버전·npm 설치 방식과 일치시킬 것 — 그 파일을 먼저 읽고 맞춰라.)

- [ ] **Step 3: Commit**

```bash
git add package.json .github/workflows/climate-event-generate.yml
git commit -m "feat(climate-event): generate 스크립트 + 2시간 cron 워크플로"
```

---

## Self-Review

- **Spec 커버리지:** 내륙 자산(T1)·게이트(T2)·narrate(T3)·row 자동발행(T4)·생성 루프(T5)·교차삭제 방지(T6)·내륙 채점(T7)·스케줄(T8). logisight-core RegionImpact가 기대하는 `climate:event:<id>` published 산출 ✅.
- **발행 정책:** 기존 climate와 동일 자동발행(가드) — 사용자 확정 ✅.
- **교차삭제:** T5 purge는 event 키 한정, T6은 route purge에서 event 키 제외 — 양방향 안전 ✅.
- **회귀:** 기존 `climate/`·`impact/` 로직 무변경(T6 purge 필터만 추가). T7은 sea/rail 분기 무변경 ✅.
- **타입 일관성:** gate→ctx→narrate→row의 `linkedAssets[{id,name,type,km,risk}]`·`linkedRoutes[{id,name}]` 형태 일관 ✅.
- **Orphan:** T4 `row.js`의 미사용 `validateClimate` import는 구현 시 삭제 지시 명시.
