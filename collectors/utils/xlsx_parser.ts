// collectors/utils/xlsx_parser.ts
// Maps xlsx column headers (EN/中/RU) to CADI milestone codes.
// Update MILESTONE_KEYWORDS when CADI_Spec_v1.1 (5·6절) is available.

import * as XLSX from 'xlsx';

export type MilestoneCode =
  | 'ORIGIN_DEP'
  | 'SEA_TS_ARR'
  | 'RAIL_DEP_CN'
  | 'KASHI_ARR'
  | 'KASHI_BONDED'
  | 'TRUCK_DEP'
  | 'XIAN_HUB'
  | 'CN_BORDER'
  | 'KG_UZ_BORDER'
  | 'DEST_ARR';

export type DateVariant = 'planned' | 'actual';

export interface MilestoneCell {
  milestone: MilestoneCode;
  variant: DateVariant;
  colIndex: number;
}

// Keywords that map to each milestone (case-insensitive substring match).
// Add aliases from CADI_Spec_v1.1 when received.
const MILESTONE_KEYWORDS: Array<{
  milestone: MilestoneCode;
  variant: DateVariant;
  keywords: string[];
}> = [
  { milestone: 'ORIGIN_DEP',   variant: 'planned', keywords: ['etd', 'origin dep', 'pol etd', '起运计划', '出发计划', 'отправление план'] },
  { milestone: 'ORIGIN_DEP',   variant: 'actual',  keywords: ['atd', 'origin actual', 'actual dep', '实际起运', '出发实际', 'отправление факт'] },
  { milestone: 'SEA_TS_ARR',   variant: 'planned', keywords: ['sea arr plan', 'transit port plan', 'sea eta', '中转港计划', 'мор прибытие план'] },
  { milestone: 'SEA_TS_ARR',   variant: 'actual',  keywords: ['sea arr act', 'transit port act', 'sea ata', '中转港实际', 'мор прибытие факт'] },
  { milestone: 'RAIL_DEP_CN',  variant: 'planned', keywords: ['rail dep plan', 'cre dep plan', '铁路出发计划', 'жд отправление план'] },
  { milestone: 'RAIL_DEP_CN',  variant: 'actual',  keywords: ['rail dep act', 'cre dep act', '铁路出发实际', 'жд отправление факт'] },
  { milestone: 'KASHI_ARR',    variant: 'planned', keywords: ['kashi plan', 'kashgar plan', 'urumqi plan', '喀什计划', '乌鲁木齐计划', 'каши план'] },
  { milestone: 'KASHI_ARR',    variant: 'actual',  keywords: ['kashi act', 'kashgar act', 'urumqi act', '喀什实际', '乌鲁木齐实际', 'каши факт'] },
  { milestone: 'KASHI_BONDED', variant: 'planned', keywords: ['bonded plan', 'kashi bond plan', '监管仓计划', 'таможня план'] },
  { milestone: 'KASHI_BONDED', variant: 'actual',  keywords: ['bonded act', 'kashi bond act', '监管仓实际', 'таможня факт'] },
  { milestone: 'TRUCK_DEP',    variant: 'planned', keywords: ['truck dep plan', 'road dep plan', '卡车出发计划', 'авто отправление план'] },
  { milestone: 'TRUCK_DEP',    variant: 'actual',  keywords: ['truck dep act', 'road dep act', '卡车出发实际', 'авто отправление факт'] },
  { milestone: 'XIAN_HUB',     variant: 'planned', keywords: ["xi'an plan", 'xian plan', '西安计划', 'сиань план'] },
  { milestone: 'XIAN_HUB',     variant: 'actual',  keywords: ["xi'an act", 'xian act', '西安实际', 'сиань факт'] },
  { milestone: 'CN_BORDER',    variant: 'planned', keywords: ['cn border plan', 'china border plan', 'border exit plan', '中国出境计划', 'граница кнр план'] },
  { milestone: 'CN_BORDER',    variant: 'actual',  keywords: ['cn border act', 'china border act', 'border exit act', '中国出境实际', 'граница кнр факт'] },
  { milestone: 'KG_UZ_BORDER', variant: 'planned', keywords: ['kg border plan', 'uz border plan', 'kz border plan', 'ca border plan', '中亚边境计划', 'граница ца план'] },
  { milestone: 'KG_UZ_BORDER', variant: 'actual',  keywords: ['kg border act', 'uz border act', 'kz border act', 'ca border act', '中亚边境实际', 'граница ца факт'] },
  { milestone: 'DEST_ARR',     variant: 'planned', keywords: ['eta', 'dest eta', 'destination plan', 'arr plan', '目的地计划', '到达计划', 'прибытие план'] },
  { milestone: 'DEST_ARR',     variant: 'actual',  keywords: ['ata', 'dest act', 'destination act', 'arr act', '目的地实际', '到达实际', 'прибытие факт'] },
];

