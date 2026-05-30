// collectors/types.ts

export interface NewsItem {
  title: string;
  url: string;
  published_at: string;
  summary_en: string;
  source: string;
  og_image?: string;       // OG image URL (ìžˆìœ¼ë©´ ë‰´ìŠ¤ë ˆí„° ì´ë¯¸ì§€ë¡œ ì‚¬ìš©)
  importance_score?: number; // 0~10, AI í‰ê°€
  translated_ko?: string;  // AI ë²ˆì—­ ê²°ê³¼
}

export interface CollectorData {
  data_type: string;
  data_key: string;
  data_value: any;
  source: string;
  source_url?: string;
  is_complete: boolean;
  error_message?: string;
}

export interface CollectorResult {
  section: 'shipping' | 'air' | 'rail' | 'trade' | 'carrier_advisory' | 'risk';
  data: CollectorData[];
}
