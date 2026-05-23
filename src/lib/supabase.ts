// src/lib/supabase.ts
// ⚠️ CLAUDE.md 3.3 — 사용자 확인 영역 (frontend anon client only)
// service_role key는 절대 사용 금지 (Edge Functions에서만)
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — .env.local을 확인하세요'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
