'use client';

import type { AnonPosition } from '@/lib/tcr-live';

// 지도 경계 (서경 → 동경 20~131°, 북위 34~56°)
const MIN_LNG = 20, MAX_LNG = 131, MIN_LAT = 34, MAX_LAT = 56;
const W = 600, H = 180;

function project(lat: number, lng: number): [number, number] {
  const x = ((lng - MIN_LNG) / (MAX_LNG - MIN_LNG)) * W;
  const y = ((MAX_LAT - lat) / (MAX_LAT - MIN_LAT)) * H;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

const HUBS = [
  { name: '인천', lat: 37.5, lng: 126.8, anchor: 'start' as const },
  { name: '칭다오', lat: 36.1, lng: 120.4, anchor: 'start' as const },
  { name: '카슈가르', lat: 39.5, lng: 76.0, anchor: 'middle' as const },
  { name: '알마티', lat: 43.3, lng: 77.0, anchor: 'start' as const },
  { name: '도스틱', lat: 45.3, lng: 82.0, anchor: 'start' as const },
  { name: '말라셰비체', lat: 52.0, lng: 23.5, anchor: 'start' as const },
];

// 회랑 경로 (위도, 경도 순서 waypoints)
const CORRIDORS: { name: string; color: string; points: [number, number][] }[] = [
  {
    name: '해상',
    color: '#3b82f6',
    points: [[37.5, 126.8], [36.1, 120.4]],
  },
  {
    name: '카시 회랑',
    color: '#f97316',
    points: [[36.1, 120.4], [34.3, 108.9], [39.5, 76.0], [40.8, 72.4]],
  },
  {
    name: '코르고스 회랑',
    color: '#8b5cf6',
    points: [[36.1, 120.4], [43.8, 87.6], [43.3, 77.0]],
  },
  {
    name: '북방 회랑',
    color: '#6b7280',
    points: [[36.1, 120.4], [45.3, 82.0], [52.0, 23.5]],
  },
];

const SIGNAL_COLOR: Record<string, string> = {
  blue:  '#3b82f6',
  green: '#22c55e',
  red:   '#ef4444',
};

export function CorridorMap({ positions }: { positions: AnonPosition[] }) {
  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        style={{ background: '#f8fafc', borderRadius: 8 }}
        aria-label="유라시아 코리도어 익명 화물 위치 지도 (개별 고객·번호 미포함)"
      >
        {/* 회랑 경로 */}
        {CORRIDORS.map((c) => {
          const pts = c.points.map(([lat, lng]) => project(lat, lng).join(',')).join(' ');
          return (
            <polyline
              key={c.name}
              points={pts}
              fill="none"
              stroke={c.color}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              opacity={0.5}
            />
          );
        })}

        {/* 허브 */}
        {HUBS.map((h) => {
          const [x, y] = project(h.lat, h.lng);
          return (
            <g key={h.name}>
              <circle cx={x} cy={y} r={3.5} fill="#1e293b" opacity={0.75} />
              <text
                x={x + (h.anchor === 'start' ? 5 : 0)}
                y={y - 4}
                fontSize={7.5}
                fill="#1e293b"
                opacity={0.6}
                textAnchor={h.anchor}
              >
                {h.name}
              </text>
            </g>
          );
        })}

        {/* 익명화 컨테이너 위치 (좌표만, 화주·번호 없음) */}
        {positions.map((p, i) => {
          const [x, y] = project(p.lat, p.lng);
          if (x < 0 || x > W || y < 0 || y > H) return null;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={3}
              fill={SIGNAL_COLOR[p.signal] ?? '#3b82f6'}
              opacity={0.75}
            />
          );
        })}
      </svg>

      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />운송중
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500" />도착
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500" />지연주의
        </span>
        <span className="ml-auto">개별 고객·컨테이너 정보 미포함</span>
      </div>
    </div>
  );
}
