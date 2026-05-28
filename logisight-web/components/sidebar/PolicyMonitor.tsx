import { Shield } from 'lucide-react';
import type { PolicyAlert } from '@/lib/types';

const TAG_STYLE: Record<PolicyAlert['code'], string> = {
  'CBAM':       'bg-amber-100 text-amber-800',
  'EU ETS':     'bg-blue-100 text-blue-800',
  '제재':       'bg-rose-100 text-rose-800',
  'EAR':        'bg-slate-100 text-slate-700',
  '전략물자':   'bg-purple-100 text-purple-800',
};

export function PolicyMonitor({ alerts }: { alerts: PolicyAlert[] }) {
  return (
    <aside className="bg-white border border-slate-200 rounded-xl p-3.5 mb-3.5">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-xs font-medium text-slate-800 flex items-center gap-1.5">
          <Shield size={14} className="text-navy-400" />
          정책·규제 모니터
        </h3>
        <a href="#" className="text-[10px] text-navy-400 font-medium hover:underline">더보기</a>
      </div>

      <div>
        {alerts.map((policy, i, arr) => (
          <div
            key={policy.code + i}
            className={`flex items-start gap-2 py-2 ${
              i < arr.length - 1 ? 'border-b border-slate-100' : ''
            }`}
          >
            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5 ${TAG_STYLE[policy.code]}`}>
              {policy.code}
            </span>
            <div className="min-w-0">
              <div className="text-[11px] text-slate-800 leading-snug keep-all">
                {policy.title}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {policy.meta}
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
