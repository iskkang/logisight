// Browser-side Supabase client.
// Use this in 'use client' components (e.g. NewsletterCTA insert).
// For server components, use ./server.ts instead.

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabase = !!(url && anonKey);

export const supabase = hasSupabase
  ? createClient(url!, anonKey!, {
      auth: { persistSession: false },
    })
  : null;
