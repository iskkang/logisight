import { useTranslation } from 'react-i18next';
import type { DisruptionEvent } from '../../lib/api';

const SEVERITY_STYLE: Record<string, { card: string; badge: string }> = {
  high:   { card: 'border-red-400 bg-red-50',    badge: 'bg-red-200 text-red-800' },
  medium: { card: 'border-amber-400 bg-amber-50', badge: 'bg-amber-200 text-amber-800' },
  low:    { card: 'border-sky-400 bg-sky-50',     badge: 'bg-sky-200 text-sky-800' },
};

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

export default function AlertCard({ event }: { event: DisruptionEvent }) {
  const { i18n } = useTranslation();
  const lng = i18n.language;

  const title =
    (lng === 'ko' && event.title_ko) ||
    (lng === 'ru' && event.title_ru) ||
    (lng === 'zh' && event.title_zh) ||
    event.title_en;

  const style = SEVERITY_STYLE[event.severity] ?? { card: 'border-slate-300 bg-slate-50', badge: 'bg-slate-200 text-slate-700' };

  return (
    <div className={`rounded-lg border-l-4 p-4 ${style.card}`}>
      {/* Header row */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {event.event_type.replace(/_/g, ' ')}
        </span>
        {event.region && (
          <span className="text-xs text-slate-500">📍 {event.region}</span>
        )}
        {event.lane_id && (
          <span className="text-xs bg-slate-200 px-2 py-0.5 rounded">{event.lane_id}</span>
        )}
        <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded ${style.badge}`}>
          {event.severity.toUpperCase()}
        </span>
      </div>

      {/* Title */}
      <p className="font-semibold text-slate-800 text-sm leading-snug">{title}</p>

      {/* Meta: date + impact */}
      <div className="flex gap-4 mt-1.5 text-xs text-slate-500">
        {event.started_at && (
          <span>📅 {fmtDate(event.started_at)} 부터</span>
        )}
        {event.impact_days != null && (
          <span>⏱ 중앙 영향 +{event.impact_days}일</span>
        )}
        {event.resolved_at && (
          <span className="text-green-600">✅ 해소 {fmtDate(event.resolved_at)}</span>
        )}
      </div>

      {/* Body (intel detail) */}
      {event.body_en && (
        <p className="mt-2 text-xs text-slate-600 leading-relaxed">{event.body_en}</p>
      )}

      {/* Affected lanes pills */}
      {event.affected_lanes && event.affected_lanes.length > 0 && (
        <div className="mt-2 flex gap-1 flex-wrap">
          <span className="text-xs text-slate-400">영향 노선:</span>
          {event.affected_lanes.map(l => (
            <span key={l} className="text-xs bg-white border border-slate-200 px-1.5 py-0.5 rounded">{l}</span>
          ))}
        </div>
      )}

      {/* Verified by */}
      {event.verified_by && event.verified_by.length > 0 && (
        <p className="mt-1.5 text-xs text-slate-400">
          출처: {event.verified_by.join(' · ')}
        </p>
      )}

      {/* Source link */}
      {event.source_url && (
        <a
          href={event.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-sky-600 hover:underline mt-1.5 block"
        >
          원문 보기 →
        </a>
      )}
    </div>
  );
}
