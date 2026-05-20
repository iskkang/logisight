# Codex / Cursor 지시문 — Logisight Auto Bi-Weekly Report Generator

**목적**: MTL Vol.02 같은 격주 시장 보고서를 자동 생성하는 모듈을 만든다.
**투입 방식**: 아래 STEP 1~3 블록을 한 번에 하나씩 Cursor / Codex / Claude Code에 붙여넣는다. 각 STEP 결과를 검수한 뒤 다음 STEP으로 진행한다.
**전제 조건**: Logisight PRD v1.1의 모듈 1·4 (HS-Code, 운임 지수)가 1차 구축 완료되어 Supabase에 데이터가 적재되어 있다고 가정.

---

## STEP 1 — 데이터 수집기 (Auto-Drafter Backbone)

```
[프로젝트] Logisight - Auto Bi-Weekly Report Generator
[STEP 1] 격주 보고서용 데이터 수집기 구축

[작업 환경]
- Supabase (Logisight 프로젝트, MTL Link와 분리)
- TypeScript + Node.js (Vercel Functions 또는 자체 worker)
- Playwright (스크래핑)
- GitHub Actions (Cron)

[수행할 작업]

1. supabase/migrations/0010_create_report_tables.sql 생성:

CREATE TABLE report_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  section text NOT NULL,                  -- 'shipping','air','rail','trade'
  data_type text NOT NULL,                -- 'index','blank_sailing','bunker',...
  data_key text NOT NULL,                 -- 'KCCI_종합','SCFI_미서안',...
  data_value jsonb NOT NULL,              -- 실제 수치·메타
  source text NOT NULL,                   -- 'KOBC','SSE','Drewry',...
  source_url text,
  collected_at timestamptz DEFAULT now(),
  is_complete boolean DEFAULT true,       -- false 시 "데이터 미수집" 표시
  UNIQUE(snapshot_date, data_type, data_key)
);

CREATE TABLE report_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  section text NOT NULL,
  headline_en text,
  headline_ko text,                       -- AI 번역 결과
  summary_ko text,                        -- AI 요약 (현상→원인→전망)
  source text,
  source_url text,
  published_at timestamptz,
  importance_score numeric,               -- 0~10, AI 평가
  collected_at timestamptz DEFAULT now()
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vol_number int NOT NULL UNIQUE,         -- 02, 03, 04, ...
  issue_date date NOT NULL,
  period_start date,
  period_end date,
  status text NOT NULL DEFAULT 'draft',   -- draft, in_review, approved, published
  draft_md text,                          -- AI 생성 마크다운
  final_md text,                          -- 영업 검토 후 최종
  pdf_url text,                           -- 변환된 PDF
  created_at timestamptz DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  published_at timestamptz
);

CREATE INDEX idx_snapshots_date ON report_snapshots(snapshot_date);
CREATE INDEX idx_news_date_section ON report_news(snapshot_date, section);

2. workers/collectors/ 디렉터리에 수집기 분할:

   workers/collectors/
   ├─ index.ts                    : 마스터 dispatcher
   ├─ shipping_indices.ts         : KCCI·SCFI·WCI·FBX·MBCI·NCFI·BDI
   ├─ bunker.ts                   : IFO380·VLSFO·MGO (Ship & Bunker)
   ├─ air_indices.ts              : FAX·BAI·MOPS·Jet Fuel
   ├─ blank_sailing.ts            : Drewry Cancelled Sailings
   ├─ fleet.ts                    : Alphaliner Top 12 헤드라인
   ├─ rail_tcr.ts                 : CR Express + Landbridge
   ├─ rail_tsr.ts                 : RZD Partner + PortNews + Vgudok
   ├─ news_global.ts              : JOC, Loadstar, FreightWaves RSS
   ├─ news_korea.ts               : 카고뉴스 RSS
   ├─ news_china.ts               : Landbridge 5개 카테고리
   ├─ policy_us.ts                : USTR, CBP RSS
   ├─ policy_eu.ts                : EU CBAM, ETS
   ├─ policy_imo.ts               : IMO MEPC
   └─ utils/
      ├─ playwright_pool.ts        : Browser instance 풀링
      ├─ rate_limiter.ts           : 도메인별 분당 N회 제한
      └─ snapshot_writer.ts        : Supabase report_snapshots 업서트

3. 각 collector는 다음 인터페이스 따름:

   export interface CollectorResult {
     section: 'shipping' | 'air' | 'rail' | 'trade';
     data: Array<{
       data_type: string;
       data_key: string;
       data_value: any;
       source: string;
       source_url?: string;
       is_complete: boolean;
     }>;
   }

   export async function collect(): Promise<CollectorResult>;

4. shipping_indices.ts 예시 (가장 중요):

   - OneKSA 통합 페이지 (oneksa.kr/shipping_index) Playwright로 접속
   - KCCI / SCFI / WCI / FBX 한 번에 수집
   - 권역별 13~14개 항로 모두 추출
   - 4주 추이도 함께 (스파크라인 데이터)
   - 실패 시 is_complete=false + 콘솔 경고

5. blank_sailing.ts 예시:

   - https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/cancelled-sailings-tracker
   - 향후 5주 결항 수, 비율, 항로별, 얼라이언스별
   - 페이지 구조 변경 시 LLM 폴백 (Claude API로 HTML 파싱)

6. rail_tcr.ts 예시 (MTL 차별화):

   - crexpress.cn/zoblmenu/allTraffic — 주간 운행 편수
   - crexpress.cn/zoblmenu/rankingExportPorts — 국경 통과 순위
   - landbridge.com/yaowen/ + silkroad/ + cis/ + russiainfo/ + kouan/
     → 각 카테고리 최신 5건 헤드라인 + 본문 일부
   - middlecorridor.com — TITR 동향

7. .github/workflows/auto-drafter-collect.yml:

   name: Auto-Drafter Data Collection
   on:
     schedule:
       - cron: '0 9 * * 0'     # 일요일 18:00 KST (UTC 09:00)
     workflow_dispatch:
   jobs:
     collect:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: '20' }
         - run: npm ci
         - run: npx playwright install chromium
         - run: npm run collect:all
           env:
             SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
             SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
             ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

8. 검증 SQL:

   -- 오늘 스냅샷 완성도 확인
   SELECT section, COUNT(*) AS total,
          SUM(CASE WHEN is_complete THEN 1 ELSE 0 END) AS complete
   FROM report_snapshots
   WHERE snapshot_date = CURRENT_DATE
   GROUP BY section;

[주의 사항]
- 모든 도메인에 분당 10회 미만 rate limit
- 실패 시에도 is_complete=false로 기록 → 보고서에 "데이터 미수집" 표시
  (Vol.02의 솔직성 유지)
- robots.txt 준수
- 사용자(MTL 영업팀)에게 영향 없는 시간대(일요일 새벽~오전)에만 실행
- 모든 source_url 보관 → 인용 시 추적 가능

[테스트 시나리오]
□ npm run collect:shipping → KCCI/SCFI 데이터 30+개 행 적재
□ npm run collect:rail → CR Express + Landbridge 5개 카테고리
□ 의도적으로 사이트 차단 → is_complete=false 기록 확인
□ 동일 날짜 2회 실행 → UNIQUE 제약으로 중복 없음 확인
```

