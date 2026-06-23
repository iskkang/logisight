// supabase/functions/industry-brief-generate/index.ts
// 산업 페이지 "종합 판단" 브리핑 생성·캐시 — trade-brief-generate의 산업판 트윈.
//   trade_statistics(stat_type='item')를 HS 챕터(2자리)로 집계(RPC) → Claude 2~3문장 브리핑
//   → industry_briefs upsert. input_hash가 같으면 스킵 → 관세청 월간 갱신 시에만 LLM 호출(월 1회).
//   monthly-trade-stats 워크플로가 POST로 트리거. service_role로 쓰기(RLS 우회).
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEEPSEEK_KEY = Deno.env.get("DEEPSEEK_API_KEY")!;
const MODEL = Deno.env.get("DEEPSEEK_MODEL") ?? "deepseek-v4-pro";

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

type ChapterRow = {
  chapter: string;
  export_usd: number;
  import_usd: number;
  trade_balance: number;
};

type FreightRow = {
  index_code: string;
  value: number | null;
  week_date: string;
  change_pct: number | null;
};

type IndustryBriefInput = {
  period: string;
  totals: {
    exp: number | null;
    imp: number | null;
    balance: number | null;
    expYoY: number | null;
    expMoM: number | null;
    balanceTrend: string;
  };
  concentration: { top1Hs: string; top1Name: string; top1Share: number | null };
  topIndustries: Array<{ hs: string; name: string; exp: number | null; share: number | null; yoy: number | null; balance: number | null }>;
  movers: Array<{ hs: string; name: string; yoy: number }>;
  deficit: Array<{ hs: string; name: string; balance: number | null }>;
  freightLink: Array<{ hs: string; name: string; mode: string; idx?: string; wow?: number | null; outlook?: string }>;
};

// HS 2자리 챕터 → 한국어 류명(관세청 HSK). DB에는 10자리 품목명만 있어 챕터명은 여기서 부여.
// 입력에 없는 챕터는 'HS{nn}'로 폴백.
const HS_CHAPTER: Record<string, string> = {
  "01": "산동물", "02": "육류", "03": "어류·갑각류", "04": "낙농품·알·꿀",
  "05": "기타 동물성생산품", "06": "산수목·꽃", "07": "채소", "08": "과실·견과",
  "09": "커피·차·향신료", "10": "곡물", "11": "제분공업 생산품", "12": "채유용종자·인삼",
  "13": "식물성 엑스", "14": "식물성 편조물용 재료", "15": "동식물성 유지", "16": "육·어류 조제품",
  "17": "당류·설탕과자", "18": "코코아", "19": "곡물·곡분 조제품", "20": "채소·과실 조제품",
  "21": "기타 조제식료품", "22": "음료·주류·식초", "23": "식품공업 잔재물·사료", "24": "담배",
  "25": "소금·황·토석류", "26": "광·슬랙·회", "27": "광물성연료·에너지", "28": "무기화학품",
  "29": "유기화학품", "30": "의료용품", "31": "비료", "32": "염료·안료·페인트",
  "33": "향료·화장품", "34": "비누·세제·왁스", "35": "단백질·변성전분·효소", "36": "화약류",
  "37": "사진·영화용 재료", "38": "각종 화학공업 생산품", "39": "플라스틱·그 제품", "40": "고무·그 제품",
  "41": "원피·가죽", "42": "가죽제품·핸드백", "43": "모피·인조모피", "44": "목재·목탄",
  "45": "코르크", "46": "조물재료 제품", "47": "펄프", "48": "지·판지",
  "49": "서적·인쇄물", "50": "견", "51": "양모·동물의 털", "52": "면",
  "53": "기타 식물성 섬유", "54": "인조필라멘트", "55": "인조스테이플섬유", "56": "워딩·부직포·로프",
  "57": "양탄자", "58": "특수직물", "59": "도포·침투 직물", "60": "편물",
  "61": "의류(편물제)", "62": "의류(편물제 외)", "63": "기타 섬유제품", "64": "신발류",
  "65": "모자류", "66": "우산·지팡이", "67": "조제깃털·인모제품", "68": "석·시멘트·석면 제품",
  "69": "도자제품", "70": "유리·유리제품", "71": "귀금속·진주", "72": "철강",
  "73": "철강제품", "74": "구리", "75": "니켈", "76": "알루미늄",
  "78": "납", "79": "아연", "80": "주석", "81": "기타 비금속",
  "82": "비금속 공구·날붙이", "83": "각종 비금속제품", "84": "기계류", "85": "전기기기·전자",
  "86": "철도차량", "87": "자동차·일반차량", "88": "항공기", "89": "선박",
  "90": "광학·의료·정밀기기", "91": "시계", "92": "악기", "93": "무기",
  "94": "가구·침구·조명", "95": "완구·운동용구", "96": "잡품", "97": "예술품·골동품",
};

