import Link from 'next/link';
import { Brain, TrendingUp, Building2, Globe, Clock, ArrowRight } from 'lucide-react';
import type { WeeklyBriefingData } from '@/lib/supabase/queries';

const CATEGORY_ICON = {
  '시황':   TrendingUp,
  '기업':   Building2,
  '글로벌': Globe,
} as const;

function formatPublishedAt(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function WeeklyBriefing({ briefing }: { briefing: WeeklyBriefingData }) {
  return (
    <section className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-xl px-4 lg:px-7 py-4 lg:py-6 mb-5 overflow-hidden">
      <div className="inline-flex items-center gap-1.5 bg-navy-400 text-white text-[10px] font-medium px-2 py-0.5 rounded mb-2.5 tracking-[0.04em]">
        <Brain size={11} />
        AI 저널리스트 · 주간 인사이트
      </div>

      <h2 className="text-sm lg:text-[22px] font-medium text-navy-900 leading-snug mb-1.5">
        {briefing.title}
      </h2>
      {briefing.subtitle && (
        <div className="text-xs lg:text-sm text-navy-400/85 leading-relaxed mb-3.5">
          {briefing.subtitle}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-3.5">
        {briefing.points.map((point) => {
          const Icon = CATEGORY_ICON[point.category];
          return (
            <div
              key={point.category}
              className="bg-white/70 border border-blue-200 rounded-lg p-2.5 flex flex-col gap-0.5"
            >
              <div className="text-[10px] text-navy-400 font-medium uppercase tracking-[0.04em] flex items-center gap-1">
                <Icon size={11} />
                {point.category}
              </div>
              <div className="text-xs lg:text-[15px] text-navy-900 font-medium leading-snug keep-all">
                {point.headline}
              </div>
              <div className="text-[9px] text-navy-400/60 mt-0.5">
                by {point.agent}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-[11px] text-navy-400/70 flex items-center gap-1.5">
        <Clock size={11} />
        {formatPublishedAt(briefing.published_at)} 발행 · 매주 월요일
        <Link href="/news" className="ml-1 text-navy-400 font-medium hover:underline inline-flex items-center gap-0.5">
          전체 분석 읽기
          <ArrowRight size={11} />
        </Link>
      </div>
    </section>
  );
}