---

## STEP 2 — AI 초안 생성기 (Auto-Drafter Core)

```
[STEP 2] AI가 모듈 4·5·7·8·9 데이터를 받아 격주 보고서 초안을 자동 생성

[수행할 작업]

1. supabase/functions/ai-report-draft/index.ts (Deno Edge Function):

   - Input: { vol_number?: int, period_end?: date }
   - 동작:
     a. report_snapshots에서 최근 14일치 데이터 조회
     b. report_news에서 최근 14일치 뉴스 조회
     c. 섹션별로 Claude Sonnet 호출 (병렬 4회)
     d. 결과를 reports.draft_md에 저장
     e. status='draft'로 설정

2. 섹션별 프롬프트 설계 (system prompt):

   섹션 1: 해운 동향
   ─────────────────────────────────────────────────────────────
   당신은 글로벌 물류 시장 분석 전문가다. 아래 운임 지수 데이터를 기반으로
   MTL Bi-Weekly Report 1번째 섹션 "해운 동향"을 작성하라.

   필수 포함 항목:
   1. 1-1. 컨테이너 운임지수 종합 (표 + [현상→원인→전망] 분석)
   2. 1-2. 블랭크 세일링 현황 (표 + 분석)
   3. 1-3. 권역별 물류시황 (TPEB·FEWB·동남아·기타)
   4. 1-4. 주요 이슈 2~3건 (뉴스 데이터에서 importance_score 상위)

   문체 규칙:
   - 모든 문장은 명사형으로 마무리 (~상승함, ~확인됨, ~전망임)
   - 감성 표현 배제 ("상승/하락/보합/안정세")
   - 모든 수치에 (출처: 기관명, YYYY.MM.DD) 표기
   - 데이터 미수집 항목은 "데이터 미수집" 명기
   - 분석은 [현상→원인→전망] 3단 구조 엄격히 따름

   출력 형식: Markdown (MTL Vol.02와 동일 구조)

   섹션 2: 항공 동향  (FAX/BAI/MOPS/항공 뉴스 기반)
   섹션 3: 철도 동향  (TCR/TSR/TITR/Landbridge/CR Express 기반) ★ MTL 차별화
   섹션 4: 무역/공급망 동향  (USTR/EU CBAM/IMO/관세 변경 기반)

3. supabase/functions/ai-report-draft/index.ts 의사코드:

   import Anthropic from "@anthropic-ai/sdk";
   const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

   async function generateSection(
     section: 'shipping' | 'air' | 'rail' | 'trade',
     snapshots: any[], news: any[]
   ): Promise<string> {
     const systemPrompt = SECTION_PROMPTS[section];
     const userPrompt = `
       [수집된 데이터]
       ${JSON.stringify(snapshots, null, 2)}

       [수집된 뉴스]
       ${JSON.stringify(news, null, 2)}

       위 데이터로 섹션을 작성하라.
     `;

     const response = await client.messages.create({
       model: 'claude-sonnet-4-5',
       max_tokens: 4096,
       system: systemPrompt,
       messages: [{ role: 'user', content: userPrompt }],
     });

     return response.content[0].text;
   }

   // 마스터 핸들러
   Deno.serve(async (req) => {
     const { vol_number, period_end } = await req.json();
     const periodStart = new Date(period_end);
     periodStart.setDate(periodStart.getDate() - 14);

     // 1) 데이터 조회
     const snapshots = await supabase
       .from('report_snapshots')
       .select('*')
       .gte('snapshot_date', periodStart.toISOString().slice(0, 10))
       .lte('snapshot_date', period_end);

     const news = await supabase
       .from('report_news')
       .select('*')
       .gte('snapshot_date', periodStart.toISOString().slice(0, 10))
       .lte('snapshot_date', period_end)
       .order('importance_score', { ascending: false })
       .limit(40);

     // 2) 섹션별 분류
     const grouped = groupBy(snapshots.data, 'section');
     const newsGrouped = groupBy(news.data, 'section');

     // 3) 4개 섹션 병렬 생성
     const [shipping, air, rail, trade] = await Promise.all([
       generateSection('shipping', grouped.shipping, newsGrouped.shipping),
       generateSection('air',      grouped.air,      newsGrouped.air),
       generateSection('rail',     grouped.rail,     newsGrouped.rail),
       generateSection('trade',    grouped.trade,    newsGrouped.trade),
     ]);

     // 4) 마스터 마크다운 조립 (MTL Vol.02 양식)
     const draftMd = assembleReport({
       vol_number, period_end, shipping, air, rail, trade
     });

     // 5) reports 테이블에 저장
     await supabase.from('reports').insert({
       vol_number,
       issue_date: new Date().toISOString().slice(0, 10),
       period_start: periodStart.toISOString().slice(0, 10),
       period_end,
       status: 'draft',
       draft_md: draftMd,
     });

     return new Response(JSON.stringify({ success: true, vol_number }));
   });

4. assembleReport() 헬퍼:

   function assembleReport({
     vol_number, period_end, shipping, air, rail, trade
   }) {
     return `---
   title: MTL Bi-Weekly Market Summary
   issue: Vol.${String(vol_number).padStart(2, '0')}
   date: ${period_end}
   status: DRAFT (AI 자동 생성, 영업 검토 대기)
   ---

   # MTL Bi-Weekly Market Report
   **Vol.${vol_number} | ${period_end} | Global Logistics & Market Intelligence**

   ---

   # CONTENTS

   | 섹션 | 주요 내용 |
   |------|---------|
   | **01. 해운 동향** | 운임지수 종합 / 블랭크 세일링 / 권역별 시황 / 주요 이슈 |
   | **02. 항공 동향** | FAX 항공운임 / 수급 동향 / Sea & Air 이슈 |
   | **03. 철도 동향** | TCR Q1 실적 / CIS 지역 / 노선별 현황 |
   | **04. 무역/공급망** | 미국 관세 정책 / 공급망 시나리오 |

   ---

   ${shipping}

   ---

   ${air}

   ---

   ${rail}

   ---

   ${trade}

   ---

   # 발행 정보 및 면책 조항

   **발행**: 주식회사 엠티엘 (MTL Shipping Agency)
   **발행일**: ${new Date().toISOString().slice(0,10)} | Vol.${vol_number}
   **발행 주기**: 격주 (Bi-Weekly)
   **AI 자동 작성**: Logisight Auto-Drafter (Claude Sonnet)
   **MTL 검토**: ⚠️ 영업팀 검토 후 정식 발행 예정

   ---

   *본 리포트는 Logisight 자동 데이터 수집 + AI 초안 + MTL 영업팀 검토를 거쳐 발행됩니다. 실제 거래 운임과 차이가 있을 수 있으며, 구체적인 견적은 MTL 영업팀에 문의하시기 바랍니다.*

   *ⓒ 2026 주식회사 엠티엘 (MTL Co., Ltd.). All rights reserved.*
   `;
   }

5. 호출 트리거 (.github/workflows/auto-drafter-generate.yml):

   name: Auto-Drafter Report Generation
   on:
     schedule:
       - cron: '30 9 * * 0'    # 일요일 18:30 KST (수집 30분 후)
     workflow_dispatch:
   jobs:
     generate:
       runs-on: ubuntu-latest
       steps:
         - run: |
             curl -X POST "${{ secrets.SUPABASE_URL }}/functions/v1/ai-report-draft" \
               -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
               -H "Content-Type: application/json" \
               -d '{ "period_end": "'$(date +%Y-%m-%d)'" }'

6. 테스트:

   - 모의 데이터를 report_snapshots에 100건 넣고 ai-report-draft 호출
   - 결과 마크다운이 Vol.02 양식과 동일한지 확인
   - 4개 섹션이 모두 [현상→원인→전망] 구조인지 확인
   - 데이터 미수집 항목이 솔직히 표시되는지 확인

[주의 사항]
- Claude API 호출 4회 (섹션별) — 비용 약 $0.30~0.50 / 보고서
- 격주 26회 / 년 = 약 $13 / 년 (매우 저렴)
- 토큰 한도: max_tokens=4096 (섹션당 대략 1,500~2,500자)
- AI 출력에 "MTL 시사점"은 포함시키지 않음 (영업이 직접 추가)
```