// 챕터 → 운송수단 + 연동 공표운임지수(freight_indices). idx가 있으면 최신 change_pct로 outlook 부여.
// 해당 챕터가 이번 달 상위/적자에 들 때만 input에 포함한다. RoRo·항공처럼 연동 지수가 없으면 idx 생략.
const FREIGHT_LINK: Record<string, { mode: string; idx?: string }> = {
  "27": { mode: "탱커·벌크", idx: "BDI" },
  "29": { mode: "케미컬·탱커" },
  "72": { mode: "벌크", idx: "BDI" },
  "73": { mode: "벌크·컨테이너", idx: "BDI" },
  "84": { mode: "해상 FCL", idx: "SCFI" },
  "85": { mode: "해상 FCL·항공", idx: "SCFI" },
  "87": { mode: "RoRo(자동차선)" },
  "90": { mode: "항공" },
};

function chapterName(ch: string) {
  return HS_CHAPTER[ch] ?? `HS${ch}`;
}

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

function periodDisplay(period6: string): string {
  if (period6.length < 6) throw new Error(`invalid period: ${period6}`);
  return `${period6.slice(0, 4)}.${period6.slice(4, 6)}`;
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

function round(v: number | null, digits = 2): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const m = 10 ** digits;
  return Math.round(v * m) / m;
}

function pctChange(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return round(((curr - prev) / Math.abs(prev)) * 100, 1);
}

function usdToBillion(v: number | null): number | null {
  return round(v == null ? null : v / 1e9, 2);
}

function sharePct(v: number, total: number): number | null {
  if (!total) return null;
  return round((v / total) * 100, 0);
}

function freightOutlook(wow: number | null): string {
  if (wow == null) return "수집 중";
  if (wow > 1) return "상승";
  if (wow < -1) return "보합~약세";
  return "보합";
}

function balanceTrend(current: number | null, previous: number | null): string {
  if (current == null || previous == null) return "판단 보류";
  if (current >= 0 && previous < 0) return "흑자 전환";
  if (current < 0 && previous >= 0) return "적자 전환";
  return Math.abs(current) >= Math.abs(previous) ? "확대" : "축소";
}

// HS 챕터 합계(stat_type='item' → 챕터). RPC가 ≤99행만 반환(1000행 상한 회피).
async function chapterTotals(period6: string): Promise<ChapterRow[]> {
  const { data, error } = await sb.rpc("industry_chapter_totals", { p_period: dbPeriod(period6) });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    chapter: String(r.chapter),
    export_usd: Number(r.export_usd) || 0,
    import_usd: Number(r.import_usd) || 0,
    trade_balance: Number(r.trade_balance) || 0,
  }));
}

async function latestItemPeriod(): Promise<string> {
  const { data, error } = await sb
    .from("trade_statistics")
    .select("period")
    .eq("stat_type", "item")
    .order("period", { ascending: false })
    .limit(1);
  if (error) throw error;
  const period = periodKey((data?.[0] as { period?: string } | undefined)?.period);
  if (!period) throw new Error("no item trade data");
  return period;
}

// 연동 지수(BDI/SCFI 등)의 최신 주간 change_pct → outlook
async function latestFreightByIdx(idxCodes: string[]): Promise<Map<string, { wow: number | null; outlook: string }>> {
  const out = new Map<string, { wow: number | null; outlook: string }>();
  if (!idxCodes.length) return out;
  const { data, error } = await sb
    .from("freight_indices")
    .select("index_code,value,week_date,change_pct")
    .in("index_code", idxCodes)
    .order("week_date", { ascending: false })
    .limit(60);
  if (error) throw error;
  for (const row of (data ?? []) as FreightRow[]) {
    if (out.has(row.index_code)) continue;
    const wow = round(row.change_pct ?? null, 1);
    out.set(row.index_code, { wow, outlook: freightOutlook(wow) });
  }
  return out;
}

