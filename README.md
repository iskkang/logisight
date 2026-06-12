# Logisight Pipeline

MTL Shipping Agency 물류 인텔리전스 플랫폼의 데이터 파이프라인.

## 역할

- 글로벌 물류 뉴스 수집 및 Anthropic Claude 기반 번역·가공
- Supabase DB 적재 (`maritime_news`, `freight_indices`, `trade_statistics` 등)
- 일간/주간 이메일 뉴스레터 발송 (Resend)
- 웹 기사 생성 → Supabase → 공개 사이트 표시

## 공개 사이트

https://logisight.mtlship.com (Lovable → Vercel 호스팅, 이 레포와 별도 관리)

## 데이터 흐름

```
collectors/ → generators/{web,email,report}/ → Supabase
                                              ↓
                          Lovable(읽기 전용) · 이메일 발송
```

## 디렉토리

```
collectors/           수집기 (RSS, 크롤러, 공공API, 운임 지수)
  utils/              playwright_pool, rate_limiter, snapshot_writer 등
generators/
  web/                웹 기사 생성 (maritime_news, agent_type='shipping')
  email/              이메일 daily/weekly (agent_type='brief')
  report/             CADI 리포트, PDF 생성
lib/                  공유 유틸 (supabase-insert.js)
scripts/              로컬 유틸 (cadi-demo-snapshot.ts 등)
supabase/
  migrations/         DB 스키마 (파이프라인이 단일 소스)
  functions/          Edge Functions (Deno)
.github/workflows/    자동화 크론
```

## 환경변수

`.env.example` 참고. `.env.local` 에 실제 값 입력 (git 커밋 금지).

## 개발 명령

```bash
# 수집
npm run collect:rail:daily    # 철도 뉴스 일간 수집
npm run collect:ocean:daily   # 해운 뉴스 일간 수집
npm run collect:all           # 전체 수집기 실행

# 큐레이션 & 기사 생성
npm run curate:rail           # 철도 큐레이션
npm run curate:ocean          # 해운 큐레이션
npm run publish:curated         # 큐레이션 기사 → 사이트 적재 (KSG 스타일, agent_type=brief)
npm run generate:article:brief  # 브리프 기사 생성

# 뉴스레터
npm run newsletter:generate   # HTML 뉴스레터 생성

# 전체 파이프라인
npm run daily:email   # 수집 → 큐레이션 → 뉴스레터
```

## Supabase 원칙

- 스키마 변경: `supabase/migrations/` 에 새 파일 추가만 (기존 수정 금지)
- Lovable/프론트: anon key + RLS 읽기 전용
- 파이프라인: service_role key 쓰기 전용

## 라이선스

Private — MTL Shipping Agency 내부 프로젝트
