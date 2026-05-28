import Link from 'next/link';
import { Navigation } from '@/components/Navigation';
import { IndexBar } from '@/components/IndexBar';
import { Footer } from '@/components/Footer';
import { TradeTrendChart } from '@/components/industries/TradeTrendChart';
import {
  getIndustriesNews,
  getTradeStatsByIndustry,
  getTradeTrend,
  getIndices,
  getLastUpdated,
} from '@/lib/supabase/queries';
import type { IndustrySection, TradeStatRow } from '@/lib/supabase/queries';
import type { NewsArticle } from '@/lib/types';
import { INDUSTRY_HS_MAP, type IndustryKey } from '@/lib/industry-hs-map';

export const revalidate = 3600;

const CATEGORY_COLOR: Record<string, string> = {
  해상: 'bg-blue-500/15 text-blue-700',
  항공: 'bg-purple-500/15 text-purple-700',
  철도: 'bg-amber-500/15 text-amber-700',
  물류: 'bg-emerald-500/15 text-emerald-700',
  무역: 'bg-rose-500/15 text-rose-700',
};

// ── 아이콘 ────────────────────────────────────────────────────────────────────
function IndustryIcon({ icon }: { icon: string }) {
  const cls = 'w-5 h-5 text-cyan-600 shrink-0';
  if (icon === 'bolt')
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    );
  if (icon === 'car')
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 17h8M3 12l2-5h14l2 5M5 12h14M7 17a1 1 0 100-2 1 1 0 000 2zm10 0a1 1 0 100-2 1 1 0 000 2z" />
      </svg>
    );
  if (icon === 'shopping-cart')
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 5h14M9 21a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z" />
      </svg>
    );
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />
    </svg>
  );
}

// ── 뉴스 카드 ─────────────────────────────────────────────────────────────────
function NewsCard({ article }: { article: NewsArticle }) {
  const href = article.source_url ?? '#';
  const catColor = CATEGORY_COLOR[article.category as string] ?? 'bg-slate-100 text-slate-600';
  return (
    <article className="bg-white rounded-lg border border-slate-200 p-4 hover:shadow-sm transition flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        {article.category && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${catColor}`}>
            {article.category}
          </span>
        )}
        <span className="text-[10px] text-slate-400 ml-auto">{article.published_at}</span>
      </div>
      <h3 className="text-[13px] font-medium text-slate-800 leading-snug keep-all flex-1">
        <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-600">
          {article.title}
        </a>
      </h3>
      {article.summary && (
        <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed line-clamp-2 keep-all">
          {article.summary}
        </p>
      )}
    </article>
  );
}

// ── 무역통계 집계 ─────────────────────────────────────────────────────────────
interface TradeSummary {
  latestPeriod: string;
  exportUsd: number;
  importUsd: number;
  tradeBalance: number;
  exportYoY: number | null;
  importYoY: number | null;
  trend: Array<{ period: string; export_usd: number | null; import_usd: number | null }>;
}

function aggregateTrade(rows: TradeStatRow[]): TradeSummary | null {
  if (!rows.length) return null;

  const byPeriod = new Map<string, { export_usd: number; import_usd: number }>();
  for (const row of rows) {
    if (!byPeriod.has(row.period)) byPeriod.set(row.period, { export_usd: 0, import_usd: 0 });
    const acc = byPeriod.get(row.period)!;
    acc.export_usd += row.export_usd ?? 0;
    acc.import_usd += row.import_usd ?? 0;
  }

  const periods = [...byPeriod.keys()].sort((a, b) => b.localeCompare(a));
  const latestPeriod = periods[0];
  const latest = byPeriod.get(latestPeriod)!;

  // 전년동월: 'YYYYMM' → year-1 + MM
  const lastYearPeriod = String(Number(latestPeriod.slice(0, 4)) - 1) + latestPeriod.slice(4);
  const lastYear = byPeriod.get(lastYearPeriod);

  const exportYoY = lastYear && lastYear.export_usd > 0
    ? (latest.export_usd - lastYear.export_usd) / lastYear.export_usd * 100
    : null;
  const importYoY = lastYear && lastYear.import_usd > 0
    ? (latest.import_usd - lastYear.import_usd) / lastYear.import_usd * 100
    : null;

  const trend = [...periods].reverse().map((p) => ({
    period: p,
    export_usd: byPeriod.get(p)!.export_usd,
    import_usd: byPeriod.get(p)!.import_usd,
  }));

  return {
    latestPeriod,
    exportUsd: latest.export_usd,
    importUsd: latest.import_usd,
    tradeBalance: latest.export_usd - latest.import_usd,
    exportYoY,
    importYoY,
    trend,
  };
}

