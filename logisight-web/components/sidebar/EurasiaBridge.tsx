import { Route } from 'lucide-react';
import type { RailRoute } from '@/lib/types';

export function EurasiaBridge({ routes }: { routes: RailRoute[] }) {
  return (
    <aside className="bg-navy-900 rounded-xl lg:rounded-2xl p-3.5 lg:p-5 mb-3.5 relative overflow-hidden">
      <div className="absolute -right-8 -top-8 w-32 h-32 bg-cyan/10 rounded-full blur-2xl pointer-events-none" />

      <div className="flex items-center justify-between mb-2.5 relative">
        <h3 className="text-[11px] lg:text-[15px] font-medium text-cyan tracking-[0.06em] uppercase flex items-center gap-1.5">
          <Route size={13} />
          유라시아 코리도어
        </h3>
        <span className="text-[9px] bg-cyan/15 text-cyan px-1.5 py-0.5 rounded font-medium">
          Logisight 전문
        </span>
      </div>

      <div className="relative">
        {routes.map((route, i, arr) => (
          <div
            key={`${route.origin}-${route.destination}`}
            className={`flex justify-between items-center py-1.5 ${
              i < arr.length - 1 ? 'border-b border-white/10' : ''
            }`}
          >
            <div>
              <div className="text-[11px] lg:text-sm text-white font-medium">
                {route.origin} → {route.destination}
              </div>
              <div className="text-[10px] lg:text-[11px] text-white/50 mt-0.5">
                {route.route_type} · {route.via}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[13px] lg:text-[15px] font-medium text-white">
                {route.transit_days}일
              </div>
              <span className={`text-[9px] px-1.5 py-0.5 rounded inline-block mt-0.5 ${
                route.status === '정상'
                  ? 'bg-success/15 text-success'
                  : route.status === '지연주의'
                  ? 'bg-warning/15 text-warning'
                  : 'bg-danger/15 text-danger'
              }`}>
                {route.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
