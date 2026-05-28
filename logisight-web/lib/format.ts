/**
 * 운임 지수별 표시 포맷. freight_indices.value (numeric) → 사용자 친화 문자열.
 *
 *   SCFI 1954        → "1,954"
 *   WCI  2286        → "$2,286"
 *   BAI  5.16        → "$5.16/kg"
 *   VLSFO 812        → "$812"
 */
export function formatIndexValue(code: string, value: number): string {
  const c = code.toUpperCase();
  switch (c) {
    case 'WCI':
    case 'FBX':
    case 'XSI':
    case 'VLSFO':
      return `$${Math.round(value).toLocaleString()}`;
    case 'BAI':
      return `$${value.toFixed(2)}/kg`;
    case 'SCFI':
    case 'KCCI':
    case 'CCFI':
    default:
      return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
}

/**
 * Date-time → "2026.05.28 09:00"
 */
export function formatTimestamp(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${Y}.${M}.${D} ${h}:${m}`;
}

/**
 * Date → "2026-05-28"
 */
export function formatDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
