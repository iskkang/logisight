import { Navigation } from '@/components/Navigation';
import { Hero } from '@/components/Hero';
import { IndexBar } from '@/components/IndexBar';
import { WeeklyBriefing } from '@/components/WeeklyBriefing';
import { NewsFeed } from '@/components/NewsFeed';
import { KoreaRoutes } from '@/components/sidebar/KoreaRoutes';
import { EurasiaBridge } from '@/components/sidebar/EurasiaBridge';
import { PolicyMonitor } from '@/components/sidebar/PolicyMonitor';
import { NewsletterCTA } from '@/components/sidebar/NewsletterCTA';
import { IndustrySection } from '@/components/IndustrySection';
import { Footer } from '@/components/Footer';
import {
  getLatestBriefing,
  getIndices,
  getHeroNews,
  getNewsGrid,
  getKoreaRoutes,
  getEurasiaRoutes,
  getPolicyAlerts,
  getLastUpdated,
  getBlankSailingsStat,
} from '@/lib/supabase/queries';

// Disable static caching — re-fetch on each request.
// For production, consider `revalidate: 600` (10 min) instead.
export const revalidate = 0;

export default async function HomePage() {
  // 병렬로 모든 데이터 가져오기 (가장 느린 쿼리에만 대기)
  const [
    briefing,
    indices,
    heroNews,
    newsGrid,
    koreaRoutes,
    eurasiaRoutes,
    policyAlerts,
    lastUpdated,
    blankCount,
  ] = await Promise.all([
    getLatestBriefing(),
    getIndices(),
    getHeroNews(),
    getNewsGrid(),
    getKoreaRoutes(),
    getEurasiaRoutes(),
    getPolicyAlerts(),
    getLastUpdated(),
    getBlankSailingsStat(),
  ]);

  return (
    <main className="min-h-screen">
      <Navigation />
      <Hero blankCount={blankCount} />
      <IndexBar indices={indices} lastUpdated={lastUpdated} />

      <div className="bg-slate-50 px-5 py-6">
        <div className="max-w-page mx-auto grid grid-cols-[1fr_280px] gap-5">
          <div>
            <WeeklyBriefing briefing={briefing} />
            <NewsFeed heroNews={heroNews} newsGrid={newsGrid} />
          </div>

          <div>
            <KoreaRoutes routes={koreaRoutes} />
            <EurasiaBridge routes={eurasiaRoutes} />
            <PolicyMonitor alerts={policyAlerts} />
            <NewsletterCTA />
          </div>
        </div>
      </div>

      <IndustrySection />
      <Footer />
    </main>
  );
}
