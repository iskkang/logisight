// workers/collectors/shipping_indices.ts
// 컨테이너 운임 지수 수집기 — fetch 기반 (Playwright 미사용)
// 대상: WCI (Drewry), FBX (Freightos), KCCI (KOBC fetch), SCFI (수동 입력)

import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult } from './types';

interface IndexData {
  name: string;
  value: number | null;
  change_pct: number | null;
  date: string;
  unit: string;
  source: string;
  source_url: string;
  note?: string;
}

const TODAY = new Date().toISOString().slice(0, 10);

// ── WCI (Drewry) — 무료 공개 헤드라인 ──────────────────────────
async function fetchWCI(): Promise<IndexData[]> {
  const url = 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const valueMatch = html.match(/\$\s*([\d,]+(?:\.\d+)?)\s*\/\s*FEU/i);
  const changeMatch = html.match(/([-+]?\d+(?:\.\d+)?)\s*%/);

  return [{
    name: 'WCI_종합',
    value: valueMatch ? parseFloat(valueMatch[1].replace(/,/g, '')) : null,
    change_pct: changeMatch ? parseFloat(changeMatch[1]) : null,
    date: TODAY,
    unit: '$/FEU',
    source: 'Drewry WCI',
    source_url: url,
  }];
}

// ── FBX (Freightos) — 공개 데이터 ──────────────────────────────
async function fetchFBX(): Promise<IndexData[]> {
  const url = 'https://fbx.freightos.com/';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)' },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    const match = html.match(/FBX.*?([\d,]+(?:\.\d+)?)/i);
    return [{
      name: 'FBX_글로벌',
      value: match ? parseFloat(match[1].replace(/,/g, '')) : null,
      change_pct: null,
      date: TODAY,
      unit: '$/FEU',
      source: 'Freightos FBX',
      source_url: url,
    }];
  } catch {
    return [{
      name: 'FBX_글로벌',
      value: null,
      change_pct: null,
      date: TODAY,
      unit: '$/FEU',
      source: 'Freightos FBX',
      source_url: url,
    }];
  }
}

// ── SCFI — 자동 수집 불가, 수동 입력 필요 ──────────────────────
function buildSCFIStub(): IndexData[] {
  console.log('⚠️ SCFI 자동 수집 불가 — 수동 입력 필요 (Shanghai Shipping Exchange 접근 차단)');
  return [{
    name: 'SCFI_종합',
    value: null,
    change_pct: null,
    date: TODAY,
    unit: 'point',
    source: 'Shanghai Shipping Exchange',
    source_url: 'https://en.sse.net.cn/indices/scfinew.jsp',
    note: 'SCFI 자동 수집 불가 — 수동 입력 필요',
  }];
}

// ── KCCI (한국컨테이너운임지수) — KOBC fetch + 정규식 ───────────
async function fetchKCCI(): Promise<IndexData[]> {
  const url = 'https://www.kobc.or.kr/index/kcci';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const raw =
      html.match(/KCCI.*?(\d{1,4}(?:\.\d+)?)/is)?.[1] ||
      html.match(/종합.*?(\d{3,4}(?:\.\d+)?)/is)?.[1] ||
      null;

    const value = raw ? parseFloat(raw) : null;
    if (value === null) {
      console.log('⚠️ KCCI 수치 파싱 실패: 정규식 매칭 없음');
    } else {
      console.log(`✅ KCCI: ${value}`);
    }

    return [{
      name: 'KCCI_종합',
      value,
      change_pct: null,
      date: TODAY,
      unit: 'point',
      source: 'KOBC',
      source_url: url,
    }];
  } catch (e) {
    console.log(`⚠️ KCCI 수집 실패: ${(e as Error).message}`);
    return [{
      name: 'KCCI_종합',
      value: null,
      change_pct: null,
      date: TODAY,
      unit: 'point',
      source: 'KOBC',
      source_url: url,
    }];
  }
}

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };

  // SCFI stub (동기, fetch 없음)
  for (const d of buildSCFIStub()) {
    result.data.push({
      data_type: 'index',
      data_key: d.name,
      data_value: d,
      source: d.source,
      source_url: d.source_url,
      is_complete: false,
      error_message: d.note,
    });
  }

  // WCI + FBX + KCCI (병렬 fetch)
  const [wciRes, fbxRes, kcciRes] = await Promise.allSettled([
    rateLimited('https://www.drewry.co.uk', () => fetchWCI()),
    rateLimited('https://fbx.freightos.com', () => fetchFBX()),
    rateLimited('https://www.kobc.or.kr', () => fetchKCCI()),
  ]);

  for (const [label, res] of [['WCI', wciRes], ['FBX', fbxRes], ['KCCI', kcciRes]] as const) {
    if (res.status === 'rejected') {
      console.log(`⚠️ ${label} 실패: ${(res.reason as Error).message}`);
      continue;
    }
    for (const d of res.value) {
      result.data.push({
        data_type: 'index',
        data_key: d.name,
        data_value: d,
        source: d.source,
        source_url: d.source_url,
        is_complete: d.value !== null,
        error_message: d.value === null ? '데이터 파싱 실패' : undefined,
      });
    }
  }

  const success = result.data.filter(d => d.is_complete).length;
  console.log(`✅ shipping_indices: ${success}/${result.data.length}개 수집 완료`);

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