/** Detect route/lane type from file path or sampled cell values */
export function detectLane(filePath: string, cellValues: string[]): string {
  const combined = [filePath, ...cellValues].join(' ').toLowerCase();
  if (combined.includes('titr') || combined.includes('middle corridor') || combined.includes('caspian')) return 'TITR';
  if (combined.includes('tsr') || combined.includes('siberia') || combined.includes('владивосток') || combined.includes('vladivostok')) return 'TSR';
  if (combined.includes('mongol') || combined.includes('tmgr')) return 'TMGR';
  if (combined.includes('manchur') || combined.includes('tmr') || combined.includes('manzhouli')) return 'TMR';
  return 'TCR'; // default: most common MTL route
}

/**
 * Detect route pattern (kashi / khorgos / tsr) per CADI spec 4절.
 * kashi  = Qingdao→Kashi→truck→KG/UZ (Bishkek, Osh, Andijan, Tashkent, Chukursay)
 * khorgos = Qingdao→Xian→Khorgos/Dostyk→Almaty/MALA
 * tsr    = via Russia/Vladivostok (TSR)
 */
export function detectRoutePattern(
  filePath: string,
  cellValues: string[]
): 'kashi' | 'khorgos' | 'tsr' | null {
  const combined = [filePath, ...cellValues].join(' ').toLowerCase();

  const kashiHints = ['kashi', 'kashgar', '喀什', 'bishkek', '比什凯克', 'osh', '奥什',
    'andijan', '安集延', 'chukursay', 'fergana', 'tashkent', '塔什干', 'kg border', 'kg-uz'];
  const khorgosHints = ['khorgos', 'khorgas', '霍尔果斯', 'altynkol', 'dostyk', '多斯托克',
    'almaty', '阿拉木图', 'mala', 'malaszewicze', 'xian hub', '西安', 'кз граница'];
  const tsrHints = ['vladivostok', 'владивосток', 'tsr', 'trans-siberian', 'zabaykalsk'];

  const kashiScore   = kashiHints.filter(h => combined.includes(h)).length;
  const khorgosScore = khorgosHints.filter(h => combined.includes(h)).length;
  const tsrScore     = tsrHints.filter(h => combined.includes(h)).length;

  const max = Math.max(kashiScore, khorgosScore, tsrScore);
  if (max === 0) return null;
  if (tsrScore === max) return 'tsr';
  if (khorgosScore >= kashiScore) return 'khorgos';
  return 'kashi';
}

/**
 * Detect final destination city from file path or sampled cell values.
 * Returns the most specific match, or null if ambiguous.
 */
export function detectDestination(filePath: string, cellValues: string[]): string | null {
  const combined = [filePath, ...cellValues].join(' ').toLowerCase();

  if (combined.includes('andijan') || combined.includes('안디잔') || combined.includes('安集延')) return 'Andijan';
  if (combined.includes('chukursay') || combined.includes('추쿠르사이')) return 'Chukursay';
  if (combined.includes('tashkent') || combined.includes('타슈켄트') || combined.includes('塔什干')) return 'Tashkent';
  if (combined.includes('bishkek') || combined.includes('비슈켁') || combined.includes('比什凯克')) return 'Bishkek';
  if (combined.includes('osh') || combined.includes('오쉬') || combined.includes('奥什')) return 'Osh';
  if (combined.includes('mala') || combined.includes('malaszewicze')) return 'MALA';
  if (combined.includes('almaty') || combined.includes('알마티') || combined.includes('阿拉木图')) return 'Almaty';
  return null;
}

