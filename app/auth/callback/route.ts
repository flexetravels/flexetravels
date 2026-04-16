// ─── OAuth Callback Handler ──────────────────────────────────────────────────
// Handles the redirect from Google OAuth → exchanges code for session.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const rawNext = searchParams.get('next') ?? '/chat';
  // Validate redirect target: must be a relative path, not a protocol-relative URL
  // or path traversal, to prevent open redirect attacks.
  const safePath = rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.includes('..')
    ? rawNext
    : '/chat';
  // Use the public app URL — request.url may reflect the internal Railway proxy
  // address (localhost:8080) rather than the public domain.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.flexetravels.com';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${appUrl}${safePath}`);
    }
  }

  // Auth failed — redirect to login with error
  return NextResponse.redirect(`${appUrl}/login?error=auth_failed`);
}
