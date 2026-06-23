import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEEPSEEK_KEY = Deno.env.get("DEEPSEEK_API_KEY")!;
const MODEL = Deno.env.get("DEEPSEEK_MODEL") ?? "deepseek-v4-pro";

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

type TradeStatRow = {
  period: string;
  priod_dt: string | null;
  stat_type: "provisional_exp" | "provisional_imp" | string;
  country_code: string | null;
  country_name: string | null;
  export_usd: number | null;
  import_usd: number | null;
};

type FreightRow = {
  index_code: string;
  value: number | null;
  week_date: string;
  change_pct: number | null;
};

type TradeBriefInput = {
  period: string;
  trade: {
    total: number | null;
    totalYoY: number | null;
    totalMoM: number | null;
    exp: number | null;
    imp: number | null;
    balance: number | null;
    balanceTrend: string;
  };
  movers: Array<{ name: string; yoy: number; note: string }>;
  freight: Array<{ idx: string; wow: number | null; lane: string; outlook: string }>;
};

const FREIGHT_SYNC = [
  { idx: "WCI", lane: "한-미(미서안)" },
  { idx: "KCCI", lane: "한-중" },
  { idx: "FBX", lane: "한-유럽" },
] as const;

const MOVER_NOTES: Record<string, string> = {
  TW: "반도체·전자 관련 변동",
  HK: "환적 수요 변동",
  MY: "전기·전자 관련 변동",
  JP: "전기·전자 관련 변동",
  CN: "주요 교역국 변동",
  US: "주요 교역국 변동",
  VN: "생산거점 교역 변동",
};

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}

function periodKey(period: string | null | undefined): string {
  return (period ?? "").replace(/\D/g, "").slice(0, 6);
}

function periodDisplay(period: string | null | undefined): string {
  const p = periodKey(period);
  if (p.length < 6) throw new Error(`invalid period: ${period}`);
  return `${p.slice(0, 4)}.${p.slice(4, 6)}`;
}

function dbPeriod(period6: string): string {
  return `${period6.slice(0, 4)}-${period6.slice(4, 6)}`;
}

function addMonths(period6: string, delta: number): string {
  const year = Number(period6.slice(0, 4));
  const month = Number(period6.slice(4, 6));
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function prevYearPeriod(period6: string): string {
  return `${Number(period6.slice(0, 4)) - 1}${period6.slice(4, 6)}`;
}

function priodRank(v: string | null | undefined): number {
  if (!v) return 0;
  if (v.includes("말일")) return 3;
  if (v.includes("20")) return 2;
  if (v.includes("10")) return 1;
  return 0;
}

function pctChange(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return round(((curr - prev) / Math.abs(prev)) * 100, 1);
}

function round(v: number | null, digits = 2): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const m = 10 ** digits;
  return Math.round(v * m) / m;
}

function usdToBillion(v: number | null): number | null {
  return round(v == null ? null : v / 1e9, 2);
}

function latestPriodRows(rows: TradeStatRow[], wantedPriod?: string | null): TradeStatRow[] {
  if (wantedPriod) return rows.filter((row) => row.priod_dt === wantedPriod);
  const maxRank = Math.max(0, ...rows.map((row) => priodRank(row.priod_dt)));
  if (maxRank === 0) return rows;
  return rows.filter((row) => priodRank(row.priod_dt) === maxRank);
}

function aggregateDirection(rows: TradeStatRow[], statType: "provisional_exp" | "provisional_imp"): number | null {
  const typed = rows.filter((row) => row.stat_type === statType);
  const all = typed.find((row) => (row.country_code ?? "").toUpperCase() === "ALL");
  if (all) return statType === "provisional_exp" ? all.export_usd : all.import_usd;
  const values = typed
    .filter((row) => (row.country_code ?? "").toUpperCase() !== "ALL")
    .map((row) => statType === "provisional_exp" ? row.export_usd : row.import_usd)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!values.length) return null;
  return values.reduce((acc, v) => acc + v, 0);
}