/** Try rows 0–4 for the one with the most milestone keyword hits */
function findHeaderRow(sheet: XLSX.WorkSheet): number {
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1');
  let bestRow = 0;
  let bestCount = 0;

  for (const rowIdx of [0, 1, 2, 3, 4]) {
    if (rowIdx > range.e.r) break;
    let matchCount = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIdx, c })];
      if (!cell) continue;
      const v = String(cell.v ?? '').toLowerCase();
      if (MILESTONE_KEYWORDS.some(m => m.keywords.some(kw => v.includes(kw)))) matchCount++;
    }
    if (matchCount > bestCount) {
      bestCount = matchCount;
      bestRow = rowIdx;
    }
  }
  return bestRow;
}

/** Map columns in header row to milestone descriptors */
function mapHeaders(sheet: XLSX.WorkSheet, headerRow: number): MilestoneCell[] {
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1');
  const cells: MilestoneCell[] = [];

  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c })];
    if (!cell) continue;
    const v = String(cell.v ?? '').toLowerCase();
    for (const m of MILESTONE_KEYWORDS) {
      if (m.keywords.some(kw => v.includes(kw))) {
        cells.push({ milestone: m.milestone, variant: m.variant, colIndex: c });
        break;
      }
    }
  }
  return cells;
}

/** Normalize a cell value to ISO string or null. Returns flag on parse issues. */
export function normalizeDate(cell: XLSX.CellObject | undefined): {
  iso: string | null;
  flag: string | null;
} {
  if (!cell) return { iso: null, flag: null };
  const v = cell.v;

  // Excel serial number
  if (cell.t === 'n' && typeof v === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(v);
      if (d) {
        const dt = new Date(Date.UTC(d.y, d.m - 1, d.d, d.H ?? 0, d.M ?? 0, d.S ?? 0));
        return { iso: dt.toISOString(), flag: null };
      }
    } catch {
      // fall through
    }
    return { iso: null, flag: `invalid_excel_serial:${v}` };
  }

  // String date
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return { iso: null, flag: null };

    // Try direct parse (handles ISO, most locales)
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const flag = s.match(/^\d{4}-\d{2}-\d{2}/) ? null : 'date_string_parsed';
      return { iso: d.toISOString(), flag };
    }

    // DD/MM/YYYY fallback
    const dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmyMatch) {
      const attempt = new Date(`${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`);
      if (!isNaN(attempt.getTime())) return { iso: attempt.toISOString(), flag: 'dmy_format' };
    }

    return { iso: null, flag: `date_parse_failed:${s.slice(0, 30)}` };
  }

  if (v instanceof Date) {
    return { iso: (v as Date).toISOString(), flag: null };
  }

  return { iso: null, flag: `unknown_cell_type:${cell.t}` };
}

export interface ParsedShipment {
  shipmentRef: string;
  weekIso: string;
  laneId: string;
  routePattern: 'kashi' | 'khorgos' | 'tsr' | null;  // spec 4절
  destination: string | null;                           // 'Andijan','Almaty','Bishkek',...
  milestones: Array<{
    milestone: MilestoneCode;
    plannedAt: string | null;
    actualAt: string | null;
    delayHours: number | null;
    flag: string | null;
  }>;
}

