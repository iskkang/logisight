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

  const data = filtered.map(r => ({
    week: r.week_iso.replace(/^\d{4}-/, ''),  // show 'W20' not '2026-W20'
    [medLabel]: r.median_delay_h,
    [p90Label]: r.p90_delay_h,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="week" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} unit="h" />
        <Tooltip formatter={(v: number) => `${v}h`} />
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
