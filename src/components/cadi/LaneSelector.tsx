import { useTranslation } from 'react-i18next';
import type { Lane } from '../../lib/api';

interface Props {
  lanes: Lane[];
  selected: string;
  onChange: (id: string) => void;
}

export default function LaneSelector({ lanes, selected, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-slate-500">{t('cadi.selectLane')}:</span>
      {lanes.map(lane => (
        <button
          key={lane.id}
          onClick={() => onChange(lane.id)}
          className={`px-3 py-1 rounded-full text-sm border transition-colors ${
            selected === lane.id
              ? 'bg-slate-900 text-white border-slate-900'
              : 'border-slate-300 hover:border-slate-500 text-slate-700'
          }`}
        >
          {lane.id}
          {lane.transit_min && (
            <span className="ml-1 text-xs opacity-60">
              {lane.transit_min}–{lane.transit_max}d
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