/** Parse one xlsx file → array of ParsedShipment */
export function parseXlsx(filePath: string): ParsedShipment[] {
  const workbook = XLSX.readFile(filePath);
  const results: ParsedShipment[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) continue;

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const headerRow = findHeaderRow(sheet);
    const mappedCols = mapHeaders(sheet, headerRow);

    if (mappedCols.length === 0) {
      console.warn(`⚠️  [${filePath}] sheet "${sheetName}": milestone columns not found — skipping`);
      continue;
    }

    // Sample values for lane/pattern/destination detection
    const sampleValues: string[] = [];
    for (let r = headerRow; r <= Math.min(headerRow + 5, range.e.r); r++) {
      for (let c = range.s.c; c <= Math.min(range.s.c + 10, range.e.c); c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell) sampleValues.push(String(cell.v ?? ''));
      }
    }
    // Include sheet name as a strong signal
    const signalValues = [sheetName, ...sampleValues];
    const laneId       = detectLane(filePath, signalValues);
    const routePattern = detectRoutePattern(filePath, signalValues);
    const destination  = detectDestination(filePath, signalValues);

    // Group planned/actual by milestone
    const milestoneMap = new Map<MilestoneCode, { plannedIdx: number | null; actualIdx: number | null }>();
    for (const mc of mappedCols) {
      if (!milestoneMap.has(mc.milestone)) {
        milestoneMap.set(mc.milestone, { plannedIdx: null, actualIdx: null });
      }
      const entry = milestoneMap.get(mc.milestone)!;
      if (mc.variant === 'planned') entry.plannedIdx = mc.colIndex;
      else entry.actualIdx = mc.colIndex;
    }

    // First non-header col assumed to be shipment ref
    const refColIdx = range.s.c;

    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const refCell = sheet[XLSX.utils.encode_cell({ r, c: refColIdx })];
      const rawRef = refCell ? String(refCell.v ?? '').trim() : '';
      if (!rawRef) continue;

      // ISO week from ORIGIN_DEP
      let weekIso = '2026-W00';
      const originEntry = milestoneMap.get('ORIGIN_DEP');
      if (originEntry) {
        const origPlanned = normalizeDate(
          originEntry.plannedIdx !== null
            ? sheet[XLSX.utils.encode_cell({ r, c: originEntry.plannedIdx })]
            : undefined
        );
        const origActual = normalizeDate(
          originEntry.actualIdx !== null
            ? sheet[XLSX.utils.encode_cell({ r, c: originEntry.actualIdx })]
            : undefined
        );
        const isoStr = origActual.iso ?? origPlanned.iso;
        if (isoStr) {
          const d = new Date(isoStr);
          const jan4 = new Date(d.getFullYear(), 0, 4);
          const weekNum = Math.ceil(
            (((d.getTime() - jan4.getTime()) / 86_400_000) + jan4.getDay() + 1) / 7
          );
          weekIso = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
        }
      }

      // Anonymize: include file + row index (not real B/L)
      const fileName = filePath.replace(/.*[\\/]/, '');
      const shipmentRef = `${fileName}:row${r}:${rawRef.slice(0, 8)}`;

      const shipment: ParsedShipment = { shipmentRef, weekIso, laneId, routePattern, destination, milestones: [] };

      for (const [milestone, { plannedIdx, actualIdx }] of milestoneMap) {
        const planned = normalizeDate(
          plannedIdx !== null ? sheet[XLSX.utils.encode_cell({ r, c: plannedIdx })] : undefined
        );
        const actual = normalizeDate(
          actualIdx !== null ? sheet[XLSX.utils.encode_cell({ r, c: actualIdx })] : undefined
        );

        let delayHours: number | null = null;
        if (planned.iso && actual.iso) {
          delayHours = (new Date(actual.iso).getTime() - new Date(planned.iso).getTime()) / 3_600_000;
        }

        shipment.milestones.push({
          milestone,
          plannedAt: planned.iso,
          actualAt: actual.iso,
          delayHours,
          flag: planned.flag ?? actual.flag ?? null,
        });
      }

      results.push(shipment);
    }
  }

  return results;
}

/** Group ParsedShipment[] into buckets keyed by lane+week+milestone+routePattern */
export function aggregateWeekly(
  shipments: ParsedShipment[]
): Map<string, {
  laneId: string;
  weekIso: string;
  milestone: MilestoneCode;
  routePattern: 'kashi' | 'khorgos' | 'tsr' | null;
  destination: string | null;
  delayHours: number[];
}> {
  const buckets = new Map<
    string,
    {
      laneId: string;
      weekIso: string;
      milestone: MilestoneCode;
      routePattern: 'kashi' | 'khorgos' | 'tsr' | null;
      destination: string | null;
      delayHours: number[];
    }
  >();

  for (const s of shipments) {
    for (const m of s.milestones) {
      if (m.delayHours === null) continue;
      const key = `${s.laneId}|${s.weekIso}|${m.milestone}|${s.routePattern ?? ''}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          laneId: s.laneId,
          weekIso: s.weekIso,
          milestone: m.milestone,
          routePattern: s.routePattern,
          destination: s.destination,
          delayHours: [],
        });
      }
      buckets.get(key)!.delayHours.push(m.delayHours);
    }
  }
  return buckets;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function p90(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(0.9 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function dataQuality(n: number): 'confirmed' | 'provisional' | 'indicative' {
  if (n >= 5) return 'confirmed';
  if (n >= 2) return 'provisional';
  return 'indicative';
}
