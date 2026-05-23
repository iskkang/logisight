import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type DisruptionEvent } from '../lib/api';
import AlertCard from '../components/cadi/AlertCard';
import LoadingState from '../components/shared/LoadingState';
import EmptyState from '../components/shared/EmptyState';

// Filter tabs
const TABS = ['All', 'Active', 'Resolved'] as const;
type Tab = typeof TABS[number];

export default function NewsAnalysis() {
  const { t } = useTranslation();
  const [alerts, setAlerts]   = useState<DisruptionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [tab, setTab]         = useState<Tab>('Active');

  useEffect(() => {
    // Fetch all alerts (no lane_id filter) — page shows everything
    api.alerts()
      .then(a => setAlerts(a))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = alerts.filter(a => {
    if (tab === 'Active')   return !a.resolved_at;
    if (tab === 'Resolved') return !!a.resolved_at;
    return true;
  });

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">
          {t('news.title', 'Disruption Alerts & Analysis')}
        </h1>
        <p className="text-sm text-slate-500">
          {t('news.subtitle', 'Real-time intelligence on Central Asia route disruptions — based on MTL field reports and live tracking data.')}
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-slate-200 pb-0">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-sky-500 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState text={t('loading')} />
      ) : filtered.length === 0 ? (
        <EmptyState message={t('home.noAlerts', 'No alerts in this category.')} />
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map(a => <AlertCard key={a.id} event={a} />)}
        </div>
      )}

      {/* Methodology note */}
      <div className="mt-10 pt-6 border-t border-slate-200">
        <p className="text-xs text-slate-400 leading-relaxed">
          All disruption data is based on MTL Shipping Agency's live tracking (proprietary, n-verified) and field reports.
          Individual shipment details are never disclosed — only aggregated impact estimates.{' '}
          <a href="/methodology" className="text-sky-500 hover:underline">Methodology →</a>
        </p>
      </div>
    </main>
  );
}