function fmtUsd(v: number): string {
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

function fmtPct(v: number | null): string {
  if (v === null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

// ── 무역통계 블록 ─────────────────────────────────────────────────────────────
function TradeBlock({ summary }: { summary: TradeSummary | null }) {
  const period = summary?.latestPeriod;
  const periodLabel = period
    ? `${period.slice(0, 4)}년 ${period.slice(4)}월`
    : null;

  return (
    <div className="mt-4 bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-[0.06em]">
          수출입 무역통계
        </span>
        {periodLabel && (
          <span className="text-[10px] text-slate-400">
            출처: 관세청 · 기준: {periodLabel}
          </span>
        )}
      </div>

      {!summary ? (
        <p className="text-[12px] text-slate-400 text-center py-4">
          무역통계 수집 예정 — 관세청 API 어댑터 구축 후 표시됩니다.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* KPI 3개 */}
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <div className="text-[10px] text-slate-500 mb-0.5">수출</div>
              <div className="text-[14px] font-semibold text-slate-800">{fmtUsd(summary.exportUsd)}</div>
              <div className={`text-[10px] ${summary.exportYoY === null ? 'text-slate-400' : summary.exportYoY >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                전년동월 {fmtPct(summary.exportYoY)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 mb-0.5">수입</div>
              <div className="text-[14px] font-semibold text-slate-800">{fmtUsd(summary.importUsd)}</div>
              <div className={`text-[10px] ${summary.importYoY === null ? 'text-slate-400' : summary.importYoY >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                전년동월 {fmtPct(summary.importYoY)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-slate-500 mb-0.5">무역수지</div>
              <div className={`text-[14px] font-semibold ${summary.tradeBalance >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {fmtUsd(summary.tradeBalance)}
              </div>
              <div className="text-[10px] text-slate-400">흑자/적자</div>
            </div>
          </div>

          {/* 미니 차트 */}
          {summary.trend.length > 1 && (
            <TradeTrendChart data={summary.trend} />
          )}
        </div>
      )}
    </div>
  );
}

// ── 산업 섹션 블록 ────────────────────────────────────────────────────────────
function SectionBlock({
  section,
  tradeSummary,
}: {
  section: IndustrySection;
  tradeSummary: TradeSummary | null;
}) {
  const leadTag = section.tags[0];
  const hsMap = INDUSTRY_HS_MAP[section.name as IndustryKey];
  const isNewsOnly = hsMap?.newsOnly ?? false;

  return (
    <section className="py-7 border-b border-slate-200 last:border-0">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <IndustryIcon icon={section.icon} />
          <div>
            <h2 className="text-[15px] font-semibold text-slate-800">{section.name}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5 keep-all">{section.description}</p>
          </div>
        </div>
        <Link
          href={`/news?tag=${encodeURIComponent(leadTag)}`}
          className="text-[11px] text-cyan-600 hover:text-cyan-700 shrink-0 ml-4"
        >
          더보기 →
        </Link>
      </div>

      {/* 뉴스 그리드 */}
      {section.articles.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-5 text-center text-slate-400 text-[12px]">
          곧 업데이트됩니다.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {section.articles.map((article) => (
            <NewsCard key={article.id} article={article} />
          ))}
        </div>
      )}

      {/* 무역통계 블록 (이커머스 제외) */}
      {!isNewsOnly && <TradeBlock summary={tradeSummary} />}
    </section>
  );
}

// ── 페이지 ────────────────────────────────────────────────────────────────────
export default async function IndustriesPage() {
  const [sections, indices, lastUpdated] = await Promise.all([
    getIndustriesNews(),
    getIndices(),
    getLastUpdated(),
  ]);

  // 산업별 무역통계 병렬 조회
  const tradeDataMap = new Map<string, TradeSummary | null>();
  const HS_INDUSTRIES: Array<{ id: string; hsCodes: readonly string[] }> = [
    { id: '배터리·전기차', hsCodes: INDUSTRY_HS_MAP['배터리·전기차'].hsCodes },
    { id: '자동차',        hsCodes: INDUSTRY_HS_MAP['자동차'].hsCodes },
    { id: '냉동냉장',      hsCodes: INDUSTRY_HS_MAP['냉동냉장'].hsCodes },
  ];

  const tradeResults = await Promise.all(
    HS_INDUSTRIES.map(({ hsCodes }) => getTradeStatsByIndustry(hsCodes))
  );
  for (let i = 0; i < HS_INDUSTRIES.length; i++) {
    tradeDataMap.set(HS_INDUSTRIES[i].id, aggregateTrade(tradeResults[i]));
  }

  return (
    <main className="min-h-screen flex flex-col">
      <Navigation />
      <IndexBar indices={indices} lastUpdated={lastUpdated} />

      <div className="flex-1 bg-slate-50 px-4 lg:px-8 py-6 lg:py-10">
        <div className="max-w-page mx-auto">
          <h2 className="text-lg font-medium text-slate-800 mb-1">산업별 물류 동향</h2>
          <p className="text-[12px] text-slate-500 mb-6 keep-all">
            배터리·전기차, 자동차, 이커머스, 냉동냉장 산업의 공급망·물류 뉴스 및 수출입 무역통계 (출처: 관세청)
          </p>

          {sections.map((section) => {
            const tradeSummary = tradeDataMap.get(section.name) ?? null;
            return (
              <SectionBlock
                key={section.id}
                section={section}
                tradeSummary={tradeSummary}
              />
            );
          })}
        </div>
      </div>

      <Footer />
    </main>
  );
}
