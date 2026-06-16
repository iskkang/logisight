# 결항(Blank Sailing) 뉴스 기반 수집·구조화 파이프라인 v1.0

- 용도: 자체 결항 DB가 없는 상태에서, 공개 트래커·뉴스 보도를 주 1회 수집·구조화해 운임 예측 프롬프트(v1.1)의 `supply.blank_sailing` 입력을 생성
- 구조: [주간 수집] → [Stage 1: 기사별 추출(LLM)] → [Stage 2: 트레이드별 집계(규칙)] → [예측 프롬프트 입력]
- 핵심 원칙: 기사에 없는 수치 생성 금지 / 수치 없으면 방향만 / 출처·발행일 항상 보존 / 발행 14일 초과 시 만료 / 트레이드 단위 정보는 대용치(proxy)로 라벨

---

## 1. 소스 카탈로그

| 티어 | 소스 | 성격 | 주기 |
|---|---|---|---|
| T1 | Drewry Cancelled Sailings Tracker (무료, 가입 필요) | 동서 기간항로 결항 vs 예정 항차 수 — 정량. 예: "주 21~25, 예정 678항차 중 45항차 결항" → 6.6% | 주간 |
| T2 | 업계 매체: Container News(blank-sailings 태그, RSS), The Loadstar, gCaptain, FreightWaves/American Shipper, Splash247, 코리아쉬핑가제트 | Sea-Intelligence·Drewry·project44 분석 인용 보도 — 반정량(건수·방향) | 불규칙 |
| T3 | 포워더·플랫폼 블로그 (1UP Cargo류) | 2차 인용 — 교차확인용만, 단독 채택 금지 | 불규칙 |

수집 절차(주 1회 고정 요일): ① Drewry 트래커 페이지에서 최신 수치 1점 확보(수기 5분, 추후 자동화 검토) ② 웹 검색 "blank sailings transpacific/asia europe" 최근 7일 ③ Logisight `maritime_news` 수집분 중 결항 키워드 태깅분. 자동화 전에는 `/admin` 수기 입력 폼으로 충분하다.

주의: 결항 보도는 대부분 트레이드 단위(Transpacific, Asia–Europe)다. 부산발 기간항로는 아시아 기간항로 선복·서비스 루프를 공유하므로 트레이드 수준 수치를 대용치로 쓰되, 반드시 `geo_scope='trade_level_proxy'`로 라벨하고 화면·전망문에도 명시한다.

---

## 2. Stage 1 — 기사 추출 프롬프트 (전문)

```
당신은 해운 뉴스에서 결항(blank sailing) 정보를 구조화하는 추출기다. 제공된 기사 텍스트만 사용한다.

<원칙>
1. 기사에 없는 수치를 만들지 않는다. 수치가 없으면 null로 둔다.
2. 기사 발행일과 결항 대상 기간을 반드시 구분한다.
3. 트레이드 단위로 분리해 추출한다. 복수 트레이드를 다루면 signals 배열에 각각 넣는다.
4. 모호하면 direction만 기록하고 magnitude_class는 unknown으로 둔다.
5. 출력은 아래 JSON만. 다른 텍스트 금지.
</원칙>

<output_schema>
{
  "article": {"source": "매체명", "url": "", "published": "YYYY-MM-DD"},
  "signals": [
    {
      "trade": "transpacific | asia_europe | asia_med | transatlantic | intra_asia | other",
      "period": {"start": "YYYY-MM-DD|null", "end": "YYYY-MM-DD|null", "weeks": [21,25] 또는 null},
      "blank_count": 결항 항차 수 | null,
      "scheduled_count": 예정 항차 수 | null,
      "ratio_pct": 기사에 명시된 비율만 | null,
      "direction": "expanding | stable | easing | mixed",
      "magnitude_class": "major | moderate | minor | unknown",
      "actors": ["언급된 얼라이언스·선사"],
      "claim_summary": "근거 문장 요약 (수치 포함, 1문장)",
      "data_origin": "기사가 인용한 원천 (Drewry | Sea-Intelligence | project44 | 선사 공지 | unknown)"
    }
  ],
  "geo_scope_note": "수치의 지리 범위 (예: 중국발 중심 미주 전 항로 합계 — 한국발 직접 아님)",
  "reliability": "tracker_cited | carrier_notice | secondary_analysis"
}
</output_schema>
```

