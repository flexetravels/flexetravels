// ─── OAuth Callback Handler ──────────────────────────────────────────────────
// Handles the redirect from Google OAuth → exchanges code for session.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/chat';
  // Use the public app URL — request.url may reflect the internal Railway proxy
  // address (localhost:8080) rather than the public domain.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.flexetravels.com';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${appUrl}${next}`);
    }
  }

  // Auth failed — redirect to login with error
  return NextResponse.redirect(`${appUrl}/login?error=auth_failed`);
}
