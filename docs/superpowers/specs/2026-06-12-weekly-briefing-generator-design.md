# Weekly Briefing 자동 생성기 설계

**날짜:** 2026-06-12
**상태:** 승인됨 (2026-06-12)

## 목표

홈 우측 "주간 시장 브리핑" 카드를 매주 자동으로 채운다. 현재 `weekly_briefings` /
`weekly_briefing_points` 테이블에는 자동 생성기가 없어 5/28 수동 시드 1건에서 멈춰 있다.
지난 7일 동안 사이트에 쌓인 brief 기사 중 주제별 메인 1건씩을 뽑아 적재한다.

## 배경 — 프론트엔드가 기대하는 것 (변경 없음)

logisight-core `index.tsx`의 `WeeklyBriefingBlock`은 슬롯 3개를 하드코딩한다:

```
["shipping", "corp", "brief"].map(cat => points.find(p => p.agent_type === cat) ?? points.find(p => p.category === cat))
```

라벨: `shipping`→시황, `corp`→기업, `brief`→글로벌. "BY {CAT}" 표기. 부제는 고정
"· 시황 · 기업 · 글로벌". "전체 분석 읽기"는 `/news`로 연결되고 `briefing.content`는
현재 화면에 렌더링하지 않는다.

→ **테이블만 채우면 카드가 자동 갱신된다. logisight-core 수정 불필요.**
→ point의 `agent_type`은 반드시 `'shipping'`/`'corp'`/`'brief'` 리터럴이어야 한다
  (소스 기사의 실제 agent_type과 무관하게 슬롯 키로 사용).

## 데이터 흐름

```
maritime_news (최근 7일, agent_type='brief', slug not null)
  → DeepSeek JSON 1회 (주제별 톱 선정 + 주간 분석 본문)
  → weekly_briefings 1행 upsert(onConflict: week_of)
  → weekly_briefing_points: 해당 briefing_id 기존 행 삭제 후 3행 삽입
```

## 선정 로직 (DeepSeek)

입력: 지난 7일 brief 기사 목록 `[category] 제목 — 요약`.
`callDeepSeekJson`(json_object 모드, 재시도 내장) 1회 호출. 3개 주제별 가장 중요한 1건을
골라 **KSG 헤드라인**(명사형·수치·한자기호, 25~40자)으로 정리하고, 3건을 엮은 주간 분석
본문(KSG 문체, 600~1,000자)을 함께 생성한다.

주제 매핑:
- **시황**(`shipping` 슬롯) ← 해상·항공·철도 운임/시황 동향
- **기업**(`corp` 슬롯) ← 선사·포워더·물류기업(머스크·DSV·DHL·FedEx 등) 동향·실적·M&A
- **글로벌**(`brief` 슬롯) ← 무역·정책·공급망·지정학

출력 JSON 형식:
```json
{
  "shipping": "헤드라인 또는 \"\"",
  "corp": "헤드라인 또는 \"\"",
  "brief": "헤드라인 또는 \"\"",
  "content": "주간 분석 본문"
}
```
적합 기사 없는 주제는 빈 문자열 → 해당 point 생략(프론트는 "수집 예정" 표시).

## DB 적재

**weekly_briefings** (onConflict: `week_of`):
- `title` = "주간 시장 브리핑"
- `subtitle` = `"{YYYY}년 {M}월 {W}주 · 시황 · 기업 · 글로벌"` (W = 해당 월의 몇째 주)
- `week_of` = 이번 주 월요일 (KST 기준 DATE)
- `published_at` = now (ISO)
- `content` = 주간 분석 본문 (없으면 null)

**weekly_briefing_points** (briefing_id 기존 행 삭제 후 삽입):
- 빈 문자열이 아닌 슬롯만 삽입.
- 각 행: `briefing_id`, `agent_type` ∈ {'shipping','corp','brief'}, `category` ∈ {'시황','기업','글로벌'}, `headline`, `display_order` ∈ {1,2,3} (시황=1, 기업=2, 글로벌=3).

## 컴포넌트 (파일 분리)

### `generators/web/lib/weekly-briefing.lib.js` (순수 함수, I/O 없음)
- `mondayOf(date)` — 주어진 시각의 KST 기준 그 주 월요일을 `"YYYY-MM-DD"`로.
- `subtitleFor(date)` — `"YYYY년 M월 W주 · 시황 · 기업 · 글로벌"`.
- `buildSelectionMessages(articles)` — DeepSeek messages 배열(프롬프트).
- `toPoints(briefingId, selection)` — selection JSON → weekly_briefing_points 행 배열
  (빈 슬롯 제외, display_order 부여).
- `node:test`로 단위 테스트.

### `generators/web/generate-weekly-briefing.js` (I/O)
- Supabase 조회(brief 7일) → `callDeepSeekJson` → upsert briefing → delete+insert points.
- 환경변수: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DEEPSEEK_API_KEY`.
- 7일 brief 기사 0건이면 경고 후 exit 0 (적재 스킵).
- npm 스크립트: `weekly:briefing`.

## 워크플로

`.github/workflows/weekly-briefing.yml` 신규:
- cron `0 22 * * 0` (일요일 22:00 UTC = 월요일 07:00 KST), workflow_dispatch.
- 스텝: checkout → setup-node(22) → `npm ci` → `npm run weekly:briefing`.
- secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DEEPSEEK_API_KEY`.

## 스코프 밖 (이번 작업 제외)

- 프론트엔드 변경 없음. "전체 분석 읽기" → 전용 주간 페이지 연결 및 `briefing.content`
  렌더링은 추후 별도 작업. content는 저장만 한다.
- 기존 daily/weekly 뉴스레터·기사 파이프라인 변경 없음.

## 검증 기준

1. 로컬 `npm run weekly:briefing` 실행 시 weekly_briefings 1행 + points 최대 3행 적재.
2. 적재된 point의 agent_type이 'shipping'/'corp'/'brief' 리터럴이고, 프론트 카드에
   3개 헤드라인이 표시된다.
3. week_of가 KST 기준 이번 주 월요일 DATE.
4. 7일 brief 0건일 때 exit 0, 적재 스킵.
5. `node --test generators/web/lib/` 통과 (mondayOf·subtitleFor·toPoints).
