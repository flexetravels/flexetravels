// ─── Admin: Duffel Diagnostics ────────────────────────────────────────────────
// GET /api/admin/duffel-check
// Tests Duffel connectivity, checks test balance, and verifies token mode.
// Diagnoses the most common failure causes in one shot.

import { NextResponse } from 'next/server';

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

  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token || token.includes('PASTE')) {
    return NextResponse.json({
      ok: false,
      diagnosis: 'DUFFEL_ACCESS_TOKEN not configured in .env.local',
      fix: 'Add your Duffel test token to .env.local',
    });
  }

  const isTest = token.startsWith('duffel_test_');
  const isLive = token.startsWith('duffel_live_');
  const results: Record<string, unknown> = {
    tokenPresent: true,
    tokenMode:    isTest ? 'test' : isLive ? 'live' : 'unknown',
    tokenPrefix:  token.slice(0, 20) + '…',
  };

  const headers = {
    Authorization:    `Bearer ${token}`,
    'Duffel-Version': 'v2',
    Accept:           'application/json',
  };

  // ── 1. Check Duffel API connectivity ──────────────────────────────────────
  const t0 = Date.now();
  try {
    const pingRes = await fetch('https://api.duffel.com/air/airlines?limit=1', {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    results.connectivity = {
      ok:         pingRes.ok,
      httpStatus: pingRes.status,
      latencyMs:  Date.now() - t0,
    };
    if (!pingRes.ok) {
      const txt = await pingRes.text();
      (results.connectivity as Record<string, unknown>).error = txt.slice(0, 200);
    }
  } catch (e) {
    results.connectivity = { ok: false, error: String(e), latencyMs: Date.now() - t0 };
  }

  // ── 2. Check balance (test mode only) ────────────────────────────────────
  if (isTest) {
    const t1 = Date.now();
    try {
      const balRes = await fetch('https://api.duffel.com/air/balance', {
        headers,
        signal: AbortSignal.timeout(8_000),
      });
      if (balRes.ok) {
        const balJson = await balRes.json() as {
          data?: { available_balance?: string; currency?: string }
        };
        const bal      = balJson.data?.available_balance ?? '0';
        const balNum   = parseFloat(bal);
        results.balance = {
          ok:               true,
          availableBalance: bal,
          currency:         balJson.data?.currency ?? 'USD',
          latencyMs:        Date.now() - t1,
          isLow:            balNum < 100,
          warning:          balNum < 100
            ? `⚠ Balance is ${bal} — may be too low for flight bookings. Top up at app.duffel.com → Settings → Balance`
            : null,
        };
      } else {
        const txt = await balRes.text();
        results.balance = { ok: false, httpStatus: balRes.status, error: txt.slice(0, 200), latencyMs: Date.now() - t1 };
      }
    } catch (e) {
      results.balance = { ok: false, error: String(e) };
    }
  } else {
    results.balance = { note: 'Balance check only available for test tokens' };
  }

  // ── 3. Try creating a minimal offer request (smoke test) ─────────────────
  const t2 = Date.now();
  try {
    const offerRes = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          slices:     [{ origin: 'YVR', destination: 'JFK', departure_date: '2026-06-01' }],
          passengers: [{ type: 'adult' }],
          cabin_class: 'economy',
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (offerRes.ok) {
      const offerJson = await offerRes.json() as {
        data?: { offers?: Array<{ id: string; total_amount: string; total_currency: string }> }
      };
      const offers = offerJson.data?.offers ?? [];
      results.offerSmoke = {
        ok:           true,
        offersFound:  offers.length,
        latencyMs:    Date.now() - t2,
        sampleOffer:  offers[0]
          ? { id: offers[0].id.slice(0, 20) + '…', total: `${offers[0].total_amount} ${offers[0].total_currency}` }
          : null,
      };
    } else {
      const txt  = await offerRes.text();
      const body = (() => { try { return JSON.parse(txt); } catch { return {}; } })() as Record<string, unknown>;
      const errs = (body as { errors?: Array<{ code?: string; message?: string }> }).errors;
      results.offerSmoke = {
        ok:         false,
        httpStatus: offerRes.status,
        errorCode:  errs?.[0]?.code,
        error:      errs?.[0]?.message ?? txt.slice(0, 200),
        latencyMs:  Date.now() - t2,
      };
    }
  } catch (e) {
    results.offerSmoke = { ok: false, error: String(e), latencyMs: Date.now() - t2 };
  }

  // ── 4. Root-cause diagnosis ───────────────────────────────────────────────
  const diagnoses: string[] = [];
  const fixes: string[] = [];

  const conn   = results.connectivity as Record<string, unknown>;
  const bal    = results.balance      as Record<string, unknown>;
  const smoke  = results.offerSmoke   as Record<string, unknown>;

  if (!conn?.ok) {
    diagnoses.push('❌ Cannot reach Duffel API — check internet/firewall');
    fixes.push('Verify network connectivity from your server to api.duffel.com');
  }
  if (isTest && bal?.isLow) {
    diagnoses.push('❌ Duffel test balance is critically low — MOST LIKELY CAUSE OF BOOKING FAILURES');
    fixes.push('Go to app.duffel.com → Settings → Balance → Top Up (test balance, no real money)');
  }
  if (!smoke?.ok) {
    const code = smoke?.errorCode as string;
    if (code?.includes('not_found') || code?.includes('invalid_token')) {
      diagnoses.push('❌ Duffel token is invalid or revoked');
      fixes.push('Generate a new access token at app.duffel.com → Developers → Access tokens');
    } else {
      diagnoses.push(`❌ Offer request failed: ${smoke?.error ?? 'unknown error'}`);
    }
  }
  if (!isTest && !isLive) {
    diagnoses.push('⚠ Token format not recognized — expected duffel_test_* or duffel_live_*');
    fixes.push('Check your DUFFEL_ACCESS_TOKEN in .env.local');
  }
  if (diagnoses.length === 0 && conn?.ok && smoke?.ok) {
    diagnoses.push('✅ Duffel is healthy — API reachable, token valid, offers returning');
    if (isTest) {
      diagnoses.push(
        `💰 Balance: ${(bal?.availableBalance as string) ?? '?'} ${(bal?.currency as string) ?? ''} — ` +
        (bal?.isLow ? 'LOW — top up before booking' : 'sufficient for testing')
      );
    }
  }

  return NextResponse.json({
    ...results,
    diagnosis: diagnoses,
    fixes,
    duffelDashboard: 'https://app.duffel.com',
    paymentModel:    'balance (pre-funded) — hotel uses LiteAPI sandbox card (no balance needed)',
    whyHotelWorksDuffelDoesnt: isTest && (bal?.isLow ?? false)
      ? 'Hotel (LiteAPI) uses a hardcoded sandbox credit card — no balance required. Duffel uses type:"balance" which debits your Duffel account balance. If that balance is $0 or insufficient, ALL Duffel flight bookings fail with insufficient_balance error.'
      : undefined,
  });
}