---

## STEP 3 — 검토·발행 UI + PDF 변환

```
[STEP 3] 영업팀이 AI 초안을 검토하고 "MTL 시사점"을 추가한 뒤 발행하는 UI

[수행할 작업]

1. src/pages/admin/ReportStudio.tsx — 검토 화면

   기능:
   - 좌측: AI 생성 초안 (Markdown 미리보기)
   - 우측: 편집 가능한 textarea
   - 상단: 섹션 navigator (1·2·3·4)
   - 하단: "MTL 시사점 추가" 버튼 (각 이슈마다)

2. 컴포넌트 구조:

   src/pages/admin/ReportStudio.tsx
   src/components/report/
   ├─ ReportEditor.tsx           : Monaco editor 또는 textarea
   ├─ ReportPreview.tsx          : Markdown → HTML 미리보기
   ├─ MtlInsightSuggestion.tsx   : 이슈별 "MTL 시사점" AI 자동 제안
   ├─ DataMissingBadge.tsx       : 데이터 미수집 항목 강조
   └─ PublishButton.tsx          : 최종 발행 버튼

3. ReportStudio.tsx 의사코드:

   export function ReportStudio() {
     const [report, setReport] = useState<Report | null>(null);
     const [editedMd, setEditedMd] = useState<string>('');
     const [activeSection, setActiveSection] = useState<1|2|3|4>(1);

     // 가장 최근 draft 로드
     useEffect(() => {
       supabase.from('reports')
         .select('*')
         .eq('status', 'draft')
         .order('created_at', { ascending: false })
         .limit(1)
         .single()
         .then(({ data }) => {
           setReport(data);
           setEditedMd(data.draft_md);
         });
     }, []);

     async function suggestMtlInsight(sectionContext: string) {
       // Claude API로 MTL 시사점 제안
       const response = await fetch('/api/suggest-mtl-insight', {
         method: 'POST',
         body: JSON.stringify({ context: sectionContext }),
       });
       const { suggestion } = await response.json();
       return suggestion;
     }

     async function publish() {
       // 1) reports.final_md 저장
       await supabase.from('reports')
         .update({
           final_md: editedMd,
           status: 'published',
           approved_at: new Date().toISOString(),
           published_at: new Date().toISOString(),
         })
         .eq('id', report.id);

       // 2) PDF 변환 (md-to-pdf API 호출)
       const pdfRes = await fetch('/api/report-to-pdf', {
         method: 'POST',
         body: JSON.stringify({ md: editedMd, vol: report.vol_number }),
       });
       const { pdf_url } = await pdfRes.json();

       // 3) 이메일 발송 (Supabase Edge Function)
       await supabase.functions.invoke('send-report-email', {
         body: { report_id: report.id, pdf_url, vol: report.vol_number }
       });

       // 4) Logisight 사이트 공개 게시
       // (이미 status='published'이므로 자동 노출)

       toast.success(`Vol.${report.vol_number} 발행 완료!`);
     }

     return (
       <div className="grid grid-cols-2 gap-4 h-screen">
         <div className="overflow-auto p-4">
           <h2>Vol.{report?.vol_number} - 검토</h2>
           <ReportPreview md={editedMd} />
         </div>
         <div className="flex flex-col p-4">
           <SectionNavigator value={activeSection} onChange={setActiveSection} />
           <ReportEditor value={editedMd} onChange={setEditedMd} />
           <button onClick={() => suggestMtlInsight(...)}>
             ✨ MTL 시사점 AI 제안
           </button>
           <PublishButton onPublish={publish} />
         </div>
       </div>
     );
   }

4. supabase/functions/suggest-mtl-insight/index.ts:

   - Input: { context: string }  (해당 섹션·이슈 텍스트)
   - 동작:
     - Claude Sonnet에게 "이 이슈에 대한 MTL 시사점을 작성하라"
     - System prompt: MTL의 강점 (CIS 6법인, TCR/TSR 직계약, SOC 컨테이너,
                       다국어 영업팀, 알마티 법인 등) 명시
     - Output: 3~5줄 한국어 코멘트 (MTL 영업이 검토 후 채택)

5. supabase/functions/send-report-email/index.ts:

   - 구독자 목록 조회 (subscribers 테이블)
   - SendGrid 또는 Resend API로 발송
   - 이메일 본문: 첫 페이지 미리보기 + PDF 첨부 또는 다운로드 링크

6. supabase/functions/report-to-pdf/index.ts:

   - md → HTML 변환 (marked 라이브러리)
   - HTML → PDF (Puppeteer Edge Function 또는 외부 API)
   - Supabase Storage에 업로드 → public URL 반환

7. 사이트 공개 페이지 src/pages/Reports.tsx:

   - 발행된 보고서 목록 (status='published')
   - 비로그인: 첫 페이지 미리보기만
   - 로그인: 전체 PDF 다운로드 + Markdown 형태 열람
   - SEO: 보고서 제목·요약을 OG meta로 노출

8. 테스트 시나리오:

   □ AI가 생성한 초안을 ReportStudio에서 열기
   □ 데이터 미수집 항목이 빨간 배지로 표시되는지 확인
   □ "MTL 시사점 AI 제안" 버튼 → 3~5줄 제안 받아 편집 가능
   □ 최종 발행 → PDF 생성 + 이메일 발송 + 사이트 게시
   □ 비로그인 사용자가 사이트에서 보고서 첫 페이지만 볼 수 있는지
   □ Vol.02부터 Vol.NN까지 발행 history 페이지

[전체 파이프라인 검증]
─────────────────────────────────────────────
일요일 18:00 → GitHub Actions: 데이터 수집 시작
일요일 18:30 → GitHub Actions: AI 초안 생성 (4개 섹션)
일요일 19:00 → 영업팀에 Slack/이메일로 검토 알림
월요일 10:00 → 영업팀이 ReportStudio에서 검토·MTL 시사점 추가 (30분~1시간)
월요일 11:00 → 발행 → 구독자 200명 이메일 + 사이트 게시
─────────────────────────────────────────────
총 작업 시간: 16h (수작업) → 1.5h (자동화)
```

