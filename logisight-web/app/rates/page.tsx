import Link from 'next/link';
import { Navigation } from '@/components/Navigation';
import { IndexBar } from '@/components/IndexBar';
import { Footer } from '@/components/Footer';
import {
  getRatesAll,
  getIndices,
  getLastUpdated,
} from '@/lib/supabase/queries';
import type { FreightRateRow } from '@/lib/supabase/queries';

export const revalidate = 0;

// 출발지 필터 옵션
const POL_OPTIONS = [
  { label: '전체', value: '' },
  { label: '부산', value: 'KRPUS' },
  { label: '인천', value: 'KRINC' },
];

// 컨테이너 타입 필터 옵션
const TYPE_OPTIONS = [
  { label: '전체', value: '' },
  { label: '20DRY', value: '20DRY' },
  { label: '40DRY', value: '40DRY' },
  { label: '40HC', value: '40HC' },
];

function buildHref(pol: string, type: string) {
  const params = new URLSearchParams();
  if (pol) params.set('pol', pol);
  if (type) params.set('type', type);
  const qs = params.toString();
  return `/rates${qs ? `?${qs}` : ''}`;
}

function ChangeCell({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-slate-400">—</span>;
  const isUp = pct > 0;
  const isDown = pct < 0;
  return (
    <span className={isUp ? 'text-emerald-600' : isDown ? 'text-red-500' : 'text-slate-400'}>
      {isUp ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

function RatesTable({ rows }: { rows: FreightRateRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
        <div className="text-slate-400 text-sm mb-1">데이터 수집 중입니다.</div>
        <div className="text-slate-400 text-xs">해양수산부 공표 운임은 매주 업데이트됩니다.</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-slate-500 font-medium whitespace-nowrap">출발지 → 도착지</th>
              <th className="text-left px-4 py-3 text-slate-500 font-medium">컨테이너</th>
              <th className="text-right px-4 py-3 text-slate-500 font-medium">운임(USD)</th>
              <th className="text-right px-4 py-3 text-slate-500 font-medium">주간변동</th>
              <th className="text-left px-4 py-3 text-slate-500 font-medium hidden md:table-cell">선사</th>
              <th className="text-left px-4 py-3 text-slate-500 font-medium hidden lg:table-cell">출처</th>
              <th className="text-right px-4 py-3 text-slate-500 font-medium hidden lg:table-cell">기준일</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50 transition">
                <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                  {row.pol_name} → {row.pod_name}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                    {row.container_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">
                  {row.rate_usd !== null ? `$${row.rate_usd.toLocaleString()}` : '—'}
                </td>
                <td className="px-4 py-3 text-right text-[12px]">
                  <ChangeCell pct={row.weekly_change_pct} />
                </td>
                <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                  {row.carrier ?? '—'}
                </td>
                <td className="px-4 py-3 text-slate-400 hidden lg:table-cell text-[11px]">
                  {row.data_source}
                </td>
                <td className="px-4 py-3 text-right text-slate-400 hidden lg:table-cell text-[11px]">
                  {row.valid_from ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function RatesPage({
  searchParams,
}: {
  searchParams: { pol?: string; type?: string };
}) {
  const pol = POL_OPTIONS.some((o) => o.value === searchParams.pol) ? searchParams.pol : '';
  const type = TYPE_OPTIONS.some((o) => o.value === searchParams.type) ? searchParams.type : '';

  const [rates, indices, lastUpdated] = await Promise.all([
    getRatesAll({ pol, type }),
    getIndices(),
    getLastUpdated(),
  ]);

  return (
    <main className="min-h-screen">
      <Navigation />
      <IndexBar indices={indices} lastUpdated={lastUpdated} />

      <div className="bg-slate-50 px-5 py-6">
        <div className="max-w-page mx-auto">

          {/* Page header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-slate-800">화물운임 대시보드</h2>
            <span className="text-[11px] text-slate-400">업데이트 {lastUpdated}</span>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-4 mb-5">
            {/* POL filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 mr-1">출발지</span>
              {POL_OPTIONS.map((opt) => (
                <Link
                  key={opt.value}
                  href={buildHref(opt.value, type ?? '')}
                  className={`text-[11px] px-3 py-1 rounded-full border transition ${
                    (pol ?? '') === opt.value
                      ? 'bg-navy-900 text-white border-navy-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {opt.label}
                </Link>
              ))}
            </div>

            {/* Container type filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 mr-1">컨테이너</span>
              {TYPE_OPTIONS.map((opt) => (
                <Link
                  key={opt.value}
                  href={buildHref(pol ?? '', opt.value)}
                  className={`text-[11px] px-3 py-1 rounded-full border transition ${
                    (type ?? '') === opt.value
                      ? 'bg-navy-900 text-white border-navy-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {opt.label}
                </Link>
              ))}
            </div>
          </div>

          {/* 2-column layout */}
          <div className="grid grid-cols-[1fr_300px] gap-5">
            {/* Left: rates table */}
            <RatesTable rows={rates} />

            {/* Right: index cards */}
            <div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-[11px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-3">
                  글로벌 운임 지수
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {indices.map((idx) => (
                    <div
                      key={idx.name}
                      className="bg-slate-50 rounded-lg px-3 py-2.5"
                    >
                      <div className="text-[9px] font-medium text-slate-400 uppercase tracking-[0.06em] mb-1">
                        {idx.name}
                      </div>
                      <div className="text-[15px] font-medium text-slate-800 leading-tight">
                        {idx.value}
                      </div>
                      <div className={`text-[10px] mt-0.5 ${
                        idx.change_sign === 'up'   ? 'text-emerald-600' :
                        idx.change_sign === 'down' ? 'text-red-500'     :
                        'text-slate-400'
                      }`}>
                        {idx.change_pct !== null && (idx.change_pct > 0 ? '+' : '')}
                        {idx.change_pct}%
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-3">
                  SCFI · WCI · FBX · KCCI · BAI · VLSFO 기준
                </p>
              </div>

              {/* Data source note */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 mt-3">
                <h4 className="text-[11px] font-medium text-slate-500 mb-2">데이터 출처</h4>
                <ul className="text-[11px] text-slate-500 space-y-1">
                  <li>• 해양수산부 컨테이너 화물운임 공표정보 (data.go.kr)</li>
                  <li>• 공표 운임은 매주 갱신됩니다</li>
                  <li>• 실제 적용 운임은 선사·포워더와 확인하세요</li>
                </ul>
              </div>
            </div>
          </div>

        </div>
      </div>

      <Footer />
    </main>
  );
}
