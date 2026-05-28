import { Navigation } from '@/components/Navigation';
import { IndexBar } from '@/components/IndexBar';
import { Footer } from '@/components/Footer';
import { DelayChart } from '@/components/eurasia/DelayChart';
import { CorridorMap } from '@/components/eurasia/CorridorMap';
import {
  getLanesAll,
  getDelayHistory,
  getActiveDisruptions,
  getIndices,
  getLastUpdated,
} from '@/lib/supabase/queries';
import { fetchTcrLive, aggregateTcr } from '@/lib/tcr-live';
import { Activity, Train, Truck, AlertTriangle } from 'lucide-react';

export const revalidate = 1800;  // 30분 캐시

// ── 목적지 한글 매핑 ──────────────────────────────────────────────────────────
const DEST_KO: Record<string, string> = {
  andijan: '안디잔', malaszewicze: '말라셰비체', almaty: '알마티',
  bishkek: '비슈케크', osh: '오쉬', tashkent: '타슈켄트', chukursay: '추쿠르사이',
};
function koName(dest: string): string {
  const key = Object.keys(DEST_KO).find(k => dest.toLowerCase().includes(k));
  return key ? DEST_KO[key] : dest;
}

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
  const [lanes, delayPoints, disruptions, indices, lastUpdated, tcrRaw] = await Promise.all([
    getLanesAll(),
    getDelayHistory(),
    getActiveDisruptions(),
    getIndices(),
    getLastUpdated(),
    fetchTcrLive(),
  ]);

  const tcr    = aggregateTcr(tcrRaw);
  const isLive = tcr.total > 0;

  // 목적지 막대 — 상위 5개
  const topDests = tcr.byDestination.slice(0, 5);
  const maxInTransit = Math.max(...topDests.map(d => d.inTransit), 1);

  // 구간별 상위 8개
  const topSegs = tcr.bySegment.slice(0, 8);

  // Rail/Truck 비율
  const modeTotal = tcr.byMode.Rail + tcr.byMode.Truck + tcr.byMode.other;
  const railPct   = modeTotal > 0 ? Math.round(tcr.byMode.Rail  / modeTotal * 100) : 0;
  const truckPct  = modeTotal > 0 ? Math.round(tcr.byMode.Truck / modeTotal * 100) : 0;

  const fetchedLabel = isLive
    ? `방금 업데이트 · ${new Date(tcr.fetchedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`
    : 'API 연결 대기 중';

  return (
    <main className="min-h-screen flex flex-col">
      <Navigation />
      <IndexBar indices={indices} lastUpdated={lastUpdated} />

      <div className="flex-1 bg-slate-50 px-4 lg:px-8 py-6 lg:py-10">
        <div className="max-w-page mx-auto">

          {/* Header */}
          <div className="flex items-center gap-2 mb-5">
            <h2 className="text-lg font-medium text-slate-800">유라시아 코리도어</h2>
            <span className="text-[10px] bg-cyan/15 text-cyan px-1.5 py-0.5 rounded font-medium">
              Logisight 전문
            </span>
          </div>

          {/* ── Live TCR Section ──────────────────────────────────────────── */}
          <section className="bg-white rounded-xl border border-slate-200 mb-5 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-[12px] font-medium text-slate-600 uppercase tracking-[0.06em] flex items-center gap-1.5">
                <Activity size={13} className="text-cyan" />
                라이브 운송 현황
              </h3>
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
                MTL Link 실시간 데이터 · {fetchedLabel}
              </span>
            </div>

            <div className="p-4">
              {/* 큰 숫자 카드 */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-[10px] text-blue-500 font-medium mb-1">운송중</div>
                  <div className="text-2xl lg:text-3xl font-medium text-blue-700">
                    {isLive ? tcr.inTransitCount : '—'}
                  </div>
                  <div className="text-[9px] text-blue-400 mt-0.5">컨테이너</div>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <div className="text-[10px] text-emerald-500 font-medium mb-1">도착</div>
                  <div className="text-2xl lg:text-3xl font-medium text-emerald-700">
                    {isLive ? tcr.arrivedCount : '—'}
                  </div>
                  <div className="text-[9px] text-emerald-400 mt-0.5">컨테이너</div>
                </div>
                <div className={`rounded-lg p-3 text-center ${tcr.alertCount > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
                  <div className={`text-[10px] font-medium mb-1 flex items-center justify-center gap-0.5 ${tcr.alertCount > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                    <AlertTriangle size={10} />
                    지연주의
                  </div>
                  <div className={`text-2xl lg:text-3xl font-medium ${tcr.alertCount > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                    {isLive ? tcr.alertCount : '—'}
                  </div>
                  <div className={`text-[9px] mt-0.5 ${tcr.alertCount > 0 ? 'text-red-400' : 'text-slate-300'}`}>컨테이너</div>
                </div>
              </div>

              {isLive && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* 왼쪽: 목적지별 막대 + 구간별 분포 */}
                  <div>
                    {/* 목적지별 운송중 */}
                    <div className="mb-4">
                      <div className="text-[11px] font-medium text-slate-500 mb-2 uppercase tracking-[0.06em]">
                        목적지별 운송중
                      </div>
                      <div className="space-y-1.5">
                        {topDests.map((d) => (
                          <div key={d.dest} className="flex items-center gap-2">
                            <div className="text-[11px] text-slate-600 w-20 flex-shrink-0 truncate">
                              {koName(d.dest)}
                            </div>
                            <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                              <div
                                className="h-2 rounded-full bg-blue-400 transition-all"
                                style={{ width: `${(d.inTransit / maxInTransit) * 100}%` }}
                              />
                            </div>
                            <div className="text-[11px] text-slate-500 w-6 text-right flex-shrink-0">
                              {d.inTransit}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 구간별 분포 */}
                    {topSegs.length > 0 && (
                      <div>
                        <div className="text-[11px] font-medium text-slate-500 mb-2 uppercase tracking-[0.06em]">
                          구간별 분포
                        </div>
                        <div className="space-y-1">
                          {topSegs.map((s) => (
                            <div key={s.segment} className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-600 truncate max-w-[180px]">{s.segment}</span>
                              <span className="text-slate-500 flex-shrink-0 ml-2">{s.count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 철도/트럭 비율 */}
                    {modeTotal > 0 && (
                      <div className="mt-4">
                        <div className="text-[11px] font-medium text-slate-500 mb-1.5 uppercase tracking-[0.06em]">
                          운송 수단
                        </div>
                        <div className="flex items-center gap-3 text-[11px]">
                          <Train size={12} className="text-slate-500 flex-shrink-0" />
                          <span className="text-slate-600">철도 {railPct}%</span>
                          <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div
                              className="h-2 rounded-full bg-orange-400"
                              style={{ width: `${railPct}%` }}
                            />
                          </div>
                          <Truck size={12} className="text-slate-500 flex-shrink-0" />
                          <span className="text-slate-600">트럭 {truckPct}%</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 오른쪽: 익명 위치 지도 */}
                  <div>
                    <div className="text-[11px] font-medium text-slate-500 mb-2 uppercase tracking-[0.06em]">
                      유라시아 회랑 익명 위치
                    </div>
                    <CorridorMap positions={tcr.anonymizedPositions} />
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ── Section 1: Lanes table ────────────────────────────────────── */}
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

          {/* ── Section 2: Delay chart ────────────────────────────────────── */}
          <section className="bg-white rounded-xl border border-slate-200 mb-5 p-4">
            <div className="mb-3">
              <h3 className="text-[12px] font-medium text-slate-600 uppercase tracking-[0.06em]">
                노선별 정시율 추이
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">한국발 노선 주차별 on-time rate (%)</p>
            </div>
            <DelayChart points={delayPoints} />
          </section>

          {/* ── Section 3: Active disruptions ────────────────────────────── */}
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
