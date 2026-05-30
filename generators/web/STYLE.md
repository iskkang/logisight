# 웹 기사 문체 가이드

- 대상: `maritime_news` 테이블 (`agent_type = 'shipping'`)
- 문체: 구조화, 본문 기사체, 소제목 포함, SEO 친화적
- 필수 필드: `title`, `slug`, `content`, `summary`, `image_url`, `tags`, `category`
- 길이: 600~1000자 본문
- 형식: `## 소제목` 포함 마크다운
- 독자: 한국 화주, 포워더, MTL 영업 담당
- 출처 표기: 모든 운임·통계 데이터 옆에 `(출처: 기관명, YYYY.MM.DD)` 필수

## 카테고리 목록
- `ocean` — 해상 운임·항로
- `rail` — 유라시아 철도 (TCR/TSR/TITR)
- `policy` — 무역 정책·규제
- `corp` — 기업 동향·M&A
- `air` — 항공 화물

## slug 규칙
- 영문 kebab-case, 날짜 포함
- 예: `scfi-week-22-ocean-freight-surge-2026`
