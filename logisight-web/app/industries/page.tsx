import Link from 'next/link';
import { Navigation } from '@/components/Navigation';
import { IndexBar } from '@/components/IndexBar';
import { Footer } from '@/components/Footer';
import {
  getIndustriesNews,
  getIndices,
  getLastUpdated,
} from '@/lib/supabase/queries';
import type { IndustrySection } from '@/lib/supabase/queries';
import type { NewsArticle } from '@/lib/types';

export const revalidate = 3600;

const CATEGORY_COLOR: Record<string, string> = {
  해상: 'bg-blue-500/15 text-blue-700',
  항공: 'bg-purple-500/15 text-purple-700',
  철도: 'bg-amber-500/15 text-amber-700',
  물류: 'bg-emerald-500/15 text-emerald-700',
  무역: 'bg-rose-500/15 text-rose-700',
};

// ── 아이콘 (Tailwind SVG inline) ───────────────────────────────────────────
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
  // snowflake
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />
    </svg>
  );
}

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

function SectionBlock({ section }: { section: IndustrySection }) {
  const leadTag = section.tags[0];
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
        <div className="grid grid-cols-3 gap-3">
          {section.articles.map((article) => (
            <NewsCard key={article.id} article={article} />
          ))}
        </div>
      )}
    </section>
  );
}

export default async function IndustriesPage() {
  const [sections, indices, lastUpdated] = await Promise.all([
    getIndustriesNews(),
    getIndices(),
    getLastUpdated(),
  ]);

  return (
    <main className="min-h-screen flex flex-col">
      <Navigation />
      <IndexBar indices={indices} lastUpdated={lastUpdated} />

      <div className="flex-1 bg-slate-50 px-4 lg:px-8 py-6 lg:py-10">
        <div className="max-w-page mx-auto">
          <h2 className="text-lg font-medium text-slate-800 mb-1">산업별 물류 동향</h2>
          <p className="text-[12px] text-slate-500 mb-6 keep-all">
            배터리·전기차, 자동차, 이커머스, 냉동냉장 산업의 공급망 및 물류 뉴스
          </p>

          {sections.map((section) => (
            <SectionBlock key={section.id} section={section} />
          ))}
        </div>
      </div>

      <Footer />
    </main>
  );
}
