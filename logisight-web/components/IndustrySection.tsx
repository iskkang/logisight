import Link from 'next/link';
import { Building, Bolt, Car, ShoppingCart, Snowflake, ArrowRight } from 'lucide-react';
import { MOCK_INDUSTRIES } from '@/lib/mock-data';

const ICONS = {
  'bolt':           { Icon: Bolt,         bg: 'bg-amber-50',    color: 'text-amber-800' },
  'car':            { Icon: Car,          bg: 'bg-blue-50',     color: 'text-navy-400' },
  'shopping-cart':  { Icon: ShoppingCart, bg: 'bg-pink-50',     color: 'text-rose-800' },
  'snowflake':      { Icon: Snowflake,    bg: 'bg-cyan-50',     color: 'text-cyan-800' },
} as const;

const TAG_MAP: Record<string, string> = {
  '배터리':     '배터리',
  '자동차·부품': '자동차',
  '이커머스':   '이커머스',
  '콜드체인':   '냉동',
};

export function IndustrySection() {
  return (
    <section className="bg-white border-t border-slate-200 px-5 py-6">
      <div className="max-w-page mx-auto">
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="text-sm lg:text-[17px] font-medium text-slate-800 flex items-center gap-1.5">
            <Building size={16} className="text-navy-400" />
            산업별 물류 인사이트
          </h2>
          <Link href="/industries" className="text-[11px] text-navy-400 font-medium hover:underline inline-flex items-center gap-0.5">
            전체 보기
            <ArrowRight size={11} />
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {MOCK_INDUSTRIES.map((industry) => {
            const config = ICONS[industry.icon as keyof typeof ICONS];
            const Icon = config.Icon;
            return (
              <Link
                key={industry.name}
                href={`/news?tag=${encodeURIComponent(TAG_MAP[industry.name] ?? industry.name)}`}
                className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-col gap-1.5 hover:bg-slate-100 transition cursor-pointer"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-1 ${config.bg}`}>
                  <Icon size={18} className={config.color} />
                </div>
                <div className="text-[13px] lg:text-[16px] font-medium text-slate-800">
                  {industry.name}
                </div>
                <div className="text-[11px] lg:text-[13px] text-slate-500 leading-relaxed keep-all">
                  {industry.stat}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
