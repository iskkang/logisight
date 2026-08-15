// supabase/functions/weekly-pick-select/index.ts
// 이번 주 주목(weekly_pick) 자동 선정 — 사람 개입 없는 결정론적 배치.
// 최근 7일 maritime_news(ko)에 점수(언급량·물류 영향도)를 매겨 1건 선정 → weekly_pick upsert(주1행).
// 점수는 결정론적·설명가능(LLM 불필요). 선정 근거(why)도 규칙으로 생성.
//
// 실스키마 반영(작업지시문 코드에서 조정한 부분):
// · maritime_news.view_count 컬럼은 아직 없음 → select 제외, 조회수 신호는 전부 0(언급량·영향도만으로 선정).
//   view_count 도입 시: select 에 view_count 추가 + `views` 매핑만 a.view_count 로 복원하면 가중치(W.views) 자동 활성.
// · maritime_news.id 는 bigint → weekly_pick.article_id(text)에 String()으로 저장.
// · /news 가 lang='ko'만 노출 → ko 기사로 한정(영문 RSS 픽 방지). 주 경계는 KST(+09:00).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireCronSecret } from "../_shared/require-cron-secret.ts";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// 가중치 (합 1.0). views 는 view_count 도입 전까지 상수 0 → 사실상 mentions·impact 로 선정.
const W = { views: 0.45, mentions: 0.25, impact: 0.30 };

type Article = {
  id: number; title: string; category: string | null; source: string | null;
  url: string | null; image_url: string | null; published_at: string;
};

// ── 주(週) 경계: 이번 주 월요일~일요일 (KST) ──
function weekRangeKST(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600e3);        // UTC→KST
  const dow = (kst.getUTCDay() + 6) % 7;                   // 0=월
  const monday = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - dow));
  const sunday = new Date(monday.getTime() + 6 * 86400e3);
  const fmt = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { week_start: iso(monday), week_end: iso(sunday), label: `${fmt(monday)} – ${fmt(sunday)}` };
}

// ── 물류 영향도(규칙 기반) ──
const HIGH_IMPACT = ["운임","선복","요율","관세","de minimis","301조","Section 301",
  "호르무즈","홍해","수에즈","파나마","급감","급증","최고","최저","사상","중단","재개","파업","봉쇄","결항","회항"];
function impactScore(t: string, cat: string | null): number {
  let s = 0;
  for (const k of HIGH_IMPACT) if (t.includes(k)) s += 1;
  if (/\d+\s*%/.test(t)) s += 1.5;          // 수치 = 구체성·임팩트
  if (/\d+\s*배/.test(t)) s += 1;
  if (/\d+\s*개월/.test(t)) s += 0.5;
  const cw: Record<string, number> = { "해상": 1.5, "물류": 1.2, "무역": 1.2, "항공": 1.0, "철도": 0.8 };
  s += cw[cat ?? ""] ?? 0.5;
  return s;
}
// 영향 라벨(why용)
function impactLabel(t: string): string {
  if (/운임|선복|요율/.test(t)) return "운임 영향";
  if (/관세|301|de minimis/.test(t)) return "무역정책 영향";
  if (/호르무즈|홍해|수에즈|파나마|봉쇄|결항|회항/.test(t)) return "노선 변동성";
  return "공급망 영향";
}

// ── 언급량(근접 보도) 프록시: 같은 주 다른 기사와 제목 토큰 2개 이상 공유 ──
function tokenize(t: string) { return (t.toLowerCase().match(/[a-z0-9]+|[가-힣]{2,}/g) ?? []); }

function norm(vals: number[]) {
  const mn = Math.min(...vals), mx = Math.max(...vals), d = mx - mn || 1;
  return (v: number) => (v - mn) / d;
}

Deno.serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  try {
    const { week_start, week_end, label } = weekRangeKST();

    // ① 최근 7일 ko 기사 (KST 경계). view_count 컬럼 미존재 → select 제외.
    const { data: rows, error } = await sb.from("maritime_news")
      .select("id,title,category,source,url,image_url,published_at")
      .eq("lang", "ko")
      .gte("published_at", `${week_start}T00:00:00+09:00`)
      .lte("published_at", `${week_end}T23:59:59+09:00`);
    if (error) throw error;
    const arts = (rows ?? []) as Article[];
    if (arts.length === 0) return Response.json({ ok: true, skipped: true, reason: "no articles", week_start });

    // ② 신호
    const tokSets = arts.map((a) => new Set(tokenize(a.title)));
    const mentions = arts.map((_, i) => {
      let c = 0;
      for (let j = 0; j < arts.length; j++) {
        if (i === j) continue;
        let shared = 0; for (const t of tokSets[i]) if (tokSets[j].has(t)) shared++;
        if (shared >= 2) c++;
      }
      return c;
    });
    const views = arts.map(() => 0);   // view_count 미도입 → 전부 0 (도입 시 a.view_count ?? 0 로 교체)
    const impacts = arts.map((a) => impactScore(a.title, a.category));

    const nV = norm(views), nM = norm(mentions), nI = norm(impacts);

    // ③ 가중합
    let best = -1, bestScore = -1, bestParts = { v: 0, m: 0, i: 0 };
    arts.forEach((_, idx) => {
      const v = nV(views[idx]), m = nM(mentions[idx]), i = nI(impacts[idx]);
      const score = W.views * v + W.mentions * m + W.impact * i;
      if (score > bestScore) { bestScore = score; best = idx; bestParts = { v, m, i }; }
    });
    const a = arts[best];

    // ④ 선정 근거(why): 기여도 상위 2개 (조회수 신호는 0이므로 사실상 제외)
    const parts = [
      { key: "views", val: W.views * bestParts.v, label: "최다 조회" },
      { key: "mentions", val: W.mentions * bestParts.m, label: "다수 매체 보도" },
      { key: "impact", val: W.impact * bestParts.i, label: impactLabel(a.title) },
    ].sort((x, y) => y.val - x.val);
    const why = parts.slice(0, 2).filter((p) => p.val > 0).map((p) => p.label).join(" · ") || impactLabel(a.title);

    // ⑤ upsert (주 1행, week_start PK)
    const { error: upErr } = await sb.from("weekly_pick").upsert({
      week_start, week_label: label, article_id: String(a.id), headline: a.title,
      category: a.category, source: a.source, url: a.url, image_url: a.image_url,
      view_count: null, why, score: Number(bestScore.toFixed(4)), scored_at: new Date().toISOString(),
    }, { onConflict: "week_start" });
    if (upErr) throw upErr;

    return Response.json({ ok: true, week_start, picked: a.id, headline: a.title, why, score: bestScore });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
