// src/pages/Methodology.tsx
// CADI spec §8 — Trust & Verification (verbatim from spec, public-facing)
import { useTranslation } from 'react-i18next';

const MILESTONES = [
  { code: 'ORIGIN_DEP',   desc: 'Origin departure (Incheon / Busan or China factory)' },
  { code: 'SEA_TS_ARR',   desc: 'China transshipment port arrival (Qingdao / Weihai / LYG)' },
  { code: 'RAIL_DEP_CN',  desc: 'China rail departure (CR Express loading)' },
  { code: 'KASHI_ARR',    desc: 'Kashgar rail arrival' },
  { code: 'KASHI_BONDED', desc: 'Kashgar bonded warehouse clearance' },
  { code: 'TRUCK_DEP',    desc: 'Kashgar truck departure (modal change)' },
  { code: 'XIAN_HUB',     desc: 'Xi\'an hub transit (Khorgos pattern)' },
  { code: 'CN_BORDER',    desc: 'China exit border (Khorgos / Altynkol / Dostyk)' },
  { code: 'KG_UZ_BORDER', desc: 'Central Asia entry border — Osh / KG→UZ crossing ★ primary bottleneck' },
  { code: 'DEST_ARR',     desc: 'Final destination arrival' },
];

const TRUST_PRINCIPLES = [
  {
    num: '1',
    title: 'First-party observation is ground truth.',
    body: 'Tracing timestamps are measured ATA (Actual Time of Arrival), not estimates. No external validation needed — this is observation, not modelling.',
  },
  {
    num: '2',
    title: 'Internal triangulation.',
    body: 'Tracing (measured) + field staff reports + customer feedback. When all three align → confirmed. When they diverge → provisional. No single source inflates confidence.',
  },
  {
    num: '3',
    title: 'Sample transparency.',
    body: 'Every figure is published with sample count n. Grades: confirmed (n ≥ 5) / provisional (2 ≤ n < 5) / indicative (n < 2). Thin samples are labelled, not hidden.',
  },
  {
    num: '4',
    title: 'Uncertainty over precision theatre.',
    body: 'We publish median + P90 (spread), not a single "delay" number. The P90 is as important as the median — it shows tail risk. We don\'t pretend to be more precise than we are.',
  },
  {
    num: '5',
    title: 'Version control + correction log.',
    body: 'All published figures carry methodology_version. Errors, when found, are corrected publicly — not quietly updated. Transparency about mistakes builds more trust than hiding them.',
  },
  {
    num: '6',
    title: 'Publication recruits validators.',
    body: 'The first published numbers will draw reaction from fellow forwarders and shippers — "that matches what we see" or "ours was different". That feedback loop gradually expands our validation panel.',
  },
  {
    num: '7',
    title: 'Annual CAREC cross-check.',
    body: 'CAREC CPMM publishes annual average transit times and costs for the same corridors. We cross-check our weekly averages against these annual benchmarks to confirm we\'re measuring the same thing.',
  },
  {
    num: '8',
    title: 'Recalibrated bar.',
    body: 'Our goal is not "Xeneta-level precision". It is "more useful than the contradictory press releases and generalised broker estimates currently filling the gap". That bar is cleared by observation alone.',
  },
];

