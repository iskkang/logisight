import { useTranslation } from 'react-i18next';
import type { DisruptionEvent } from '../../lib/api';

const SEVERITY_STYLE: Record<string, string> = {
  high:   'border-red-400 bg-red-50',
  medium: 'border-amber-400 bg-amber-50',
  low:    'border-sky-400 bg-sky-50',
};

export default function AlertCard({ event }: { event: DisruptionEvent }) {
  const { i18n } = useTranslation();
  const lng = i18n.language;

  const title =
    (lng === 'ko' && event.title_ko) ||
    (lng === 'ru' && event.title_ru) ||
    (lng === 'zh' && event.title_zh) ||
    event.title_en;

  return (
    <div className={`rounded-lg border-l-4 p-4 ${SEVERITY_STYLE[event.severity] ?? 'border-slate-300 bg-slate-50'}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {event.event_type.replace(/_/g, ' ')}
        </span>
        {event.lane_id && (
          <span className="text-xs bg-slate-200 px-2 py-0.5 rounded">{event.lane_id}</span>
        )}
        <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded ${
          event.severity === 'high' ? 'bg-red-200 text-red-800' :
          event.severity === 'medium' ? 'bg-amber-200 text-amber-800' :
          'bg-sky-200 text-sky-800'
        }`}>
          {event.severity.toUpperCase()}
        </span>
      </div>
      <p className="font-medium text-slate-800 text-sm">{title}</p>
      {event.source_url && (
        <a
          href={event.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-sky-600 hover:underline mt-1 block"
        >
          원문 보기 →
        </a>
      )}
    </div>
  );
}
