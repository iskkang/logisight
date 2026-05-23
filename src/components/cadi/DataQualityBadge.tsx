import { useTranslation } from 'react-i18next';

const COLORS: Record<string, string> = {
  confirmed:   'bg-emerald-100 text-emerald-800',
  provisional: 'bg-amber-100 text-amber-800',
  indicative:  'bg-sky-100 text-sky-800',
};

interface Props {
  quality: 'confirmed' | 'provisional' | 'indicative';
  sampleCount: number;
}

export default function DataQualityBadge({ quality, sampleCount }: Props) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${COLORS[quality] ?? ''}`}>
      {t(`cadi.quality.${quality}`)} (n={sampleCount})
    </span>
  );
}
