import { Navigation } from '@/components/Navigation';
import { IndexBar } from '@/components/IndexBar';
import { Footer } from '@/components/Footer';
import { DelayChart } from '@/components/eurasia/DelayChart';
import {
  getLanesAll,
  getDelayHistory,
  getActiveDisruptions,
  getIndices,
  getLastUpdated,
} from '@/lib/supabase/queries';

export const revalidate = 0;

const STATUS_STYLE = {
  정상:    'bg-emerald-500/15 text-emerald-600',
  지연주의: 'bg-amber-500/15 text-amber-600',
  운휴:    'bg-red-500/15 text-red-500',
};

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-500',
  warning:  'bg-amber-500/15 text-amber-600',
  info:     'bg-blue-500/15 text-blue-500',
};

function laneStatus(onTimeRate: number | null): '정상' | '지연주의' | '운휴' {
  if (onTimeRate === null) return '정상';
  if (onTimeRate < 0.70) return '운휴';
  if (onTimeRate < 0.85) return '지연주의';
  return '정상';
}

export default async function EurasiaPage() {
  const [lanes, delayPoints, disruptions, indices, lastUpdated] = await Promise.all([
    getLanesAll(),
    getDelayHistory(),
    getActiveDisruptions(),
    getIndices(),
    getLastUpdated(),
  ]);

  return (
    <main className="min-h-screen">
      <Navigation />
      <IndexBar indices={indices} lastUpdated={lastUpdated} />

      <div className="bg-slate-50 px-4 lg:px-8 py-6 lg:py-10">
        <div className="max-w-page mx-auto">

          {/* Header */}
          <div className="flex items-center gap-2 mb-5">
            <h2 className="text-lg font-medium text-slate-800">유라시아 코리도어</h2>
            <span className="text-[10px] bg-cyan/15 text-cyan px-1.5 py-0.5 rounded font-medium">
              Logisight 전문
            </span>
          </div>

          {/* Section 1: Lanes table */}
          <section className="bg-white rounded-xl border border-slate-200 mb-5 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-[12px] font-medium text-slate-600 uppercase tracking-[0.06em]">
                한국발 유라시아 노선 현황
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-4 py-2.5 text-slate-500 font-medium">노선</th>
                    <th className="text-left px-4 py-2.5 text-slate-500 font-medium">경유지</th>
                    <th className="text-right px-4 py-2.5 text-slate-500 font-medium">소요일</th>
                    <th className="text-right px-4 py-2.5 text-slate-500 font-medium">정시율</th>
                    <th className="text-right px-4 py-2.5 text-slate-500 font-medium">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {lanes.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-6 text-slate-400">
                        데이터 없음
                      </td>
                    </tr>
                  ) : (
                    lanes.map((lane) => {
                      const status = laneStatus(lane.on_time_rate);
                      return (
                        <tr
                          key={lane.id}
                          className="border-b border-slate-50 hover:bg-slate-50 transition"
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-800">{lane.name_ko}</div>
                            {lane.is_featured && (
                              <span className="text-[9px] text-cyan">★ featured</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {lane.border_points.slice(0, 3).join(' → ')}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">
                            {lane.transit_min}–{lane.transit_max}일
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">
                            {lane.on_time_rate !== null
                              ? `${Math.round(lane.on_time_rate * 100)}%`
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLE[status]}`}>
                              {status}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 2: Delay chart */}
          <section className="bg-white rounded-xl border border-slate-200 mb-5 p-4">
            <div className="mb-3">
              <h3 className="text-[12px] font-medium text-slate-600 uppercase tracking-[0.06em]">
                노선별 정시율 추이
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">한국발 노선 주차별 on-time rate (%)</p>
            </div>
            <DelayChart points={delayPoints} />
          </section>

          {/* Section 3: Active disruptions */}
          <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-[12px] font-medium text-slate-600 uppercase tracking-[0.06em]">
                운항 이상 이벤트
              </h3>
            </div>
            {disruptions.length === 0 ? (
              <div className="px-4 py-6 text-center text-slate-400 text-sm">
                현재 활성 이벤트 없음
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {disruptions.map((ev) => (
                  <div key={ev.id} className="px-4 py-3 flex items-start gap-3">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0 ${SEVERITY_STYLE[ev.severity] ?? 'bg-slate-100 text-slate-500'}`}>
                      {ev.severity}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-slate-800 keep-all">
                        {ev.title_ko}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {ev.lane_id} · {ev.category} · {ev.started_at?.slice(0, 10)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      </div>

      <Footer />
    </main>
  );
}
