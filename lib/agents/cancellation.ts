// ─── Cancellation Agent ────────────────────────────────────────────────────────
// Four-tier cancellation strategy:
//
//   Tier 1 — API cancellation (Duffel /air/orders/{id}/actions/cancel)
//             Instant, automated. Works when the fare allows cancellation.
//
//   Tier 2 — Playwright automation (known airline scripts + self-healing)
//             Runs async via job queue — never in the API request cycle.
//
//   Tier 3 — AI-generated Playwright script
//             For airlines without built-in scripts. Generated once, stored.
//
//   Tier 4 — User-guided instructions
//             Last resort — zero automation, step-by-step customer instructions.
//
// The agent always returns a CancellationResult — never throws to the caller.

import type {
  CancellationRequest,
  CancellationResult,
  CancellationStrategy,
  AgentResult,
} from '@/lib/orchestrator/types';
import { enqueue } from '@/lib/queue';

// ─── Duffel cancellation ──────────────────────────────────────────────────────

async function duffelCancel(
  orderId: string,
): Promise<{ success: boolean; refundAmount?: string; currency?: string; error?: string }> {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token) return { success: false, error: 'DUFFEL_ACCESS_TOKEN not configured' };

  const headers = {
    Authorization:    `Bearer ${token}`,
    'Duffel-Version': 'v2',
    'Content-Type':   'application/json',
    Accept:           'application/json',
  };

  // Step 1: create cancellation (gets refund quote)
  const createRes = await fetch(
    `https://api.duffel.com/air/order_cancellations`,
    {
      method: 'POST',
      headers,
      body:   JSON.stringify({ data: { order_id: orderId } }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!createRes.ok) {
    const txt = await createRes.text();
    const bdy = (() => { try { return JSON.parse(txt); } catch { return {}; } })();
    const msg = bdy?.errors?.[0]?.message ?? txt.slice(0, 300);
    console.error('[cancellation-agent] Duffel cancel create failed', createRes.status, msg);
    return { success: false, error: `Cancellation request failed (${createRes.status}): ${msg}` };
  }

  const cancelData = await createRes.json() as {
    data?: {
      id:                    string;
      refund_amount?:        string;
      refund_currency?:      string;
      refund_to?:            string;
    };
  };

  const cancellationId = cancelData.data?.id;
  if (!cancellationId) {
    return { success: false, error: 'No cancellation ID returned from Duffel' };
  }

  // Step 2: confirm cancellation (actually processes it)
  const confirmRes = await fetch(
    `https://api.duffel.com/air/order_cancellations/${cancellationId}/actions/confirm`,
    {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!confirmRes.ok) {
    const txt = await confirmRes.text();
    const bdy = (() => { try { return JSON.parse(txt); } catch { return {}; } })();
    const msg = bdy?.errors?.[0]?.message ?? txt.slice(0, 300);
    console.error('[cancellation-agent] Duffel cancel confirm failed', confirmRes.status, msg);
    return { success: false, error: `Cancellation confirm failed (${confirmRes.status}): ${msg}` };
  }

  const confirmed = await confirmRes.json() as {
    data?: { refund_amount?: string; refund_currency?: string };
  };

  return {
    success:      true,
    refundAmount: confirmed.data?.refund_amount ?? cancelData.data?.refund_amount,
    currency:     confirmed.data?.refund_currency ?? cancelData.data?.refund_currency ?? 'USD',
  };
}

// ─── LiteAPI cancellation ─────────────────────────────────────────────────────

async function liteApiCancel(
  bookingId: string,
): Promise<{ success: boolean; refundAmount?: number; currency?: string; error?: string }> {
  const apiKey = process.env.LITEAPI_KEY;
  if (!apiKey) return { success: false, error: 'LITEAPI_KEY not configured' };

  const res = await fetch(`https://api.liteapi.travel/v3.0/bookings/${bookingId}`, {
    method:  'DELETE',
    headers: {
      'X-API-Key':    apiKey,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    const bdy = (() => { try { return JSON.parse(txt); } catch { return {}; } })();
    const msg = bdy?.message ?? txt.slice(0, 300);
    return { success: false, error: `LiteAPI cancel failed (${res.status}): ${msg}` };
  }

  const data = await res.json() as {
    data?: { refundAmount?: number; currency?: string };
  };

  return {
    success:      true,
    refundAmount: data.data?.refundAmount,
    currency:     data.data?.currency ?? 'USD',
  };
}

// ─── User-guided fallback ─────────────────────────────────────────────────────

function userGuidedInstructions(
  provider: CancellationRequest['provider'],
  providerRef: string,
): string[] {
  if (provider === 'duffel') {
    return [
      `Contact the airline directly with your booking reference: ${providerRef}`,
      'Provide your name and travel dates as they appear on your ticket.',
      'Ask for a cancellation and refund to your original payment method.',
      'If the airline charges a fee, keep the receipt — FlexeTravels may issue a credit.',
      'Email support@flexetravels.com with confirmation of the cancellation.',
    ];
  } else {
    return [
      `Contact the hotel directly with your booking reference: ${providerRef}`,
      'Refer to the cancellation policy shown at time of booking.',
      'Request a cancellation confirmation email from the hotel.',
      'Forward the confirmation to support@flexetravels.com for our records.',
    ];
  }
}

// ─── Main cancellation agent ──────────────────────────────────────────────────

export const cancellationAgent = {
  async cancel(req: CancellationRequest): Promise<AgentResult<CancellationResult>> {
    const t0 = Date.now();

    let strategy:     CancellationStrategy = 'api';
    let refundCents:  number | undefined;
    let currency:     string | undefined = 'USD';
    let error:        string | undefined;

    // ── Tier 1: API cancellation ──────────────────────────────────────────────
    try {
      let apiResult: { success: boolean; refundAmount?: string | number; currency?: string; error?: string };

      if (req.provider === 'duffel') {
        apiResult = await duffelCancel(req.providerRef);
        if (apiResult.success) {
          refundCents = Math.round(parseFloat(String(apiResult.refundAmount ?? '0')) * 100);
          currency    = apiResult.currency ?? 'USD';
        }
      } else {
        apiResult = await liteApiCancel(req.providerRef);
        if (apiResult.success) {
          refundCents = typeof apiResult.refundAmount === 'number'
            ? Math.round(apiResult.refundAmount * 100)
            : undefined;
          currency = apiResult.currency ?? 'USD';
        }
      }

      if (apiResult.success) {
        console.log('[cancellation-agent] API cancellation succeeded:', req.providerRef);
        return {
          ok:   true,
          data: { success: true, strategy, refundCents, currency },
          durationMs: Date.now() - t0,
        };
      }

      error = apiResult.error;
      console.warn('[cancellation-agent] API cancellation failed, trying fallback:', error);
    } catch (e) {
      error = String(e);
      console.error('[cancellation-agent] API cancellation threw:', e);
    }

    // ── Tier 2: Playwright Automation (async via queue) ───────────────────────
    // Extract airline name from providerRef or booking metadata if possible.
    // Queue the job — it runs in the background, user sees "processing" state.
    strategy = 'automation';
    const airlineName = req.airline ?? 'unknown';

    // Only trigger automation for known airlines (avoids wasteful jobs)
    const SUPPORTED_AIRLINES = ['air_canada', 'westjet', 'air_transat', 'flair', 'porter', 'swoop'];
    const normalisedAirline   = airlineName.toLowerCase().replace(/[\s-]+/g, '_');

    if (SUPPORTED_AIRLINES.includes(normalisedAirline) || process.env.AUTOMATION_AI_ALLOWED === 'true') {
      const jobId = enqueue({
        type:        'cancel_booking',
        bookingId:   req.bookingId,
        airline:     normalisedAirline,
        providerRef: req.providerRef,
        params: {
          bookingRef: req.providerRef,
          lastName:   req.passengerLastName ?? '',
        },
      });

      console.log(`[cancellation-agent] Automation job queued: ${jobId} for ${airlineName}`);

      // Return "processing" — the queue will update the booking status async.
      // The customer sees a "processing" state; webhook/polling delivers the result.
      return {
        ok:   true,
        data: {
          success:   false,
          strategy,
          error:     'Cancellation is being processed automatically — you will receive confirmation shortly.',
          automationJobId: jobId,
        },
        durationMs: Date.now() - t0,
      };
    }

    // ── Tier 3/4: User-guided instructions ────────────────────────────────────
    strategy = 'user_guided';
    const instructions = userGuidedInstructions(req.provider, req.providerRef);
    console.log('[cancellation-agent] Falling back to user-guided instructions');

    return {
      ok:   true,
      data: {
        success:      false,
        strategy,
        error,
        instructions,
      },
      durationMs: Date.now() - t0,
    };
  },
};
