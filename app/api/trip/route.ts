// ─── /api/trip ───────────────────────────────────────────────────────────────
// POST creates a new trip canvas. GET lists canvases for the current session.
//
// Gated by middleware (NEXT_PUBLIC_TRIP_CANVAS=true OR ft_canvas=1 cookie).
// Degrades gracefully if Supabase isn't configured — returns 503.

import { NextRequest, NextResponse } from 'next/server';
import { db, DB_AVAILABLE } from '@/lib/db/client';
import { emptyCanvas } from '@/lib/canvas/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TITLE_LEN = 200;

function sanitizeSessionId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 100) return null;
  // session ids must be alphanumeric / underscore — same shape as generateSessionId()
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

// ── POST: create a new canvas ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!DB_AVAILABLE) {
    return NextResponse.json({ error: 'Persistence is not configured' }, { status: 503 });
  }

  let body: { sessionId?: string; title?: string; from?: 'new' | 'chat' | 'shared' } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sessionId = sanitizeSessionId(body.sessionId);
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing or invalid sessionId' }, { status: 400 });
  }

  const title = (body.title ?? 'Untitled trip').toString().slice(0, MAX_TITLE_LEN);
  const state = emptyCanvas({ title, meta: { createdFrom: body.from ?? 'new' } });

  const row = await db.tripsCanvas.create({
    session_id: sessionId,
    title,
    state,
    status: 'planning',
  });

  if (!row) {
    console.error('[/api/trip POST] db.tripsCanvas.create returned null — check earlier [DB] logs for the Supabase response');
    return NextResponse.json({ error: 'Failed to create trip canvas' }, { status: 500 });
  }
  console.log('[/api/trip POST] created canvas row:', row.id);

  return NextResponse.json({ id: row.id, state: row.state, updatedAt: row.updated_at }, { status: 201 });
}

// ── GET: list canvases for a session ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!DB_AVAILABLE) {
    return NextResponse.json({ error: 'Persistence is not configured' }, { status: 503 });
  }

  const sessionId = sanitizeSessionId(req.nextUrl.searchParams.get('sessionId'));
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing or invalid sessionId' }, { status: 400 });
  }

  const rows = await db.tripsCanvas.listBySession(sessionId, 20);

  return NextResponse.json({
    trips: rows.map(r => ({
      id:        r.id,
      title:     r.title,
      status:    r.status,
      updatedAt: r.updated_at,
      legCount:  Array.isArray(r.state?.legs) ? r.state.legs.length : 0,
    })),
  });
}