---

## 통합 작업 노트 — 디렉터리 구조 (전체)

```
logisight/
├─ src/
│  ├─ pages/
│  │  ├─ admin/ReportStudio.tsx
│  │  └─ Reports.tsx
│  ├─ components/report/
│  │  ├─ ReportEditor.tsx
│  │  ├─ ReportPreview.tsx
│  │  ├─ MtlInsightSuggestion.tsx
│  │  ├─ DataMissingBadge.tsx
│  │  └─ PublishButton.tsx
│  └─ api/
│     ├─ report-to-pdf.ts
│     └─ suggest-mtl-insight.ts
├─ workers/
│  └─ collectors/
│     ├─ index.ts
│     ├─ shipping_indices.ts
│     ├─ bunker.ts
│     ├─ air_indices.ts
│     ├─ blank_sailing.ts
│     ├─ fleet.ts
│     ├─ rail_tcr.ts
│     ├─ rail_tsr.ts
│     ├─ news_global.ts
│     ├─ news_korea.ts
│     ├─ news_china.ts
│     ├─ policy_us.ts
│     ├─ policy_eu.ts
│     ├─ policy_imo.ts
│     └─ utils/
│        ├─ playwright_pool.ts
│        ├─ rate_limiter.ts
│        └─ snapshot_writer.ts
├─ supabase/
│  ├─ migrations/
│  │  ├─ 0001_create_hs_tables.sql       # PRD v1.0 STEP 1 (HS-Code)
│  │  └─ 0010_create_report_tables.sql   # 본 STEP 1
│  └─ functions/
│     ├─ hs-search/                      # PRD v1.0 STEP 3
│     ├─ ai-report-draft/                # 본 STEP 2
│     ├─ suggest-mtl-insight/            # 본 STEP 3
│     ├─ send-report-email/              # 본 STEP 3
│     └─ report-to-pdf/                  # 본 STEP 3
├─ .github/workflows/
│  ├─ auto-drafter-collect.yml           # 매주 일요일 18:00 KST
│  └─ auto-drafter-generate.yml          # 매주 일요일 18:30 KST
└─ .env.local
   ├─ SUPABASE_URL
   ├─ SUPABASE_SERVICE_ROLE_KEY
   ├─ ANTHROPIC_API_KEY
   ├─ OPENAI_API_KEY
   └─ SENDGRID_API_KEY (또는 RESEND_API_KEY)
```

