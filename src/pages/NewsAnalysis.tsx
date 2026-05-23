import { useTranslation } from 'react-i18next';

export default function NewsAnalysis() {
  const { t } = useTranslation();
  return (
    <main className="max-w-4xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-slate-900 mb-4">{t('news.title')}</h1>
      <p className="text-slate-500 text-sm">
        workers/collectors 파이프라인에서 자동 수집된 뉴스가 여기에 표시됩니다.
        (Supabase 연결 + 뉴스 테이블 추가 후 활성화)
      </p>
    </main>
  );
}
