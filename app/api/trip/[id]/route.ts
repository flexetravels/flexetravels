// ─── /api/trip/[id] ─────────────────────────────────────────────────────────
// GET returns the canvas state. PATCH updates it (full state replacement,
// debounced on the client). Authorization is sessionId-based: only the
// session that created the canvas can read or modify it (until we have auth).
//
// Gated by middleware (NEXT_PUBLIC_TRIP_CANVAS).

import { NextRequest, NextResponse } from 'next/server';
import { db, DB_AVAILABLE } from '@/lib/db/client';
import { CANVAS_VERSION, type CanvasState } from '@/lib/canvas/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_STATE_BYTES = 200 * 1024; // 200 KB — generous; a typical canvas is < 30 KB

function sanitizeSessionId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 100) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// Lightweight runtime validation — full schema validation happens in the reducer.
function isValidCanvasState(input: unknown): input is CanvasState {
  if (!input || typeof input !== 'object') return false;
  const s = input as Record<string, unknown>;
  if (s.version !== CANVAS_VERSION) return false;
  if (typeof s.title !== 'string' || s.title.length > 200) return false;
  if (!s.travellers || typeof s.travellers !== 'object') return false;
  const t = s.travellers as Record<string, unknown>;
  if (typeof t.adults !== 'number' || typeof t.children !== 'number') return false;
  if (!Array.isArray(s.legs)) return false;
  if (s.legs.length > 20) return false; // hard cap on leg count
  return true;
}

function summarizeCanvasState(state: CanvasState): Record<string, unknown> {
  return {
    title: state.title,
    homeOrigin: state.homeOrigin,
    travellers: state.travellers,
    legCount: state.legs.length,
    selectedFlights: state.legs.filter(l => l.flight).length,
    selectedHotels: state.legs.filter(l => l.hotel).length,
    interests: state.meta?.interests ?? [],
    travelDocs: state.meta?.travelDocs
      ? {
          passportCountry: state.meta.travelDocs.passportCountry,
          visaCountries: state.meta.travelDocs.visaCountries ?? [],
        }
      : undefined,
    legs: state.legs.map((l, i) => ({
      position: i + 1,
      legId: l.id,
      city: l.city,
      iata: l.iata,
      startDate: l.startDate,
      endDate: l.endDate,
      hasFlight: Boolean(l.flight),
      hasHotel: Boolean(l.hotel),
      hasItinerary: Boolean(l.itinerary),
    })),
  };
}

// ── GET: read canvas ─────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!DB_AVAILABLE) {
    return NextResponse.json({ error: 'Persistence is not configured' }, { status: 503 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });
  }

  const view      = req.nextUrl.searchParams.get('view');
  const isShared  = view === 'shared';
  const sessionId = sanitizeSessionId(req.nextUrl.searchParams.get('sessionId'));

  // Owner mode requires a sessionId. Shared mode never requires one (the URL
  // itself is the capability — anyone with the link can read).
  if (!isShared && !sessionId) {
    return NextResponse.json({ error: 'Missing or invalid sessionId' }, { status: 400 });
  }

  const row = await db.tripsCanvas.get(id);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (isShared) {
    // Shared / read-only response. Strip anything that could leak the owner's
    // identity (session_id, user_id) and never include the title's internal
    // metadata. The recipient can read but can't PATCH (PATCH still enforces
    // sessionId match).
    return NextResponse.json({
      id:        row.id,
      title:     row.title,
      status:    row.status,
      state:     row.state,
      updatedAt: row.updated_at,
      readOnly:  true,
    });
  }

  // Owner mode: enforce sessionId match.
  if (row.session_id !== sessionId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    id:        row.id,
    title:     row.title,
    status:    row.status,
    state:     row.state,
    updatedAt: row.updated_at,
    readOnly:  false,
  });
}

// ── PATCH: update canvas state / title ───────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!DB_AVAILABLE) {
    return NextResponse.json({ error: 'Persistence is not configured' }, { status: 503 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });
  }

  const rawText = await req.text();
  if (rawText.length > MAX_STATE_BYTES) {
    return NextResponse.json({ error: 'Canvas state too large' }, { status: 413 });
  }

  let body: { sessionId?: string; state?: CanvasState; title?: string } = {};
  try {
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sessionId = sanitizeSessionId(body.sessionId);
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing or invalid sessionId' }, { status: 400 });
  }

  // Verify ownership before any write
  const existing = await db.tripsCanvas.get(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.session_id !== sessionId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};

  if (body.state !== undefined) {
    if (!isValidCanvasState(body.state)) {
      return NextResponse.json({ error: 'Invalid canvas state' }, { status: 400 });
    }
    patch.state = body.state;
    if (typeof body.state.title === 'string') patch.title = body.state.title.slice(0, 200);
  }

  if (typeof body.title === 'string') {
    patch.title = body.title.slice(0, 200);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const updated = await db.tripsCanvas.update(id, patch);
  if (!updated) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  if (body.state) {
    db.tripActivityEvents.create({
      session_id: sessionId,
      trip_canvas_id: id,
      event_type: 'canvas_state_patched',
      payload: {
        summary: summarizeCanvasState(body.state),
        titleChanged: typeof body.title === 'string' || body.state.title !== existing.title,
      },
    }).catch(() => {});

    const interests = body.state.meta?.interests ?? [];
    if (interests.length > 0) {
      db.customerPreferenceSignals.createMany(interests.map(interest => ({
        session_id: sessionId,
        trip_canvas_id: id,
        signal_type: 'interest',
        signal_value: interest,
        source: 'vibe',
        metadata: { title: body.state?.title },
      }))).catch(() => {});
    }
  }

  return NextResponse.json({
    id:        updated.id,
    title:     updated.title,
    status:    updated.status,
    state:     updated.state,
    updatedAt: updated.updated_at,
  });
}