---

## 검수 체크리스트 (전체)

```
STEP 1 — 데이터 수집기
□ Supabase 마이그레이션 적용 (report_snapshots, report_news, reports 3테이블)
□ shipping_indices.ts → KCCI/SCFI/WCI/FBX 수집 성공
□ rail_tcr.ts → CR Express + Landbridge 5개 카테고리 수집 성공
□ blank_sailing.ts → Drewry Cancelled Sailings 수집 성공
□ GitHub Actions Cron 일요일 18:00 KST 동작 확인
□ 동일 날짜 2회 실행 시 UNIQUE 제약 동작
□ 사이트 차단 시 is_complete=false 기록

STEP 2 — AI 초안 생성
□ ai-report-draft Edge Function 배포
□ 모의 데이터 100건으로 4개 섹션 생성 확인
□ 출력이 MTL Vol.02 양식과 일치 (Markdown 구조)
□ [현상→원인→전망] 3단 구조 엄수
□ "데이터 미수집" 솔직 표시
□ 격주 자동 트리거 (일요일 18:30 KST)

STEP 3 — 검토·발행 UI
□ ReportStudio 페이지 작동 (좌: 미리보기, 우: 편집)
□ MTL 시사점 AI 제안 작동
□ PDF 변환 + Supabase Storage 업로드
□ 이메일 발송 (구독자 200명 가정)
□ 사이트 Reports 페이지에 자동 게시
□ 비로그인 사용자에게 첫 페이지만 노출
□ Vol.02 ~ Vol.NN 발행 history 페이지

전체 파이프라인
□ 일요일 18:00 → 19:00 동안 모든 데이터 수집·생성 완료
□ 영업팀이 월요일 오전 검토 → 1시간 내 발행
□ 1주차에 영업팀이 직접 작성한 Vol.02와 비교 → 정확도 검증
□ 3주차에 자동 발행된 Vol.04 정식 고객 발송
```

