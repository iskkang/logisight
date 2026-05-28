'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Ship, Plane, Train, Truck, Factory, Newspaper, ArrowRight } from 'lucide-react';
import type { NewsArticle, NewsCategory } from '@/lib/types';

const TABS: ('전체' | NewsCategory)[] = ['전체', '해상', '항공', '철도', '물류', '무역'];

const CATEGORY_STYLE: Record<NewsCategory, { bg: string; text: string; icon: any; iconColor: string }> = {
  '해상': { bg: 'bg-blue-50',    text: 'text-navy-400',    icon: Ship,    iconColor: 'text-blue-400' },
  '항공': { bg: 'bg-emerald-50', text: 'text-emerald-800', icon: Plane,   iconColor: 'text-emerald-500' },
  '철도': { bg: 'bg-amber-50',   text: 'text-amber-800',   icon: Train,   iconColor: 'text-amber-500' },
  '물류': { bg: 'bg-rose-50',    text: 'text-rose-800',    icon: Truck,   iconColor: 'text-rose-400' },
  '무역': { bg: 'bg-violet-50',  text: 'text-violet-800',  icon: Factory, iconColor: 'text-violet-500' },
};

export function NewsFeed({
  heroNews,
  newsGrid,
}: {
  heroNews: NewsArticle;
  newsGrid: NewsArticle[];
}) {
  const [activeTab, setActiveTab] = useState<typeof TABS[number]>('전체');

  const filteredGrid = activeTab === '전체'
    ? newsGrid
    : newsGrid.filter((a) => a.category === activeTab);

  return (
    <section>
      <div className="flex items-center justify-between mb-3.5">
        <h2 className="text-sm lg:text-[17px] font-medium text-slate-800 flex items-center gap-1.5">
          <Newspaper size={16} className="text-navy-400" />
          오늘의 물류 뉴스
        </h2>
        <Link href="/news" className="text-[11px] text-navy-400 font-medium hover:underline inline-flex items-center gap-0.5">
          전체 보기
          <ArrowRight size={11} />
        </Link>
      </div>

      <div className="flex border-b border-slate-200 mb-3.5 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-xs lg:text-sm font-medium px-3 py-1.5 -mb-[1.5px] whitespace-nowrap border-b-2 ${
              activeTab === tab
                ? 'text-navy-400 border-navy-400'
                : 'text-slate-500 border-transparent hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <HeroArticle article={heroNews} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2.5">
        {filteredGrid.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </div>
    </section>
  );
}

function articleHref(article: NewsArticle): string {
  if (article.slug) return `/article/${article.slug}`;
  return article.source_url ?? '#';
}

function HeroArticle({ article }: { article: NewsArticle }) {
  const style = CATEGORY_STYLE[article.category];
  const Icon = style.icon;
  const href = articleHref(article);
  const isInternal = href.startsWith('/');
  return (
    <article className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col sm:flex-row">
      <div className="w-full h-40 sm:w-56 sm:min-h-[180px] bg-blue-100 flex items-center justify-center flex-shrink-0">
        <Icon size={36} className="text-blue-400" />
      </div>
      <div className="p-4 flex-1 min-w-0">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded inline-block mb-[7px] ${style.bg} ${style.text}`}>
          {article.category}
        </span>
        <h3 className="text-sm lg:text-[19px] font-medium text-slate-800 leading-snug mb-1.5 keep-all">
          {isInternal ? (
            <Link href={href} className="hover:text-cyan-600">{article.title}</Link>
          ) : (
            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-600">{article.title}</a>
          )}
        </h3>
        {article.summary && (
          <p className="text-xs lg:text-[14px] text-slate-500 leading-[1.7] mb-2 keep-all">
            {article.summary}
          </p>
        )}
        <div className="text-[10px] text-slate-400">
          {article.source_name} · {article.published_at}
          {article.agent_type && ` · journalist-${article.agent_type}`}
        </div>
      </div>
    </article>
  );
}

function ArticleCard({ article }: { article: NewsArticle }) {
  const style = CATEGORY_STYLE[article.category];
  const Icon = style.icon;
  const href = articleHref(article);
  const isInternal = href.startsWith('/');
  return (
    <article className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="h-[74px] bg-slate-100 flex items-center justify-center">
        <Icon size={24} className={style.iconColor} />
      </div>
      <div className="px-3 py-2.5">
        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded inline-block mb-[5px] ${style.bg} ${style.text}`}>
          {article.category}
        </span>
        <h4 className="text-xs lg:text-[15px] font-medium text-slate-800 leading-snug mb-0.5 keep-all">
          {isInternal ? (
            <Link href={href} className="hover:text-cyan-600">{article.title}</Link>
          ) : href !== '#' ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-600">{article.title}</a>
          ) : (
            <span>{article.title}</span>
          )}
        </h4>
        <div className="text-[10px] text-slate-400">
          {article.source_name} · {article.published_at?.slice(-2)}일
        </div>
      </div>
    </article>
  );
}
