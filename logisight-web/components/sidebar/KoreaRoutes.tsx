import { LineChart, ShieldCheck } from 'lucide-react';
import type { KoreaRouteData } from '@/lib/supabase/queries';

export function KoreaRoutes({ routes }: { routes: KoreaRouteData[] }) {
  return (
    <aside className="bg-white border border-slate-200 rounded-xl p-3.5 mb-3.5">
      <div className="flex items-center mb-2.5">
        <h3 className="text-xs font-medium text-slate-800 flex items-center gap-1.5">
          <LineChart size={14} className="text-navy-400" />
          한국발 주요 노선
        </h3>
      </div>

      <div>
        {routes.map((route, i, arr) => (
          <div
            key={`${route.pol_name}-${route.pod_name}`}
            className={`flex justify-between items-center py-1.5 ${
              i < arr.length - 1 ? 'border-b border-slate-100' : ''
            }`}
          >
            <span className="text-xs text-slate-800">
              {route.pol_name} → {route.pod_name}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-800">
                ${route.rate_usd.toLocaleString()}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                route.change_pct > 0
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'bg-rose-50 text-rose-800'
              }`}>
                {route.change_pct > 0 ? '+' : ''}{route.change_pct}%
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="inline-flex items-center gap-1 text-[9px] text-navy-400 bg-blue-50 px-1.5 py-0.5 rounded mt-2">
        <ShieldCheck size={10} />
        출처: 해양수산부 화물운임공표정보
      </div>
    </aside>
  );
}
