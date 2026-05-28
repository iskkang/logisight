'use client';

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
import type { DelayPoint } from '@/lib/supabase/queries';

const LANE_COLORS: Record<string, string> = {
  'KR-ANDIJAN':      '#06b6d4',
  'KR-ALMATY':       '#a78bfa',
  'KR-BISHKEK':      '#34d399',
  'KR-OSH':          '#fb923c',
  'KR-CHUKURSAY':    '#f472b6',
  'KR-MALASZEWICZE': '#facc15',
};

function buildChartData(points: DelayPoint[]) {
  const weeks = [...new Set(points.map((p) => p.week_iso))].sort();
  const lanes = [...new Set(points.map((p) => p.lane_id))];

  const byWeekLane = new Map<string, number>();
  for (const p of points) {
    byWeekLane.set(`${p.week_iso}::${p.lane_id}`, p.on_time_rate);
  }

  return {
    data: weeks.map((week) => {
      const row: Record<string, string | number> = { week };
      for (const lane of lanes) {
        const val = byWeekLane.get(`${week}::${lane}`);
        if (val !== undefined) row[lane] = Math.round(val * 100);
      }
      return row;
    }),
    lanes,
  };
}

export function DelayChart({ points }: { points: DelayPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
        차트 데이터 없음
      </div>
    );
  }

  const { data, lanes } = buildChartData(points);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="week"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          formatter={(value: number) => [`${value}%`, undefined]}
          labelStyle={{ fontSize: 11, color: '#334155' }}
          contentStyle={{ fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 6 }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
        />
        {lanes.map((lane) => (
          <Line
            key={lane}
            type="monotone"
            dataKey={lane}
            stroke={LANE_COLORS[lane] ?? '#94a3b8'}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
