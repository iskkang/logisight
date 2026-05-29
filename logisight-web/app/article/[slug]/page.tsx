import { notFound } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { Navigation } from '@/components/Navigation';
import { Footer } from '@/components/Footer';
import { getArticleBySlug } from '@/lib/supabase/queries';

export const revalidate = 3600;

const CATEGORY_COLOR: Record<string, string> = {
  해상: 'bg-blue-100  text-blue-700',
  항공: 'bg-purple-100 text-purple-700',
  철도: 'bg-amber-100  text-amber-700',
  물류: 'bg-emerald-100 text-emerald-700',
  무역: 'bg-rose-100   text-rose-700',
};

export default async function ArticlePage({
  params,
}: {
  params: { slug: string };
}) {
  const article = await getArticleBySlug(params.slug);
  if (!article) notFound();

  const catColor = CATEGORY_COLOR[article.category ?? ''] ?? 'bg-slate-100 text-slate-600';

  return (
    <main className="min-h-screen flex flex-col">
      <Navigation />

      <div className="flex-1 bg-slate-50 px-4 lg:px-8 py-8 lg:py-12">
        <div className="max-w-3xl mx-auto">
          {/* 메타 */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {article.category && (
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${catColor}`}>
                {article.category}
              </span>
            )}
            {article.source && (
              <span className="text-[11px] text-slate-500">{article.source}</span>
            )}
            <span className="text-[11px] text-slate-400 ml-auto">{article.published_at}</span>
          </div>

          {/* 제목 */}
          <h1 className="text-[22px] lg:text-[30px] font-semibold text-slate-900 leading-snug mb-3 keep-all">
            {article.title}
          </h1>

          {/* 요약 */}
          {article.summary && (
            <p className="text-[14px] lg:text-[16px] text-slate-600 leading-relaxed mb-5 keep-all border-l-4 border-cyan pl-4">
              {article.summary}
            </p>
          )}

          {/* 이미지 — 로드 실패 시 숨김 처리 */}
          {article.image_url && (
            <div className="mb-6 rounded-xl overflow-hidden">
              <img
                src={article.image_url}
                alt={article.title}
                className="w-full h-56 lg:h-72 object-cover"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            </div>
          )}

          {/* 본문 — content가 없으면 원문 링크만 표시 (placeholder 텍스트 없음) */}
          {article.content && article.content.length >= 200 ? (
            <div className="prose prose-slate max-w-none text-[14px] lg:text-[15px] leading-[1.85] keep-all">
              <ReactMarkdown>{article.content}</ReactMarkdown>
            </div>
          ) : article.source_url ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
              <a
                href={article.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-600 text-sm hover:underline"
              >
                원문 보기 →
              </a>
            </div>
          ) : null}

          {/* 태그 */}
          {article.tags && article.tags.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-6">
              {article.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/news?tag=${encodeURIComponent(tag)}`}
                  className="text-[11px] bg-slate-100 text-slate-600 hover:bg-slate-200 px-2 py-0.5 rounded transition"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          )}

          {/* 출처 + 목록 */}
          <div className="flex items-center justify-between mt-8 pt-5 border-t border-slate-200">
            {article.source_url ? (
              <a
                href={article.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-slate-500 hover:text-slate-700"
              >
                출처: {article.source ?? article.source_url}
              </a>
            ) : (
              <span className="text-[12px] text-slate-400">출처: Logisight</span>
            )}
            <Link
              href="/news"
              className="text-[12px] text-cyan-600 hover:text-cyan-700 font-medium"
            >
              ← 목록으로
            </Link>
          </div>
        </div>
      </div>

      <Footer />
    </main>
  );
}