function aggregateTrade(rows: TradeStatRow[]) {
  const exp = aggregateDirection(rows, "provisional_exp");
  const imp = aggregateDirection(rows, "provisional_imp");
  const total = exp == null && imp == null ? null : (exp ?? 0) + (imp ?? 0);
  const balance = exp == null && imp == null ? null : (exp ?? 0) - (imp ?? 0);
  return { exp, imp, total, balance };
}

function countryTotals(rows: TradeStatRow[]) {
  const byCode = new Map<string, { code: string; name: string; exp: number; imp: number }>();
  for (const row of rows) {
    const code = (row.country_code ?? "").toUpperCase();
    if (!code || code === "ALL") continue;
    const current = byCode.get(code) ?? { code, name: row.country_name ?? code, exp: 0, imp: 0 };
    current.name = row.country_name ?? current.name;
    current.exp += row.export_usd ?? 0;
    current.imp += row.import_usd ?? 0;
    byCode.set(code, current);
  }
  return [...byCode.values()].map((row) => ({
    ...row,
    trade: row.exp + row.imp,
  }));
}

function buildMovers(currentRows: TradeStatRow[], previousRows: TradeStatRow[]) {
  const prev = new Map(countryTotals(previousRows).map((row) => [row.code, row.trade]));
  const movers = countryTotals(currentRows)
    .map((row) => {
      const yoy = pctChange(row.trade, prev.get(row.code) ?? null);
      return yoy == null
        ? null
        : {
          name: row.name,
          yoy,
          note: MOVER_NOTES[row.code] ?? (yoy >= 0 ? "교역 증가" : "교역 둔화"),
        };
    })
    .filter((row): row is { name: string; yoy: number; note: string } => row !== null);

  const up = movers.filter((row) => row.yoy >= 0).sort((a, b) => b.yoy - a.yoy).slice(0, 2);
  const down = movers.filter((row) => row.yoy < 0).sort((a, b) => a.yoy - b.yoy).slice(0, 2);
  return [...up, ...down];
}

function freightOutlook(wow: number | null): string {
  if (wow == null) return "수집 중";
  if (wow > 1) return "상승";
  if (wow < -1) return "보합~약세";
  return "보합";
}

async function fetchProvisional(period6: string): Promise<TradeStatRow[]> {
  const { data, error } = await sb
    .from("trade_statistics")
    .select("period,priod_dt,stat_type,country_code,country_name,export_usd,import_usd")
    .eq("period", dbPeriod(period6))
    .in("stat_type", ["provisional_exp", "provisional_imp"]);
  if (error) throw error;
  return (data ?? []) as TradeStatRow[];
}

async function latestProvisionalPeriod(): Promise<string> {
  const { data, error } = await sb
    .from("trade_statistics")
    .select("period")
    .in("stat_type", ["provisional_exp", "provisional_imp"])
    .order("period", { ascending: false })
    .limit(1);
  if (error) throw error;
  const period = periodKey(data?.[0]?.period);
  if (!period) throw new Error("no provisional trade data");
  return period;
}

async function latestFreight() {
  const codes = FREIGHT_SYNC.map((row) => row.idx);
  const { data, error } = await sb
    .from("freight_indices")
    .select("index_code,value,week_date,change_pct")
    .in("index_code", codes)
    .order("week_date", { ascending: false })
    .limit(30);
  if (error) throw error;
  const latest = new Map<string, FreightRow>();
  for (const row of (data ?? []) as FreightRow[]) {
    if (!latest.has(row.index_code)) latest.set(row.index_code, row);
  }
  return FREIGHT_SYNC.map(({ idx, lane }) => {
    const row = latest.get(idx);
    const wow = round(row?.change_pct ?? null, 1);
    return { idx, wow, lane, outlook: freightOutlook(wow) };
  });
}

function balanceTrend(current: number | null, previous: number | null): string {
  if (current == null || previous == null) return "판단 보류";
  if (current >= 0 && previous < 0) return "흑자 전환";
  if (current < 0 && previous >= 0) return "적자 전환";
  return Math.abs(current) >= Math.abs(previous) ? "확대" : "축소";
}

