import { Navigation } from '@/components/Navigation';
import { IndexBar } from '@/components/IndexBar';
import { Footer } from '@/components/Footer';
import { TradeTrendChart } from '@/components/industries/TradeTrendChart';
import {
  getTopTradeChapters,
  getIndices,
  getLastUpdated,
} from '@/lib/supabase/queries';
import type { TopChapterData } from '@/lib/supabase/queries';

export const revalidate = 3600;

function fmtUsd(v: number): string {
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

function fmtPct(v: number | null): string {
  if (v === null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function ChapterBlock({ chapter }: { chapter: TopChapterData }) {
  const periodLabel = chapter.latestPeriod
    ? `${chapter.latestPeriod.slice(0, 4)}년 ${Number(chapter.latestPeriod.slice(4))}월`
    : null;

  return (
    <section className="py-7 border-b border-slate-200 last:border-0">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-800">
            {chapter.chapterName}
            <span className="ml-2 text-[11px] font-normal text-slate-400">HS {chapter.chapter}</span>
          </h2>
          {periodLabel && (
            <p className="text-[11px] text-slate-500 mt-0.5">기준: {periodLabel}</p>
          )}
        </div>
        <span className="text-[10px] text-slate-400 shrink-0 mt-0.5">관세청</span>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        {/* KPI 3개 */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="text-center">
            <div className="text-[10px] text-slate-500 mb-0.5">수출</div>
            <div className="text-[14px] font-semibold text-slate-800">{fmtUsd(chapter.exportUsd)}</div>
            <div className={`text-[10px] ${chapter.exportYoY === null ? 'text-slate-400' : chapter.exportYoY >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              전년동월 {fmtPct(chapter.exportYoY)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-slate-500 mb-0.5">수입</div>
            <div className="text-[14px] font-semibold text-slate-800">{fmtUsd(chapter.importUsd)}</div>
            <div className={`text-[10px] ${chapter.importYoY === null ? 'text-slate-400' : chapter.importYoY >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              전년동월 {fmtPct(chapter.importYoY)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-slate-500 mb-0.5">무역수지</div>
            <div className={`text-[14px] font-semibold ${chapter.tradeBalance >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              {fmtUsd(chapter.tradeBalance)}
            </div>
            <div className="text-[10px] text-slate-400">흑자/적자</div>
          </div>
        </div>

        {/* 상위 교역국 */}
        {chapter.topCountries.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] text-slate-400 mb-1.5 uppercase tracking-[0.05em]">
              상위 교역국 (수출 기준)
            </div>
            <div className="flex flex-col gap-1">
              {chapter.topCountries.map((c) => {
                const pct = chapter.exportUsd > 0
                  ? Math.round(c.export_usd / chapter.exportUsd * 100) : 0;
                return (
                  <div key={c.code} className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 w-6 shrink-0">{c.code}</span>
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-slate-600 w-16 text-right shrink-0">
                      {fmtUsd(c.export_usd)}
                    </span>
                    <span className="text-[10px] text-slate-400 w-8 text-right shrink-0">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 미니 추세 차트 */}
        {chapter.trend.length > 1 && (
          <TradeTrendChart data={chapter.trend} />
        )}
      </div>
    </section>
  );
}

export default async function IndustriesPage() {
  const [chapters, indices, lastUpdated] = await Promise.all([
    getTopTradeChapters(10),
    getIndices(),
    getLastUpdated(),
  ]);

  return (
    <main className="min-h-screen flex flex-col">
      <Navigation />
      <IndexBar indices={indices} lastUpdated={lastUpdated} />

      <div className="flex-1 bg-slate-50 px-4 lg:px-8 py-6 lg:py-10">
        <div className="max-w-page mx-auto">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-lg font-medium text-slate-800 mb-1">교역량 상위 품목 동향</h2>
              <p className="text-[12px] text-slate-500 keep-all">
                관세청 수출입 무역통계 기준 교역량 상위 품목 · HS 챕터별 집계
              </p>
            </div>
          </div>

          {chapters.length === 0 ? (
            <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
              <p className="text-[13px] text-slate-400">관세청 데이터 수집 예정</p>
              <p className="text-[11px] text-slate-300 mt-1">
                npx tsx scripts/fetch-trade-stats.ts 실행 후 표시됩니다.
              </p>
            </div>
          ) : (
            chapters.map((ch) => (
              <ChapterBlock key={ch.chapter} chapter={ch} />
            ))
          )}
        </div>
      </div>

      <Footer />
    </main>
  );
}
