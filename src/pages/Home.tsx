import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type DisruptionEvent, type DelayRow } from '../lib/api';
import AlertCard from '../components/cadi/AlertCard';
import DataQualityBadge from '../components/cadi/DataQualityBadge';
import LoadingState from '../components/shared/LoadingState';

// Key milestones to show on home snapshot widget
const KEY_MILESTONES = ['CN_BORDER', 'DEST_ARR'] as const;

// Convert hours to days string (±X.Xd)
function fmtDays(hours: number | null, days?: number | null): string {
  if (days != null) return `${days >= 0 ? '+' : ''}${days.toFixed(1)}d`;
  if (hours != null) {
    const d = hours / 24;
    return `${d >= 0 ? '+' : ''}${d.toFixed(1)}d`;
  }
  return '—';
}

export default function Home() {
  const { t } = useTranslation();
  const [alerts, setAlerts]     = useState<DisruptionEvent[]>([]);
  const [snapshot, setSnapshot] = useState<DelayRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.alerts(),                        // active alerts (all lanes)
      api.weekly('KR-ANDIJAN', 1),         // flagship lane, latest week only
    ])
      .then(([a, w]) => { setAlerts(a); setSnapshot(w); })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState text={t('loading')} />;

  const keyRows = snapshot.filter(r => KEY_MILESTONES.includes(r.milestone as typeof KEY_MILESTONES[number]));

  return (
    <main className="max-w-4xl mx-auto px-6 py-12">
      {/* Hero */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">{t('home.hero', 'Central Asia Logistics Intelligence')}</h1>
        <p className="text-slate-500 max-w-2xl leading-relaxed">
          {t('home.subtitle', 'Real delay data and disruption alerts for Korea/China → Central Asia routes — powered by MTL\'s live tracking and field network.')}
        </p>
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {t('error')}: {error}
        </div>
      )}

      {/* ① CADI Delay Snapshot */}
      {keyRows.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-700">
              {t('home.snapshotTitle', 'This Week — KR-ANDIJAN Delay')}
            </h2>
            <Link to="/intelligence/cadi" className="text-xs text-sky-600 hover:text-sky-700 font-medium">
              {t('home.viewDashboard', 'Full Dashboard →')}
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {keyRows.map(row => (
              <div
                key={`${row.lane_id}-${row.milestone}`}
                className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {row.lane_id} · {row.milestone.replace(/_/g, ' ')}
                  </span>
                  <DataQualityBadge quality={row.data_quality} sampleCount={row.sample_count} />
                </div>
                <p className="text-3xl font-bold text-slate-900">
                  {fmtDays(row.median_delay_h, row.median_delay_d)}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  P90 {fmtDays(row.p90_delay_h, row.p90_delay_d)} ·{' '}
                  OTP {row.on_time_rate != null ? `${Math.round(row.on_time_rate * 100)}%` : '—'} ·{' '}
                  n={row.sample_count}
                </p>
                <p className="text-xs text-slate-300 mt-1">
                  MTL-handled shipments · {row.week_iso}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ② Disruption Alerts (top 3) */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-700">
            {t('home.latestAlerts', 'Disruption Alerts')}
          </h2>
          <Link to="/news" className="text-xs text-sky-600 hover:text-sky-700 font-medium">
            {t('home.viewAll', 'View all →')}
          </Link>
        </div>
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-400 py-4">
            {t('home.noAlerts', 'No active disruption alerts.')}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {alerts.slice(0, 3).map(a => (
              <AlertCard key={a.id} event={a} />
            ))}
          </div>
        )}
      </section>

      {/* ③ Subscribe CTA */}
      <section className="bg-slate-900 rounded-2xl px-8 py-8 text-center">
        <h2 className="text-xl font-bold text-white mb-2">
          {t('subscribe.cta', 'Get the Weekly CADI Briefing')}
        </h2>
        <p className="text-slate-300 text-sm mb-6 max-w-md mx-auto">
          {t('subscribe.desc', 'Delay data, disruption alerts, and analysis for Central Asia routes — every week.')}
        </p>
        <Link
          to="/subscribe"
          className="inline-block px-6 py-2.5 bg-sky-500 text-white rounded-lg text-sm font-medium hover:bg-sky-400 transition-colors"
        >
          {t('subscribe.button', 'Subscribe free →')}
        </Link>
      </section>
    </main>
  );
}
