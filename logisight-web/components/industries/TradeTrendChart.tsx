'use client';

import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

interface TrendPoint {
  period: string;       // 'YYYYMM'
  export_usd: number | null;
  import_usd: number | null;
}

interface Props {
  data: TrendPoint[];
}

function formatPeriod(p: string): string {
  // '202601' → '26/01',  '2026-01' → '26/01'
  const s = p.replace('-', '');
  return `${s.slice(2, 4)}/${s.slice(4, 6)}`;
}

function toMillionUsd(v: number | null): number | null {
  return v != null ? Math.round(v / 1_000_000) : null;
}

export function TradeTrendChart({ data }: Props) {
  if (!data.length) return null;

  const chartData = data.map((d) => ({
    period: formatPeriod(d.period),
    수출: toMillionUsd(d.export_usd),
    수입: toMillionUsd(d.import_usd),
  }));

  return (
    <ResponsiveContainer width="100%" height={110}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
        <XAxis dataKey="period" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} unit="M" />
        <Tooltip
          formatter={(v: number) => [`$${v}M`, '']}
          contentStyle={{ fontSize: 11 }}
        />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
        <Line
          type="monotone" dataKey="수출"
          stroke="#0891b2" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }}
        />
        <Line
          type="monotone" dataKey="수입"
          stroke="#f59e0b" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
