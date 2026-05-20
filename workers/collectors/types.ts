// workers/collectors/types.ts

export interface NewsItem {
  title: string;
  url: string;
  published_at: string;
  summary_en: string;
  source: string;
  og_image?: string;       // OG image URL (있으면 뉴스레터 이미지로 사용)
  importance_score?: number; // 0~10, AI 평가
  translated_ko?: string;  // AI 번역 결과
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
  section: 'shipping' | 'air' | 'rail' | 'trade';
  data: CollectorData[];
}
