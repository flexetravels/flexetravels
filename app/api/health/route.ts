// ─── Health Check Endpoint ─────────────────────────────────────────────────────
// GET /api/health — quick sanity check for DB connectivity and env vars.
// Useful for diagnosing Railway deployment issues without doing a full booking.
//
// Returns:
//   { ok: true, db: true,  tables: ['trips','bookings',...] }   — fully healthy
//   { ok: true, db: false, reason: '...' }                      — DB not reachable
//   { ok: false, error: '...' }                                 — unexpected error

import { NextResponse } from 'next/server';
import { DB_AVAILABLE } from '@/lib/db/client';

export async function GET() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL ?? '';
    const serviceKey  =
      process.env.SUPABASE_SERVICE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      '';

    if (!DB_AVAILABLE) {
      const missing = [];
      if (!supabaseUrl)  missing.push('SUPABASE_URL');
      if (!serviceKey)   missing.push('SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)');
      return NextResponse.json({
        ok:     true,
        db:     false,
        reason: `Missing env vars: ${missing.join(', ')}`,
      });
    }

    // Ping the trips table — just count rows (fast, low-cost)
    const res = await fetch(
      `${supabaseUrl}/rest/v1/trips?select=id&limit=1`,
      {
        headers: {
          apikey:        serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        signal: AbortSignal.timeout(5_000),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({
        ok:     true,
        db:     false,
        reason: `Supabase responded ${res.status}: ${body.slice(0, 200)}`,
      });
    }

    const rows = await res.json() as unknown[];

    return NextResponse.json({
      ok:           true,
      db:           true,
      supabase_url: supabaseUrl.slice(0, 40) + '…',
      trips_ping:   `${rows.length} row(s) sampled`,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e) },
      { status: 500 },
    );
  }
}