export default function Methodology() {
  const { t } = useTranslation();
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          {t('methodology.title', 'Methodology')}
        </h1>
        <p className="text-slate-500 text-sm leading-relaxed">
          How CADI (Central Asia Delay Intelligence) measures, validates, and publishes delay data —
          and why we think transparency is a more durable asset than precision theatre.
        </p>
      </div>

      <section className="space-y-10">

        {/* What is CADI */}
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">What is CADI?</h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            CADI aggregates milestone timestamps from MTL Shipping Agency's live tracing system
            across Korea/China → Central Asia shipments. Every data point is an actual measured
            timestamp — not an estimate, not a survey, not a model output.
            Individual shipment details are never published. All figures are aggregated across
            multiple shipments before release.
          </p>
          <p className="mt-3 text-slate-500 text-xs">
            Data attribution: <em>MTL-handled shipments, n=[sample count]</em>
          </p>
        </div>

        {/* Milestones */}
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-3">Milestone Definitions</h2>
          <div className="space-y-2">
            {MILESTONES.map(m => (
              <div key={m.code} className="flex gap-3 text-sm items-start">
                <code className={`bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-mono text-xs whitespace-nowrap mt-0.5 ${
                  m.code === 'KG_UZ_BORDER' ? 'bg-amber-100 text-amber-800' : ''
                }`}>
                  {m.code}
                </code>
                <span className="text-slate-600">{m.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Aggregation method */}
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-3">Aggregation Method</h2>
          <ul className="space-y-2 text-sm text-slate-600">
            <li>
              <strong>Delay</strong> = Actual arrival − Planned arrival (stored in hours; published in days, rounded to 1 decimal).
              Negative = early. Positive = late.
            </li>
            <li>
              <strong>Median</strong>: 50th percentile of all measured delays in the sample window (week × lane).
            </li>
            <li>
              <strong>P90</strong>: 90th percentile. The value exceeded by only 10% of shipments — a proxy for tail risk /
              worst-case planning buffer.
            </li>
            <li>
              <strong>OTP (On-Time Performance)</strong>: Fraction of shipments where delay ≤ 0.
            </li>
            <li>
              <strong>Gap vs baseline</strong>: Median delay of a given Kashi-pattern lane minus the median of the
              Northern (Małaszewicze) baseline for the same week. Shows relative corridor premium.
            </li>
          </ul>
        </div>

        {/* Trust principles */}
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">
            Trust Without External Benchmarks
          </h2>
          <p className="text-slate-500 text-sm mb-5">
            Central Asia corridors lack the Drewry / Xeneta-style external benchmarks available for
            ocean freight. Here is how CADI earns trust without them:
          </p>
          <div className="space-y-5">
            {TRUST_PRINCIPLES.map(p => (
              <div key={p.num} className="flex gap-4">
                <span className="flex-shrink-0 w-7 h-7 bg-sky-50 border border-sky-200 text-sky-700 rounded-full text-xs font-bold flex items-center justify-center">
                  {p.num}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{p.title}</p>
                  <p className="text-sm text-slate-600 leading-relaxed mt-0.5">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
          <blockquote className="mt-6 border-l-4 border-sky-300 pl-4 text-sm text-slate-500 italic">
            "The risk is being <em>wrong and opaque</em> — not <em>wrong and transparent</em>.
            Transparency is the substitute for external validation."
          </blockquote>
        </div>

        {/* Data quality grades */}
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-3">Data Quality Grades</h2>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap">✅ Confirmed</span>
              <span className="text-slate-600">n ≥ 5 shipments — statistically meaningful. Safe to cite.</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap">⚠️ Provisional</span>
              <span className="text-slate-600">2 ≤ n &lt; 5 — directionally indicative, subject to revision as sample grows.</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-sky-100 text-sky-800 px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap">🔵 Indicative</span>
              <span className="text-slate-600">n &lt; 2 — reference only. A single shipment cannot represent a lane.</span>
            </div>
          </div>
        </div>

        {/* Privacy */}
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">Privacy & Aggregation Rules</h2>
          <ul className="space-y-1.5 text-sm text-slate-600">
            <li>• Published values are <strong>aggregated only</strong> (median, P90, OTP, sample count).</li>
            <li>• Individual shipment records are never exposed externally (RLS-enforced).</li>
            <li>• Thin-sample lanes (e.g. Bishkek with n &lt; 2) are labelled <em>indicative</em> or withheld.</li>
            <li>• Field reports are generalised: "UZ-bound cargo" — no customer, contract, or cargo identifiers.</li>
          </ul>
        </div>

        <div className="border-t border-slate-200 pt-6">
          <p className="text-xs text-slate-400 leading-relaxed">
            {t('methodology.trustNote', 'CADI is published by MTL Shipping Agency. Methodology version: v1.1. Errors are corrected publicly — see revision notes when published.')}{' '}
            Questions: <a href="mailto:iskang@mtlb.co.kr" className="text-sky-500 hover:underline">iskang@mtlb.co.kr</a>
          </p>
        </div>
      </section>
    </main>
  );
}
