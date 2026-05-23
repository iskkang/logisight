import { useTranslation } from 'react-i18next';

const MILESTONES = [
  { code: 'ORIGIN_DEP',   desc: '한국 출발항 또는 공장 출고' },
  { code: 'SEA_TS_ARR',   desc: '해상 환적항 도착' },
  { code: 'RAIL_DEP_CN',  desc: '중국 철도 출발 (CR Express 탑재)' },
  { code: 'KASHI_ARR',    desc: '카스시 / 우루무치 도착' },
  { code: 'KASHI_BONDED', desc: '카스시 보세창고 통관' },
  { code: 'TRUCK_DEP',    desc: '트럭 환적 출발' },
  { code: 'XIAN_HUB',     desc: '시안 허브 처리' },
  { code: 'CN_BORDER',    desc: '중국 국경 출경 (Horgos / Dostyk / Erenhot)' },
  { code: 'KG_UZ_BORDER', desc: '중앙아시아 국경 입경' },
  { code: 'DEST_ARR',     desc: '최종 목적지 도착' },
];

export default function Methodology() {
  const { t } = useTranslation();
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-slate-900 mb-8">{t('methodology.title')}</h1>

      <section className="space-y-8">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">데이터 출처</h2>
          <p className="text-slate-600 text-sm leading-relaxed">
            CADI는 MTL Shipping Agency가 직접 처리한 화물의 마일스톤 타임스탬프를
            집계한 지수입니다. 외부 공개 데이터가 아닌 MTL 내부 운영 데이터 기반입니다.
            각 데이터 포인트는 개인 화물 정보 없이 익명화되어 집계됩니다.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-3">마일스톤 정의</h2>
          <div className="space-y-2">
            {MILESTONES.map(m => (
              <div key={m.code} className="flex gap-3 text-sm">
                <code className="bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-mono text-xs whitespace-nowrap self-start mt-0.5">
                  {m.code}
                </code>
                <span className="text-slate-600">{m.desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">집계 방법</h2>
          <ul className="space-y-1 text-sm text-slate-600">
            <li>• <strong>딜레이</strong> = 실제 도착 − 계획 도착 (시간 단위, 음수 = 조기 도착)</li>
            <li>• <strong>중앙값(Median)</strong>: 주간 표본의 50th percentile</li>
            <li>• <strong>P90</strong>: 주간 표본의 90th percentile (최악 케이스 대리지표)</li>
            <li>• <strong>정시율</strong>: 딜레이 ≤ 0인 화물 비율</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">데이터 신뢰도 등급</h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-3">
              <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-xs font-medium">✅ Confirmed</span>
              <span className="text-slate-600">n ≥ 5 화물 — 통계적으로 유의미</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-xs font-medium">⚠️ Provisional</span>
              <span className="text-slate-600">2 ≤ n &lt; 5 — 잠정적, 변동 가능성</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="bg-sky-100 text-sky-800 px-2 py-0.5 rounded text-xs font-medium">🔵 Indicative</span>
              <span className="text-slate-600">n &lt; 2 — 참고치로만 활용</span>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-6">
          <p className="text-xs text-slate-400">{t('methodology.trustNote')}</p>
        </div>
      </section>
    </main>
  );
}
