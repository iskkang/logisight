import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Lane, type DelayRow, type DisruptionEvent } from '../lib/api';
import LaneSelector from '../components/cadi/LaneSelector';
import DelayChart from '../components/cadi/DelayChart';
import DataQualityBadge from '../components/cadi/DataQualityBadge';
import AlertCard from '../components/cadi/AlertCard';
import LoadingState from '../components/shared/LoadingState';
import EmptyState from '../components/shared/EmptyState';

// Key milestones to chart (subset for readability)
const CHART_MILESTONES = [
  'ORIGIN_DEP',
  'RAIL_DEP_CN',
  'KASHI_ARR',
  'CN_BORDER',
  'KG_UZ_BORDER',
  'DEST_ARR',
] as const;

export default function CadiDashboard() {
  const { t } = useTranslation();
  const [lanes, setLanes]             = useState<Lane[]>([]);
  const [selectedLane, setSelectedLane] = useState('TCR');
  const [rows, setRows]               = useState<DelayRow[]>([]);
  const [alerts, setAlerts]           = useState<DisruptionEvent[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  // Load lane list once
  useEffect(() => {
    api.lanes()
      .then(l => { setLanes(l); if (l.length > 0) setSelectedLane(l[0].id); })
      .catch(e => setError((e as Error).message));
  }, []);

  // Load data whenever lane changes
  useEffect(() => {
    setLoading(true);
    Promise.all([api.weekly(selectedLane, 8), api.alerts(selectedLane)])
      .then(([w, a]) => { setRows(w); setAlerts(a); })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [selectedLane]);

  // Latest row per milestone (most recent week)
  const latestByMilestone = new Map<string, DelayRow>();
  for (const r of rows) {
    const existing = latestByMilestone.get(r.milestone);
    if (!existing || r.week_iso > existing.week_iso) {
      latestByMilestone.set(r.milestone, r);
    }
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">{t('cadi.title')}</h1>
        <p className="text-sm text-slate-500">
          MTL-handled shipments, n=표본수 · 신뢰도 뱃지 확인 필수
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {t('error')}: {error}
        </div>
      )}

      <LaneSelector lanes={lanes} selected={selectedLane} onChange={setSelectedLane} />

      {loading ? (
        <LoadingState text={t('loading')} />
      ) : rows.length === 0 ? (
        <div className="mt-8">
          <EmptyState message={t('cadi.noData')} />
        </div>
      ) : (
        <>
          {/* Latest weekly verdict summary */}
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {CHART_MILESTONES.map(ms => {
              const latest = latestByMilestone.get(ms);
              if (!latest) return null;
              return (
                <div key={ms} className="bg-white rounded-lg border border-slate-200 p-3">
                  <p className="text-xs text-slate-400 mb-1">{ms.replace(/_/g, ' ')}</p>
                  <p className="text-xl font-bold text-slate-900">
                    {latest.median_delay_d != null
                      ? `${latest.median_delay_d >= 0 ? '+' : ''}${latest.median_delay_d.toFixed(1)}d`
                      : latest.median_delay_h != null
                        ? `${(latest.median_delay_h / 24) >= 0 ? '+' : ''}${(latest.median_delay_h / 24).toFixed(1)}d`
                        : '—'}
                  </p>
                  <div className="mt-1">
                    <DataQualityBadge quality={latest.data_quality} sampleCount={latest.sample_count} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Trend charts */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            {CHART_MILESTONES.map(ms => (
              <div key={ms} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-700">
                    {ms.replace(/_/g, ' ')}
                  </h3>
                  {latestByMilestone.get(ms) && (
                    <DataQualityBadge
                      quality={latestByMilestone.get(ms)!.data_quality}
                      sampleCount={latestByMilestone.get(ms)!.sample_count}
                    />
                  )}
                </div>
                <DelayChart rows={rows} milestone={ms} />
              </div>
            ))}
          </div>

          {/* Disruption alerts */}
          {alerts.length > 0 && (
            <section className="mt-10">
              <h2 className="text-lg font-semibold text-slate-700 mb-3">
                {t('cadi.disruptionTitle')}
              </h2>
              <div className="flex flex-col gap-3">
                {alerts.map(a => <AlertCard key={a.id} event={a} />)}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
