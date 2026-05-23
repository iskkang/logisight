import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type DisruptionEvent, type DelayRow } from '../lib/api';
import AlertCard from '../components/cadi/AlertCard';
import DataQualityBadge from '../components/cadi/DataQualityBadge';
import LoadingState from '../components/shared/LoadingState';
import EmptyState from '../components/shared/EmptyState';

export default function Home() {
  const { t } = useTranslation();
  const [alerts, setAlerts]     = useState<DisruptionEvent[]>([]);
  const [snapshot, setSnapshot] = useState<DelayRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.alerts(), api.weekly(undefined, 1)])
      .then(([a, w]) => { setAlerts(a); setSnapshot(w); })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState text={t('loading')} />;

  // Show only key milestones in snapshot
  const KEY_MILESTONES = ['ORIGIN_DEP', 'CN_BORDER', 'DEST_ARR'];
  const keyRows = snapshot.filter(r => KEY_MILESTONES.includes(r.milestone)).slice(0, 6);

  return (
    <main className="max-w-4xl mx-auto px-6 py-12">
      {/* Hero */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">{t('home.hero')}</h1>
        <p className="text-slate-500 max-w-2xl">{t('home.subtitle')}</p>
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {t('error')}: {error}
        </div>
      )}

      {/* Delay Snapshot */}
      {keyRows.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-slate-700 mb-4">{t('home.snapshotTitle')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {keyRows.map(row => (
              <div
                key={`${row.lane_id}-${row.milestone}`}
                className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {row.lane_id}
                  </span>
                  <DataQualityBadge quality={row.data_quality} sampleCount={row.sample_count} />
                </div>
                <p className="text-xs text-slate-400 mb-1">{row.milestone.replace(/_/g, ' ')}</p>
                <p className="text-2xl font-bold text-slate-900">
                  {row.median_delay_h != null ? `${row.median_delay_h}h` : '—'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  P90: {row.p90_delay_h != null ? `${row.p90_delay_h}h` : '—'} ·{' '}
                  정시율 {row.on_time_rate != null ? `${Math.round(row.on_time_rate * 100)}%` : '—'}
                </p>
              </div>
            ))}
          </div>
          <Link
            to="/cadi"
            className="mt-4 inline-block text-sky-600 hover:text-sky-700 text-sm font-medium"
          >
            {t('home.viewDashboard')} →
          </Link>
        </section>
      )}

      {/* Alerts */}
      <section>
        <h2 className="text-lg font-semibold text-slate-700 mb-4">{t('home.latestAlerts')}</h2>
        {alerts.length === 0 ? (
          <EmptyState message={t('home.noAlerts')} />
        ) : (
          <div className="flex flex-col gap-3">
            {alerts.slice(0, 3).map(a => (
              <AlertCard key={a.id} event={a} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