// 구조화 지표만 모델에 넘긴다(모델이 숫자를 새로 만들지 못하게). 단위: 십억 USD(B), %.
async function buildInput(): Promise<IndustryBriefInput> {
  const period6 = await latestItemPeriod();
  const [cur, prevYear, prevMonth] = await Promise.all([
    chapterTotals(period6),
    chapterTotals(prevYearPeriod(period6)),
    chapterTotals(addMonths(period6, -1)),
  ]);
  if (!cur.length) throw new Error("no current item rows");

  const pyMap = new Map(prevYear.map((r) => [r.chapter, r]));
  const sum = (rows: ChapterRow[], k: "export_usd" | "import_usd") => rows.reduce((s, r) => s + r[k], 0);
  const totalExp = sum(cur, "export_usd");
  const totalImp = sum(cur, "import_usd");
  const totalBal = totalExp - totalImp;
  const totalExpPY = sum(prevYear, "export_usd");
  const totalExpPM = sum(prevMonth, "export_usd");
  const balPM = sum(prevMonth, "export_usd") - sum(prevMonth, "import_usd");

  const byExport = [...cur].sort((a, b) => b.export_usd - a.export_usd);
  const top1 = byExport[0];

  const topIndustries = byExport.slice(0, 5).map((r) => ({
    hs: r.chapter,
    name: chapterName(r.chapter),
    exp: usdToBillion(r.export_usd),
    share: sharePct(r.export_usd, totalExp),
    yoy: pctChange(r.export_usd, pyMap.get(r.chapter)?.export_usd ?? null),
    balance: usdToBillion(r.trade_balance),
  }));

  // movers: 상위 12개 수출 챕터 중 전년동월 대비 상승폭 큰 3개
  const movers = byExport
    .slice(0, 12)
    .map((r) => ({ hs: r.chapter, name: chapterName(r.chapter), yoy: pctChange(r.export_usd, pyMap.get(r.chapter)?.export_usd ?? null) }))
    .filter((m): m is { hs: string; name: string; yoy: number } => m.yoy != null)
    .sort((a, b) => b.yoy - a.yoy)
    .slice(0, 3);

  // deficit: 무역수지 적자(음수) 큰 3개
  const deficit = [...cur]
    .filter((r) => r.trade_balance < 0)
    .sort((a, b) => a.trade_balance - b.trade_balance)
    .slice(0, 3)
    .map((r) => ({ hs: r.chapter, name: chapterName(r.chapter), balance: usdToBillion(r.trade_balance) }));

  // freightLink: 이번 달 상위/적자 챕터에 해당하는 운송 연결 + (연동 지수 있으면) 최신 운임 신호
  const relevant = new Set([...topIndustries.map((t) => t.hs), ...deficit.map((d) => d.hs)]);
  const linkEntries = Object.entries(FREIGHT_LINK).filter(([ch]) => relevant.has(ch));
  const idxCodes = [...new Set(linkEntries.map(([, v]) => v.idx).filter((x): x is string => !!x))];
  const freightByIdx = await latestFreightByIdx(idxCodes);
  const freightLink = linkEntries.map(([ch, v]) => {
    const f = v.idx ? freightByIdx.get(v.idx) : undefined;
    return {
      hs: ch,
      name: chapterName(ch),
      mode: v.mode,
      ...(v.idx ? { idx: v.idx, wow: f?.wow ?? null, outlook: f?.outlook ?? "수집 중" } : {}),
    };
  });

  return {
    period: periodDisplay(period6),
    totals: {
      exp: usdToBillion(totalExp),
      imp: usdToBillion(totalImp),
      balance: usdToBillion(totalBal),
      expYoY: pctChange(totalExp, totalExpPY),
      expMoM: pctChange(totalExp, totalExpPM),
      balanceTrend: balanceTrend(totalBal, balPM),
    },
    concentration: {
      top1Hs: top1.chapter,
      top1Name: chapterName(top1.chapter),
      top1Share: sharePct(top1.export_usd, totalExp),
    },
    topIndustries,
    movers,
    deficit,
    freightLink,
  };
}

function prompt(input: IndustryBriefInput) {
  return [
    "당신은 한국 물류기업 경영진을 위한 산업·무역 애널리스트입니다.",
    "아래 JSON 수치만 근거로 한국어 산업 브리핑을 작성하세요.",
    "규칙:",
    "- 1문장 결론(두괄식) + 2~3문장 근거. 총 3문장 이내.",
    "- 입력에 없는 수치/HS코드/산업명을 만들거나 변형하지 말 것. 숫자는 그대로 인용.",
    "- 산업 변화와 물류(운송수단·운임)의 연결을 1개 이상 언급(예: 자동차 수출↑ → RoRo 선복 타이트).",
    "- 수출 집중도(top1 비중) 또는 최대 적자 산업 중 1개를 반드시 언급.",
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

async function callDeepSeek(input: IndustryBriefInput) {
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
      .from("industry_briefs")
      .select("input_hash")
      .eq("period", input.period)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.input_hash === input_hash) {
      return Response.json({ ok: true, skipped: true, period: input.period });
    }

    const brief = await callDeepSeek(input);
    const { error } = await sb.from("industry_briefs").upsert({
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