---

## 3. Stage 2 — 트레이드별 집계 규칙 (코드 구현)

1. **신선도**: asof 기준 발행 14일 이내 signals만 사용. 전부 초과면 `source_type='none'`(결측) — 예측 프롬프트의 가중치 재분배 규칙으로 넘어간다.
2. **정량 우선**: `data_origin`이 Drewry/Sea-Intelligence이고 `blank_count`·`scheduled_count`가 있으면 ratio 계산 → `source_type='tracker_quoted'`. 복수면 최신 발행 우선.
3. **정성 다수결**: 정량이 없으면 direction 다수결 → `source_type='news_derived'`. `independent_sources` = 서로 다른 data_origin 수(같은 원천을 인용한 기사 여러 건은 1개로 센다).
4. **불일치**: 출처 간 direction이 갈리면 `direction='mixed'` (B점수 0 처리).
5. **트레이드→노선 매핑**: transpacific → KRPUS–USLAX·USLGB·USNYC / asia_europe → KRPUS–NLRTM·DEHAM / asia_med → KRPUS–지중해. 전부 `geo_scope='trade_level_proxy'`.
6. 산출 블록은 예측 프롬프트 v1.1의 `supply.blank_sailing` 스키마와 동일.

---

## 4. 실제 예시 — 1UP Cargo 기사 (2026-02-19, project44 인용)

Stage 1 추출 결과:

```json
{
  "article": {"source": "1UP Cargo (SupplyChain247 전재)", "url": "1upcargo.com/post/blank-sailings-ease...", "published": "2026-02-19"},
  "signals": [
    {
      "trade": "transpacific",
      "period": {"start": "2026-01-01", "end": "2026-01-31", "weeks": null},
      "blank_count": 11,
      "scheduled_count": null,
      "ratio_pct": null,
      "direction": "easing",
      "magnitude_class": "major",
      "actors": [],
      "claim_summary": "미주 주요 항로 결항이 2025-04 피크 131항차에서 2026-01 11항차로 급감",
      "data_origin": "project44"
    }
  ],
  "geo_scope_note": "Asia–US·China–US·US–China 합계, 중국발 중심 — 한국발 직접 아님",
  "reliability": "secondary_analysis"
}
```

Stage 2 판정 (asof 2026-06-05 기준): 발행 경과 106일 → **14일 규칙으로 만료**. 이 기사만 보유한 상태라면 `source_type='none'`으로 결측 처리하고 공급 팩터 가중치를 재분배한다. 뉴스 기반 운용에서 가장 흔한 함정이 "오래된 기사로 현재를 판단"하는 것이며, 이 사례가 정확히 그 경우다 — 2월의 '결항 완화'를 6월 전망에 넣으면 안 된다.

---

## 5. 예측 프롬프트 반영 사항 (v1.1 당시 기준 — 현행 버전은 prompt 문서의 버전 이력 참조)

`freight-rate-forecast-prompt.md`에 다음이 반영됨: ① `supply.blank_sailing` 구조체(소스 유형·방향·강도·출처 수·대용치 라벨·경과일) ② B 채점의 이원화 — 정량(tracker_quoted)은 비율 구간으로, 정성(news_derived)은 방향×강도×독립 출처 수로 채점 ③ news_derived 채택 시 confidence 상한 '중간', 14일 초과 시 결측 처리.

---

## 6. Supabase 저장 (선택, Phase 6에서)

```sql
create table supply_signals (
  id uuid primary key default gen_random_uuid(),
  trade text not null,
  period_start date, period_end date,
  blank_count int, scheduled_count int, ratio_pct numeric(5,2),
  direction text, magnitude_class text,
  independent_sources int default 1,
  geo_scope text default 'trade_level_proxy',
  evidence jsonb,
  published_max date not null,
  created_at timestamptz default now()
);
```

`/admin`에 주간 입력 폼(트레이드·수치·출처·발행일)을 두고, 예측 파이프라인은 이 테이블에서 Stage 2 집계를 수행한다.

---

| 버전 | 일자 | 변경 |
|---|---|---|
| v1.0 | 2026-06-06 | 초안. 소스 카탈로그 T1~T3, Stage 1 추출 프롬프트, Stage 2 집계 규칙, supply_signals 스키마 |
