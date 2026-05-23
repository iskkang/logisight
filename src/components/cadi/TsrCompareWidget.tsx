import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type DelayRow } from '../../lib/api';
import DataQualityBadge from './DataQualityBadge';
import LoadingState from '../shared/LoadingState';

function latestDestArr(rows: DelayRow[]): DelayRow | null {
  const destRows = rows.filter(r => r.milestone === 'DEST_ARR');
  if (destRows.length === 0) return null;
  return destRows.reduce((best, r) => (r.week_iso > best.week_iso ? r : best));
}

function formatDelay(row: DelayRow): string {
  const d = row.median_delay_d ?? (row.median_delay_h != null ? row.median_delay_h / 24 : null);
  if (d == null) return '—';
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}d`;
}

function formatP90(row: DelayRow): string {
  const d = row.p90_delay_d ?? (row.p90_delay_h != null ? row.p90_delay_h / 24 : null);
  if (d == null) return '—';
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}d`;
}

interface LaneCardProps {
  label: string;
  badge: string;
  accentClass: string;
  row: DelayRow | null;
  noDataText: string;
}

function LaneCard({ label, badge, accentClass, row, noDataText }: LaneCardProps) {
  return (
    <div className={`flex-1 rounded-lg border-2 ${accentClass} bg-white p-4`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${accentClass.replace('border-', 'bg-').replace('-400', '-100').replace('-500', '-100')} text-slate-700`}>
          {badge}
        </span>
      </div>
      {row == null ? (
        <p className="text-sm text-slate-400">{noDataText}</p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{formatDelay(row)}</span>
            <span className="text-xs text-slate-400">median</span>
          </div>
          <div className="text-sm text-slate-500">
            P90: <span className="font-medium text-slate-700">{formatP90(row)}</span>
          </div>
          <div className="text-sm text-slate-500">
            OTP: <span className="font-medium text-slate-700">
              {row.otp_pct != null
                ? `${row.otp_pct.toFixed(0)}%`
                : row.on_time_rate != null
                  ? `${(row.on_time_rate * 100).toFixed(0)}%`
                  : '—'}
            </span>
          </div>
          <div className="text-xs text-slate-400">n={row.sample_count} · {row.week_iso}</div>
          <DataQualityBadge quality={row.data_quality} sampleCount={row.sample_count} />
        </div>
      )}
    </div>
  );
}

export default function TsrCompareWidget() {
  const { t } = useTranslation();
  const [tcrRow, setTcrRow] = useState<DelayRow | null>(null);
  const [tsrRow, setTsrRow] = useState<DelayRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.weekly('KR-ANDIJAN', 2),
      api.weekly('KR-CHUKURSAY', 2),
    ])
      .then(([tcrRows, tsrRows]) => {
        setTcrRow(latestDestArr(tcrRows));
        setTsrRow(latestDestArr(tsrRows));
      })
      .catch(() => {
        // On error leave both null — widget will return null (both empty)
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (tcrRow == null && tsrRow == null) return null;

  const noData = t('cadi.compare.noData');

  return (
    <div className="mt-6 bg-slate-50 rounded-xl border border-slate-200 p-4">
      <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('cadi.compare.title')}</h2>
      <div className="flex flex-col sm:flex-row gap-3">
        <LaneCard
          label="KR-ANDIJAN"
          badge={t('cadi.compare.tcr')}
          accentClass="border-sky-400"
          row={tcrRow}
          noDataText={noData}
        />
        <LaneCard
          label="KR-CHUKURSAY"
          badge={t('cadi.compare.tsr')}
          accentClass="border-purple-400"
          row={tsrRow}
          noDataText={noData}
        />
      </div>
    </div>
  );
}
