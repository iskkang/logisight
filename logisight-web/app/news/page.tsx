import Link from 'next/link';
import { Navigation } from '@/components/Navigation';
import { IndexBar } from '@/components/IndexBar';
import { Footer } from '@/components/Footer';
import { NewsletterCTA } from '@/components/sidebar/NewsletterCTA';
import {
  getNewsList,
  getIndices,
  getLastUpdated,
} from '@/lib/supabase/queries';
import type { NewsArticle } from '@/lib/types';
import type { NewsCategory } from '@/lib/types';

export const revalidate = 0;

const CATEGORIES: NewsCategory[] = ['해상', '항공', '철도', '물류', '무역'];

const CATEGORY_COLOR: Record<NewsCategory, string> = {
  해상: 'bg-blue-500/15 text-blue-300',
  항공: 'bg-purple-500/15 text-purple-300',
  철도: 'bg-amber-500/15 text-amber-300',
  물류: 'bg-emerald-500/15 text-emerald-300',
  무역: 'bg-rose-500/15 text-rose-300',
};

function ArticleCard({ article }: { article: NewsArticle }) {
  const internalHref = article.slug ? `/article/${article.slug}` : null;
  const externalHref = article.source_url ?? null;
  return (
    <article className="bg-white rounded-lg border border-slate-200 p-4 hover:shadow-sm transition">
      <div className="flex items-center gap-2 mb-2">
        {article.category && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${CATEGORY_COLOR[article.category as NewsCategory] ?? 'bg-slate-100 text-slate-500'}`}>
            {article.category}
          </span>
        )}
        <span className="text-[10px] text-slate-400">{article.source_name}</span>
        <span className="text-[10px] text-slate-400 ml-auto">{article.published_at}</span>
      </div>
      <h3 className="text-[14px] font-medium text-slate-800 leading-snug mb-1.5 keep-all">
        {internalHref ? (
          <Link href={internalHref} className="hover:text-cyan-600">{article.title}</Link>
        ) : externalHref ? (
          <a href={externalHref} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-600">
            {article.title}
          </a>
        ) : (
          <span>{article.title}</span>
        )}
      </h3>
      {article.summary && (
        <p className="text-[12px] text-slate-500 leading-relaxed line-clamp-2 keep-all">
          {article.summary}
        </p>
      )}
    </article>
  );
}

export default async function NewsPage({
  searchParams,
}: {
  searchParams: { cat?: string; before?: string };
}) {
  const cat = CATEGORIES.includes(searchParams.cat as NewsCategory)
    ? (searchParams.cat as NewsCategory)
    : undefined;
  const before = searchParams.before;

  const [{ articles, hasMore }, indices, lastUpdated] = await Promise.all([
    getNewsList({ category: cat, before }),
    getIndices(),
    getLastUpdated(),
  ]);

  const lastPublishedAt = articles.at(-1)?.published_at;
  const nextCursor = hasMore && lastPublishedAt ? lastPublishedAt : null;

  return (
    <main className="min-h-screen flex flex-col">
      <Navigation />
      <IndexBar indices={indices} lastUpdated={lastUpdated} />

      <div className="flex-1 bg-slate-50 px-4 lg:px-8 py-6 lg:py-10">
        <div className="max-w-page mx-auto">
          <div className="mb-5">
            <h2 className="text-lg font-medium text-slate-800 mb-3">뉴스</h2>

            {/* Category filter */}
            <div className="flex gap-1.5 flex-wrap">
              <Link
                href="/news"
                className={`text-[11px] px-3 py-1 rounded-full border transition ${
                  !cat
                    ? 'bg-navy-900 text-white border-navy-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}
              >
                전체
              </Link>
              {CATEGORIES.map((c) => (
                <Link
                  key={c}
                  href={`/news?cat=${encodeURIComponent(c)}`}
                  className={`text-[11px] px-3 py-1 rounded-full border transition ${
                    cat === c
                      ? 'bg-navy-900 text-white border-navy-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {c}
                </Link>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">
            {/* Main: article list */}
            <div>
              {articles.length === 0 ? (
                <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">
                  해당 카테고리 기사가 없습니다.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {articles.map((article) => (
                    <ArticleCard key={article.id} article={article} />
                  ))}
                </div>
              )}

              {/* Pagination */}
              {nextCursor && (
                <div className="mt-5 flex justify-center">
                  <Link
                    href={`/news${cat ? `?cat=${encodeURIComponent(cat)}&` : '?'}before=${encodeURIComponent(nextCursor)}`}
                    className="text-[12px] text-slate-600 border border-slate-300 px-5 py-2 rounded-md hover:border-slate-500 transition"
                  >
                    다음 →
                  </Link>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div>
              {/* Freight index widget */}
              <aside className="bg-white rounded-xl border border-slate-200 p-3.5 mb-3.5">
                <h3 className="text-[11px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-2.5">
                  운임 지수
                </h3>
                <div className="flex flex-col gap-1.5">
                  {indices.map((idx) => (
                    <div key={idx.name} className="flex justify-between items-center">
                      <span className="text-[11px] text-slate-600 font-medium">{idx.name}</span>
                      <span className="text-[11px] text-slate-800">
                        {idx.value}
                        <span className={`ml-1 text-[10px] ${
                          idx.change_sign === 'up' ? 'text-emerald-600'
                          : idx.change_sign === 'down' ? 'text-red-500'
                          : 'text-slate-400'
                        }`}>
                          {idx.change_pct !== null && (idx.change_pct > 0 ? '+' : '')}
                          {idx.change_pct}%
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-2.5">업데이트 {lastUpdated}</p>
              </aside>

              <NewsletterCTA />
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </main>
  );
}
