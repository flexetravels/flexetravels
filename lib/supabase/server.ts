// ─── Server-side Supabase client ──────────────────────────────────────────────
// Used in Server Components, API routes, and middleware for auth session management.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Stub when auth is not configured
    return { auth: { exchangeCodeForSession: async () => ({ error: new Error('Not configured') }), getSession: async () => ({ data: { session: null }, error: null }) } } as ReturnType<typeof createServerClient>;
  }

  const cookieStore = await cookies();

  return createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll can fail in Server Components (read-only cookies).
            // This is safe to ignore — the middleware will refresh the session.
          }
        },
      },
    },
  );
}
