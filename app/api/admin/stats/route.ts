// ─── Admin: Aggregate Stats API ───────────────────────────────────────────────
// GET /api/admin/stats
// Returns API health summary, booking success rates, search counts for last 1h.

import { NextResponse } from 'next/server';
import { getLogStats } from '@/lib/logger';

function checkAuth(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return true;
  const headerSecret = req.headers.get('x-admin-secret');
  const url          = new URL(req.url);
  const querySecret  = url.searchParams.get('secret');
  return headerSecret === secret || querySecret === secret;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(getLogStats());
}
