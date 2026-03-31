// ─── Browser-side Supabase client ─────────────────────────────────────────────
// Used in 'use client' components for auth operations (sign in, sign out, session).

import { createBrowserClient } from '@supabase/ssr';

let _client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Return a minimal stub when auth is not configured (local dev without env vars)
    return { auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }), signInWithOAuth: async () => ({ error: new Error('Supabase not configured') }), signOut: async () => ({}) } } as ReturnType<typeof createBrowserClient>;
  }
  _client = createBrowserClient(url, key);
  return _client;
}
