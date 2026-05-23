// src/pages/Subscribe.tsx
// Logisight newsletter subscribe page.
// Full form implementation deferred — stub CTA for now.
import { useTranslation } from 'react-i18next';

export default function Subscribe() {
  const { t } = useTranslation();

  return (
    <main className="max-w-2xl mx-auto px-6 py-20 text-center">
      <h1 className="text-3xl font-bold text-slate-900 mb-4">
        {t('subscribe.title', 'Subscribe to Logisight')}
      </h1>
      <p className="text-slate-500 mb-8 leading-relaxed">
        {t(
          'subscribe.desc',
          'Get weekly Central Asia logistics intelligence — delay data, disruption alerts, and analysis — delivered to your inbox.'
        )}
      </p>

      {/* Placeholder form — replace with Resend audience form or external embed */}
      <form
        onSubmit={e => { e.preventDefault(); alert('준비 중입니다. 이메일: iskang@mtlb.co.kr로 직접 연락해 주세요.'); }}
        className="flex flex-col sm:flex-row gap-3 justify-center"
      >
        <input
          type="email"
          required
          placeholder="your@email.com"
          className="flex-1 max-w-xs px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <button
          type="submit"
          className="px-6 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors"
        >
          {t('subscribe.cta', 'Subscribe')}
        </button>
      </form>

      <p className="mt-4 text-xs text-slate-400">
        {t('subscribe.frequency', 'Weekly · No spam · Unsubscribe anytime')}
      </p>
    </main>
  );
}