---

## ROI 계산 (Codex 작업 비용 vs 효과)

```
Codex 작업 비용
─────────────────────────────────────────────
  STEP 1 (데이터 수집): 개발 4~6주 (1인)
  STEP 2 (AI 초안):     개발 1~2주
  STEP 3 (검토 UI):     개발 2~3주
  ─────────────────────
  총 개발 기간:          7~11주 (약 2~3개월)
  외부 비용:             $0 (Claude API 매월 $13 외)

효과 (1년차)
─────────────────────────────────────────────
  격주 발행 시간 절감:  16h × 26회 × 5만원 = 1,690만원
  자동 데이터 자산화:   사이트 자체가 회사 자산
  영업 리드 발생:       사이트 트래픽 → MTL 영업
  보고서 신뢰도 강화:   "Logisight 분석" 브랜드

ROI: 개발 비용 대비 1년차 회수 가능 (영업팀 인건비만으로도)
```

---

*본 지시문은 Logisight PRD v1.1의 모듈 6 (Auto Bi-Weekly Report Generator) 구현용입니다. PRD v1.0의 13장 (HS-Code 모듈 STEP 1~4)는 그대로 유지되며, 본 문서와 병행 사용됩니다. STEP 1 → 2 → 3 순서대로 한 단계씩 검수 후 진행하는 것을 강력히 권장합니다.*
