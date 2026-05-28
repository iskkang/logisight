// Server-side Supabase client factory.
// Use in async Server Components (default for App Router pages).
// Creates a fresh client per request — no session persistence.

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabase = !!(url && anonKey);

export function createServerClient() {
  if (!hasSupabase) {
    throw new Error('Supabase env vars missing. Check .env.local');
  }
  return createClient(url!, anonKey!, {
    auth: { persistSession: false },
  });
}
