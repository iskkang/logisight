# 이메일/daily 문체 가이드

- 대상: `maritime_news` 테이블 (`agent_type = 'brief'`)
- 문체: 속보체, 압축 요약, 핵심만
- 필수 필드: `title`, `summary`, `category`, `tags`
- `content`: null 허용 (이메일 발송기가 `summary` 기반으로 조합)
- 길이: `summary` 2~3문장 (100~200자)
- 형식: 평문, 마크다운 최소화

## agent_type 구분
- `daily_card` — (2026-06-12 폐기) 과거 이메일 카드 데이터, 신규 생성 없음
- `brief` — 일간 브리프 (요약 + 링크 모음)

## 발송기 연동
- `generators/email/generate-newsletter.js` → Resend API → 구독자
- `generators/email/generate-brief.js` → Supabase 적재 후 사이트 표시
