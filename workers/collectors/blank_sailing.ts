// workers/collectors/blank_sailing.ts
// 블랭크 세일링 (임시 결항) 수집기
// 대상: Drewry Cancelled Sailings Tracker (무료 공개)

import { chromium, type Browser } from 'playwright';
import { rateLimited } from './utils/rate_limiter';
import { snapshotWriter } from './utils/snapshot_writer';
import type { CollectorResult } from './types';

const DREWRY_URL = 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/cancelled-sailings-tracker';

export async function collect(): Promise<CollectorResult> {
  const result: CollectorResult = { section: 'shipping', data: [] };
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Logisight/1.0 (logisight.mtlship.com; bot)',
    });

    await rateLimited(DREWRY_URL, async () => {
      await page.goto(DREWRY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
    });

    // 블랭크 세일링 수치 추출
    const data = await page.evaluate(() => {
      const text = document.body.innerText;

      // 결항 편수 패턴 (예: "43 void sailings", "34 blank sailings")
      const voidMatch = text.match(/(\d+)\s*(?:void|blank|cancelled)\s*(?:sailings?|voyages?)/i);
      // 취소율 패턴 (예: "6%", "5.4%")
      const rateMatch = text.match(/(\d+(?:\.\d+)?)\s*%.*?(?:cancelled|void|blank)/i)
        || text.match(/(?:cancelled|void|blank).*?(\d+(?:\.\d+)?)\s*%/i);
      // 총 항차 수
      const totalMatch = text.match(/(\d{3,4})\s*(?:scheduled|planned|total)\s*(?:sailings?|voyages?)/i);

      return {
        void_count: voidMatch ? parseInt(voidMatch[1]) : null,
        cancel_rate: rateMatch ? parseFloat(rateMatch[1]) : null,
        total_sailings: totalMatch ? parseInt(totalMatch[1]) : null,
        raw_snippet: text.slice(0, 500),
      };
    });

    result.data.push({
      data_type: 'blank_sailing',
      data_key: 'BLANK_SAILING_SUMMARY',
      data_value: {
        ...data,
        date: new Date().toISOString().slice(0, 10),
        source: 'Drewry Cancelled Sailings Tracker',
        source_url: DREWRY_URL,
        weeks: 'W20-W24',
      },
      source: 'Drewry',
      source_url: DREWRY_URL,
      is_complete: data.void_count !== null,
      error_message: data.void_count === null ? '수치 파싱 실패 — 페이지 구조 변경 가능성' : undefined,
    });

    console.log(`✅ blank_sailing: ${data.void_count !== null ? `${data.void_count}편 결항` : '파싱 실패'}`);

  } catch (error) {
    console.error('❌ blank_sailing 수집 실패:', (error as Error).message);
    result.data.push({
      data_type: 'blank_sailing',
      data_key: 'BLANK_SAILING_SUMMARY',
      data_value: {},
      source: 'Drewry',
      source_url: DREWRY_URL,
      is_complete: false,
      error_message: (error as Error).message,
    });
  } finally {
    if (browser) await browser.close();
  }

  return result;
}

if (require.main === module) {
  collect().then(r => snapshotWriter(r)).catch(console.error);
}
