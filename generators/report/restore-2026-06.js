'use strict';
// generators/report/restore-2026-06.js
// 한국 2026년 6월호 리포트 복구 — 일회성 스크립트.
//
// 일본 리포트 발행 시 id·스토리지 키에 언어 차원이 없어 같은 id(monthly-2026-06-01)와
// 같은 경로(monthly/2026-06-01.pdf)로 한국 6월호를 DB·스토리지 양쪽에서 덮어썼다.
// 원본 PDF는 content/published/ 에 남아 있고, 메타데이터는
// publish-monthly-report.js 의 규칙에서 그대로 복원된다.
//
// published_at 만은 원본을 알 수 없어 created_at(2026-06-24T01:40:53.799Z)을 쓴다.
// 같은 배치의 5월호가 01:40:40 이므로 실제 값과 초 단위 차이다.

const fs = require('fs');
const path = require('path');
const ws = require('ws');
globalThis.WebSocket = ws;

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });

const ROOT = path.resolve(__dirname, '../..');
const PDF = path.join(ROOT, 'content/published/monthly-analysis-2026-06.pdf');
const KEY = 'monthly/2026-06-01.pdf';

const ROW = {
  id: 'monthly-2026-06-01',
  type: 'monthly',
  lang: 'ko',
  period_start: '2026-06-01',
  period_end: '2026-06-30',
  period_label: '2026년 6월호',
  title: '월간 시장 인텔리전스 리포트 · 6월호',
  summary: '글로벌 해운·항공·철도 운임과 공급망·지정학 동향 종합 분석',
  pdf_path: KEY,
  pdf_url: 'https://logisight.mtlship.com/reports/monthly/2026-06-01.pdf',
  web_url: null,
  cover_url: null,
  published_at: '2026-06-24T01:40:53.799Z',
  report_class: 'monthly',
  region: null,
  iso_week: null,
};

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  if (!fs.existsSync(PDF)) throw new Error(`원본 PDF 없음: ${PDF}`);
  const buf = fs.readFileSync(PDF);

  const up = await sb.storage
    .from('reports')
    .upload(KEY, buf, { contentType: 'application/pdf', upsert: true });
  if (up.error) throw new Error(`PDF 복구 실패: ${up.error.message}`);
  console.log(`✅ PDF 복구: ${KEY} (${buf.length.toLocaleString()} bytes)`);

  const { error } = await sb.from('reports').upsert(ROW, { onConflict: 'id' });
  if (error) throw new Error(`DB 복구 실패: ${error.message}`);
  console.log(`✅ DB 복구: ${ROW.id} (lang=ko)`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('❌ 복구 실패:', e.message);
    process.exit(1);
  });
}
