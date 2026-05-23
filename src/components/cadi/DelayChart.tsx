import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import type { DelayRow } from '../../lib/api';

interface Props {
  rows: DelayRow[];
  milestone: string;
}

export default function DelayChart({ rows, milestone }: Props) {
  const { t } = useTranslation();

  const filtered = rows
    .filter(r => r.milestone === milestone)
    .sort((a, b) => a.week_iso.localeCompare(b.week_iso));

  if (filtered.length === 0) {
    return (
      <p className="text-slate-400 text-sm py-8 text-center">{t('cadi.noData')}</p>
    );
  }

  const medLabel = t('cadi.medianDelay');
  const p90Label = t('cadi.p90Delay');

  // Display in days; fall back to hours/24 if generated column not yet available
  const toDays = (r: DelayRow, field: 'median' | 'p90'): number | null => {
    if (field === 'median') return r.median_delay_d ?? (r.median_delay_h != null ? r.median_delay_h / 24 : null);
    return r.p90_delay_d ?? (r.p90_delay_h != null ? r.p90_delay_h / 24 : null);
  };

  const data = filtered.map(r => ({
    week: r.week_iso.replace(/^\d{4}-/, ''),  // show 'W20' not '2026-W20'
    [medLabel]: toDays(r, 'median') != null ? Math.round(toDays(r, 'median')! * 10) / 10 : null,
    [p90Label]: toDays(r, 'p90')   != null ? Math.round(toDays(r, 'p90')! * 10) / 10 : null,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="week" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} unit="d" />
        <Tooltip formatter={(v: number) => `${v >= 0 ? '+' : ''}${v}d`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line
          type="monotone"
          dataKey={medLabel}
          stroke="#0ea5e9"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey={p90Label}
          stroke="#f59e0b"
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
