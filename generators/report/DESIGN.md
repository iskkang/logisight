# 월간 리포트 PDF 디자인 계약

`monthly-report-pdf.js`가 구현하는 확정 디자인. **매월 자동 적용** — 월별 작업 불필요
(`--month=YYYY-MM`만 바뀌면 VOL·월호·발행일·헤드라인·목차가 전부 해당 월 값으로 채워진다).
이 문서와 코드가 어긋나면 이 문서가 기준이다. 디자인을 바꿀 때는 이 문서를 같은 커밋에서 갱신한다.

확정 시점: 2026-07호 (커밋 329119f). 사용자 승인 디자인.

## 1. 표지 (P1 `.landing`, bleed)

- **아트**: `assets/cover-art.jpg` 풀블리드 (`center/cover`). 원본은
  `content/templates/report2.png`(1055×1491 = A4 비율, 네이비 아이·나침반·컨테이너선) → q85 JPEG.
- **원본 이미지 상단의 금색 "Logisight" 텍스트는 지우지 않고 `.ld-shade`로 가린다**:
  높이 33% 오버레이, `linear-gradient(90deg,#011126 0%,#0C2847 52%,#193B5E 100%)`
  (이미지 상단 배경 실측 샘플값) + `-webkit-mask-image`로 하단 28%를 페이드.
  → 아이 그래픽의 빛으로 경계선 없이 녹아든다. 이미지를 교체하면 이 색을 다시 샘플링할 것.
- **타이틀 블록** (`.ld-head-zone`, top:15mm, 중앙 정렬):
  키커 `MONTHLY MARKET INTELLIGENCE · VOL.{MM} · {ENG_MONTH} {YYYY}` (스틸블루 #9FBCDD)
  → 타이틀 "월간 시장 인텔리전스" (GyeonggiTitle 800, 32pt, 흰색)
  → 금색 룰 22mm (#C8B37E) → 부제+월호 → 이달의 프레임 헤드라인(`**이번 달 핵심**`에서 자동 추출).
  표지 액센트는 아트의 금색·스틸 톤(#C8B37E·#9FBCDD)을 따른다 — 민트는 표지에 쓰지 않는다.
- **하단** (`.ld-bottom`, bottom:9mm): IN THIS ISSUE 2열 목차(자동, toc) + 발행일·URL 풋라인.
- KPI 칩은 표지에 넣지 않는다 (P2 Executive Summary와 중복).

## 2. 좌측 스파인 (전 페이지, 6mm 네이비 #0E3A66)

세 요소가 한 컬럼을 이룬다. **셋 다 있어야 하고, 폭은 전부 6mm**:

| 요소 | 담당 구간 | 핵심 값 |
|---|---|---|
| `.spine-band` (fixed) | 콘텐츠 박스 (fixed는 콘텐츠 박스로 클리핑됨) | `top:-20mm;height:340mm` — 마진 오프셋 quirk 흡수 |
| headerTemplate 네이비 블록 | 상단 마진 0–16mm | `top:-6.5mm;height:24mm` — Chromium이 템플릿 내용을 ~6mm 아래로 미는 것을 상쇄 |
| footerTemplate 네이비 블록 | 하단 마진 14mm | `top:-2mm;height:20mm` |

- `.spine-text`: 세로 라벨 `LOGISIGHT MONTHLY INTELLIGENCE · VOL.{MM} · {ENG_MONTH} {YYYY}`.
  회전은 SVG 내부(rotate(-90))에서 처리한 `<img>` — CSS writing-mode는 인쇄 시 페이지 분할되므로 금지.
- `.spine-mask`: 상단 88mm 네이비 — fixed 요소가 다음 페이지 상단에 남기는 유령 파편 마스크.
- ⚠ 회귀 사고: dcd7c47에서 스파인 CSS 블록이 편집 중 통째로 유실 → 레이아웃 전체 붕괴.
  `.spine-band`/`.spine-mask`/`.spine-text` CSS를 지우거나 이름을 바꾸면 안 된다.

## 3. 푸터 & bleed 페이지 (pdf-lib 2-pass)

- footerTemplate: 룰(#0E3A66 1.2px, left:24mm right:18mm **top:5.5mm** — 템플릿 원점 보정) +
  `© {YYYY} Logisight Maritime Intelligence | monthly-analysis-{MM} · 페이지번호`.
- **Chromium은 footerTemplate를 bleed(마진 0) 페이지에도 콘텐츠 위에 겹쳐 그린다.**
  → footer 있는 렌더 + 없는 렌더를 두 번 찍고, 표지(1p)·뒷표지(마지막p)만 pdf-lib로 교체.
  중간 디바이더의 희미한 유령은 네이비 배경상 비가시로 허용.

## 4. 페이지 문법 (P2 이후)

P2 Exec Summary(5행: RATES·CONTRACT·CAPACITY·DEMAND/COST·NEXT MONTH + KCCI 13항로 히트맵)
→ 네이비 디바이더(01…) → 본문(TAKEAWAY 밴드) → 02는 디바이더 대신 6차트 대시보드 → 뒷표지(로고).
토큰: 구조색 네이비 #0E3A66/#082A4C, 브랜드 민트 #2dd4bf(로고·디바이더 룰), 상승 #C00000,
하락 #1F5FA8, 차트 팔레트 강제 `['#0E3A66','#7FB3DC','#00818A','#9AA6B2','#C0392B','#5B6167']`.
폰트: Pretendard(본문) / GyeonggiTitle(제목) — CDN 로드.

## 5. 발행 전 디자인 체크 (사고 재발 방지)

1. P1: 표지 아트·타이틀·IN THIS ISSUE, 하단 풋라인에 회색 © 겹침 없음.
2. P2: Exec 5행 + 히트맵 13행이 잘리지 않음.
3. 임의 본문 페이지: 좌측 밴드가 위-아래 끝까지 이어지고 폭 단차 없음 (확대해서 볼 것).
4. 마지막 페이지: 뒷표지 로고, footer 유령 없음.
