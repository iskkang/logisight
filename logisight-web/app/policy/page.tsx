import { Navigation } from '@/components/Navigation';
import { IndexBar } from '@/components/IndexBar';
import { Footer } from '@/components/Footer';
import { NewsletterCTA } from '@/components/sidebar/NewsletterCTA';
import {
  getPolicyAlerts,
  getPolicyNews,
  getIndices,
  getLastUpdated,
} from '@/lib/supabase/queries';
import type { PolicyAlert } from '@/lib/types';
import type { NewsArticle, NewsCategory } from '@/lib/types';

export const revalidate = 3600;

// ── 배지 색상 ─────────────────────────────────────────────────────────────────
const BADGE_COLOR: Record<string, string> = {
  CBAM:    'bg-amber-100  text-amber-700  border-amber-200',
  'EU ETS':'bg-blue-100   text-blue-700   border-blue-200',
  '제재':  'bg-rose-100   text-rose-700   border-rose-200',
  EAR:     'bg-slate-100  text-slate-700  border-slate-200',
  '전략물자': 'bg-purple-100 text-purple-700 border-purple-200',
};

const CATEGORY_COLOR: Record<string, string> = {
  해상: 'bg-blue-500/15 text-blue-700',
  항공: 'bg-purple-500/15 text-purple-700',
  철도: 'bg-amber-500/15 text-amber-700',
  물류: 'bg-emerald-500/15 text-emerald-700',
  무역: 'bg-rose-500/15 text-rose-700',
};

// ── 정책 코드 설명 ────────────────────────────────────────────────────────────
const POLICY_DESCRIPTIONS: { code: string; desc: string }[] = [
  { code: 'CBAM',    desc: '탄소국경조정제도. EU 수입품에 탄소비용 부과, 2026년 철강·시멘트 본격 적용' },
  { code: 'EU ETS',  desc: '유럽 배출권거래제. 해운 2024년부터 단계적 편입, 2026년 100% 적용' },
  { code: '제재',    desc: '대러·대이란·대북 수출통제. 환적·우회경로 포함 주의 필요' },
  { code: 'EAR',     desc: '미국 수출관리규정. 이중용도 기술·부품 수출 시 허가 필요' },
  { code: '전략물자', desc: '국내 전략물자 수출허가. 바세나르체제 기반 품목 포함' },
];

function PolicyAlertCard({ alert }: { alert: PolicyAlert }) {
  const badge = BADGE_COLOR[alert.code] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 flex items-start gap-3">
      <span className={`mt-0.5 shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded border ${badge}`}>
        {alert.code}
      </span>
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-slate-800 leading-snug keep-all">{alert.title}</p>
        {alert.meta && (
          <p className="text-[11px] text-slate-500 mt-0.5">{alert.meta}</p>
        )}
      </div>
    </div>
  );
}

function NewsCard({ article }: { article: NewsArticle }) {
  const href = article.source_url ?? '#';
  const catColor = CATEGORY_COLOR[article.category as string] ?? 'bg-slate-100 text-slate-600';
  return (
    <article className="bg-white rounded-lg border border-slate-200 p-4 hover:shadow-sm transition">
      <div className="flex items-center gap-2 mb-2">
        {article.category && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${catColor}`}>
            {article.category}
          </span>
        )}
        <span className="text-[10px] text-slate-400 ml-auto">{article.published_at}</span>
      </div>
      <h3 className="text-[13px] font-medium text-slate-800 leading-snug keep-all">
        <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-cyan-600">
          {article.title}
        </a>
      </h3>
      {article.summary && (
        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed line-clamp-2 keep-all">
          {article.summary}
        </p>
      )}
    </article>
  );
}

export default async function PolicyPage() {
  const [alerts, policyNews, indices, lastUpdated] = await Promise.all([
    getPolicyAlerts(),
    getPolicyNews(8),
    getIndices(),
    getLastUpdated(),
  ]);

  return (
    <main className="min-h-screen">
      <Navigation />
      <IndexBar indices={indices} lastUpdated={lastUpdated} />

      <div className="bg-slate-50 px-5 py-6">
        <div className="max-w-page mx-auto">
          <h2 className="text-lg font-medium text-slate-800 mb-5">정책·규제 모니터</h2>

          <div className="grid grid-cols-[1fr_320px] gap-5">
            {/* ── 왼쪽 메인 ─────────────────────────────────────────── */}
            <div className="flex flex-col gap-6">
              {/* 활성 알림 */}
              <section>
                <h3 className="text-[13px] font-semibold text-slate-700 mb-3 uppercase tracking-wide">
                  활성 알림
                </h3>
                {alerts.length === 0 ? (
                  <div className="bg-white rounded-lg border border-slate-200 p-6 text-center text-slate-400 text-sm">
                    현재 활성 알림이 없습니다.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {alerts.map((alert, i) => (
                      <PolicyAlertCard key={i} alert={alert} />
                    ))}
                  </div>
                )}
              </section>

              {/* 관련 뉴스 */}
              <section>
                <h3 className="text-[13px] font-semibold text-slate-700 mb-3 uppercase tracking-wide">
                  정책·규제 관련 뉴스
                </h3>
                {policyNews.length === 0 ? (
                  <div className="bg-white rounded-lg border border-slate-200 p-6 text-center text-slate-400 text-sm">
                    관련 뉴스를 수집 중입니다.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {policyNews.map((article) => (
                      <NewsCard key={article.id} article={article} />
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* ── 오른쪽 사이드 ─────────────────────────────────────── */}
            <div>
              {/* 정책 코드 설명 */}
              <aside className="bg-white rounded-xl border border-slate-200 p-4 mb-3.5">
                <h3 className="text-[11px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-3">
                  정책 코드 안내
                </h3>
                <div className="flex flex-col gap-3">
                  {POLICY_DESCRIPTIONS.map(({ code, desc }) => {
                    const badge = BADGE_COLOR[code] ?? 'bg-slate-100 text-slate-600 border-slate-200';
                    return (
                      <div key={code} className="flex items-start gap-2.5">
                        <span className={`shrink-0 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${badge}`}>
                          {code}
                        </span>
                        <p className="text-[11px] text-slate-600 leading-relaxed keep-all">{desc}</p>
                      </div>
                    );
                  })}
                </div>
              </aside>

              <NewsletterCTA />
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </main>
  );
}