async function buildInput(): Promise<TradeBriefInput> {
  const period6 = await latestProvisionalPeriod();
  const [currentAll, prevYearAll, prevMonthAll, freight] = await Promise.all([
    fetchProvisional(period6),
    fetchProvisional(prevYearPeriod(period6)),
    fetchProvisional(addMonths(period6, -1)),
    latestFreight(),
  ]);

  const priod = latestPriodRows(currentAll).at(0)?.priod_dt ?? null;
  const currentRows = latestPriodRows(currentAll, priod);
  const prevYearRows = latestPriodRows(prevYearAll, priod);
  const prevMonthRows = latestPriodRows(prevMonthAll, priod);
  if (!currentRows.length) throw new Error("no current provisional rows");

  const current = aggregateTrade(currentRows);
  const previousYear = aggregateTrade(prevYearRows);
  const previousMonth = aggregateTrade(prevMonthRows);

  return {
    period: periodDisplay(period6),
    trade: {
      total: usdToBillion(current.total),
      totalYoY: pctChange(current.total, previousYear.total),
      totalMoM: pctChange(current.total, previousMonth.total),
      exp: usdToBillion(current.exp),
      imp: usdToBillion(current.imp),
      balance: usdToBillion(current.balance),
      balanceTrend: balanceTrend(current.balance, previousYear.balance),
    },
    movers: buildMovers(currentRows, prevYearRows),
    freight,
  };
}

function prompt(input: TradeBriefInput) {
  return [
    "당신은 한국 물류기업 경영진을 위한 무역 애널리스트입니다.",
    "아래 JSON 수치만 근거로 한국어 브리핑을 작성하세요.",
    "규칙:",
    "- 1문장 결론(두괄식) + 2~3문장 근거. 총 3문장 이내.",
    "- 입력에 없는 수치/국가/품목을 만들거나 변형하지 말 것. 숫자는 그대로 인용.",
    "- 교역 변화와 운임(freight)의 연결(동조/괴리)을 1개 이상 언급.",
    "- 과장·권유 금지. 담백한 분석체.",
    '- 반드시 {"verdict": string, "detail": string} JSON만 출력. 코드펜스·머리말 금지.',
    "",
    "DATA:",
    JSON.stringify(input),
  ].join("\n");
}

function parseBriefJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = (fenced?.[1] ?? text).trim();
  const json = JSON.parse(body);
  if (typeof json?.verdict !== "string" || typeof json?.detail !== "string") throw new Error("schema");
  const verdict = json.verdict.trim().replace(/\s+/g, " ").slice(0, 120);
  const detail = json.detail.trim().replace(/\s+/g, " ").slice(0, 400);
  if (!verdict || !detail) throw new Error("schema");
  return { verdict, detail };
}

async function callDeepSeek(input: TradeBriefInput) {
  // DeepSeek 는 OpenAI 호환 chat/completions. deepseek-v4-pro 는 추론(reasoning) 모델로
  // 추론 토큰(~1.4k)이 max_tokens 를 소비하므로 답변이 잘리지 않게 넉넉히 잡는다.
  // response_format 으로 순수 JSON 을 강제(프롬프트에 'JSON' 명시 필요 — 이미 포함).
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt(input) }],
    }),
  });
  if (!r.ok) throw new Error(`deepseek ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const text = (data.choices?.[0]?.message?.content ?? "").trim();
  return parseBriefJson(text);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });

  try {
    const input = await buildInput();
    const input_hash = await sha256(stableStringify(input));

    const { data: existing, error: existingError } = await sb
      .from("trade_briefs")
      .select("input_hash")
      .eq("period", input.period)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.input_hash === input_hash) {
      return Response.json({ ok: true, skipped: true, period: input.period });
    }

    const brief = await callDeepSeek(input);
    const { error } = await sb.from("trade_briefs").upsert({
      period: input.period,
      verdict: brief.verdict,
      detail: brief.detail,
      input_hash,
      model: MODEL,
      generated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return Response.json({ ok: true, period: input.period, ...brief });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});
