import Link from 'next/link';
import { Brain, ArrowRight } from 'lucide-react';
import { MOCK_HERO_STATS } from '@/lib/mock-data';

export function Hero({ blankCount }: { blankCount?: string }) {
  const stats = MOCK_HERO_STATS.map((s) =>
    s.label === '블랭크' && blankCount ? { ...s, value: blankCount } : s
  );

  return (
    <section className="bg-gradient-to-b from-navy-900 to-navy-700 px-5 lg:px-8 py-8 lg:py-16">
      <div className="max-w-page mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 lg:gap-10">
        {/* 텍스트 영역 */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] lg:text-xs font-medium text-cyan uppercase tracking-[0.12em] mb-3">
            Logistics Intelligence Platform
          </div>
          <h1 className="text-[26px] lg:text-[44px] font-medium text-white leading-[1.2] -tracking-[0.6px] mb-3 keep-all">
            물류를 읽는<br />
            <span className="text-cyan">새로운 시선</span>
          </h1>
          <p className="text-sm lg:text-[17px] text-white/65 leading-[1.7] mb-[18px] max-w-md keep-all">
            운임 지수와 시장 뉴스, 정책 변화. 흩어진 정보를 매주 한 편의 분석으로 정리합니다.
          </p>
          <div className="flex gap-2">
            <Link href="/news" className="bg-cyan text-navy-900 text-xs lg:text-sm font-medium px-4 py-2 rounded-md flex items-center gap-1.5 hover:brightness-110 transition">
              <Brain size={14} />
              이번 주 분석 보기
            </Link>
            <Link href="/rates" className="bg-transparent text-white text-xs lg:text-sm font-medium px-4 py-2 rounded-md border border-white/25 flex items-center gap-1.5 hover:bg-white/5 transition">
              운임 대시보드
              <ArrowRight size={13} />
            </Link>
          </div>
        </div>

        {/* 통계 카드 2×2 그리드 */}
        <div className="grid grid-cols-2 gap-2 w-full lg:w-64 lg:flex-shrink-0">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2.5"
            >
              <div className="text-[9px] font-medium text-white/50 tracking-[0.06em] uppercase mb-1">
                {stat.label}
              </div>
              <div className="text-[18px] lg:text-[26px] font-medium text-white leading-tight">
                {stat.value}
              </div>
              <div className={`text-[10px] mt-0.5 ${
                stat.sign === 'up'   ? 'text-success' :
                stat.sign === 'down' ? 'text-danger'  :
                'text-white/40'
              }`}>
                {stat.change}
              </div>
              {'source' in stat && stat.source && (
                <div className="text-[9px] mt-0.5 text-white/25">{stat.source}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
