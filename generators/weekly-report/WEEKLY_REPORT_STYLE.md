# 주간 리포트 문체 규칙

- **명사형 종결 필수.** 예: "변동성 확대 예상", "단기 과열 구간 진입". `~된다/~한다/~이다/~우세하다` 등 서술형 어미 금지.
- **두괄식.** 모든 섹션·문단은 결론 먼저, 근거는 뒤.
- **수치 출처 필수.** 모든 수치 뒤 `(SCFI, 06/08)` 형식 출처 또는 `[ASSUMPTION]`. 추측을 사실처럼 단정 금지.
- **어려운 한자 약물 금지** (弗·億·比·美·亞·北·前倒·脫出). 한글로: 달러·억·대비·미국·아시아.
- **불분명 외래어 금지** (헤지 등). 풀어서 서술.
- **신호등은 리스크 수준** (🟢 안정 / 🟡 관망 / 🔴 주의). 이모지로만. 가격 등락색과 무관.
- **뉴스는 결론 뒷받침용 3건만 선별.**
- 핵심 수치 굵게. 전주 대비 증감은 `▲/▼ +X.X%`.

## 발행 절차 (검토 게이트)
1. 일요일 워크플로가 `content/weekly-report/YYYY-Www.md` 초안(`status: draft`) 생성.
2. 사람이 검토·수정 후 frontmatter `status: draft` → `approved`.
3. `npm run weekly-report:pdf -- --week=YYYY-Www` → `content/published/weekly-report-YYYY-Www.pdf`.
4. `npm run weekly-report:publish -- --week=YYYY-Www [--pdf-url=...]` → 웹(`weekly_reports`) 게재.
