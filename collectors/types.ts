// collectors/types.ts

export interface NewsItem {
  title: string;
  url: string;
  published_at: string;
  summary_en: string;
  source: string;
  content?: string;          // 기사 본문 발췌 (최대 ~2500자)
  og_image?: string;
  importance_score?: number;
  translated_ko?: string;
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
