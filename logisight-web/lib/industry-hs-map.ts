// 산업 섹션 ↔ HS코드 매핑
// 관세청 수출입무역통계 HS코드 기준

export const INDUSTRY_HS_MAP = {
  '배터리·전기차': {
    hsCodes: ['8507', '850760'],         // 축전지, 리튬이온전지
    icon: 'bolt',
    label: '배터리·전기차',
    newsOnly: false,
  },
  '자동차': {
    hsCodes: ['8703', '8704', '8708'],   // 승용차, 화물차, 부품
    icon: 'car',
    label: '자동차',
    newsOnly: false,
  },
  '냉동냉장': {
    hsCodes: ['0303', '0307', '0207', '2106'], // 냉동어류, 냉동연체동물, 냉동육류, 조제식료품
    icon: 'snowflake',
    label: '냉동냉장 (콜드체인)',
    newsOnly: false,
  },
  // 이커머스는 HS코드로 직접 매핑 불가 (채널이지 품목이 아님) → 뉴스 기반 유지
  '이커머스': {
    hsCodes: [] as string[],
    icon: 'shopping-cart',
    label: '이커머스',
    newsOnly: true,
  },
} as const;

export type IndustryKey = keyof typeof INDUSTRY_HS_MAP;

/**
 * HS코드로 산업 키를 반환.
 * 긴 prefix 우선 매칭 → 없으면 앞 2자리(류) 매칭.
 */
export function getIndustryByHsCode(hsCode: string): IndustryKey | null {
  const normalized = hsCode.replace(/\D/g, '');

  // 1차: 각 hsCodes prefix로 시작하는지 검사 (6자리 > 4자리 순)
  const entries = Object.entries(INDUSTRY_HS_MAP) as [IndustryKey, typeof INDUSTRY_HS_MAP[IndustryKey]][];
  for (const [key, def] of entries) {
    const sorted = [...def.hsCodes].sort((a, b) => b.length - a.length); // 긴 것 우선
    for (const prefix of sorted) {
      if (normalized.startsWith(prefix)) return key;
    }
  }

  // 2차: 앞 2자리(류)만으로 매칭
  const chapter = normalized.slice(0, 2);
  for (const [key, def] of entries) {
    for (const prefix of def.hsCodes) {
      if (prefix.slice(0, 2) === chapter) return key;
    }
  }

  return null;
}

/** 산업 키로 hsCodes 배열 반환 */
export function getHsCodesByIndustry(key: IndustryKey): readonly string[] {
  return INDUSTRY_HS_MAP[key].hsCodes;
}
