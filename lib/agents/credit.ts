// ─── Credit Agent ─────────────────────────────────────────────────────────────
// Manages FlexeTravels travel credits issued on cancellations, disruptions,
// and any manual adjustments.
//
// Credits live in the `credits` table (see /lib/db/schema.sql).
// They are tied to a session_id (not a user ID, to keep auth-free).
//
// Responsibilities:
//   • Fetch available credits for a session
//   • Issue a new credit (partial refund, goodwill, disruption)
//   • Apply / redeem credits against a new booking
//   • Expire stale credits

import type { CreditSummary, AgentResult } from '@/lib/orchestrator/types';
import { db } from '@/lib/db/client';

// ─── Credit agent ─────────────────────────────────────────────────────────────

export const creditAgent = {
  /**
   * Summarise all available credits for a session.
   */
  async getSummary(sessionId: string): Promise<AgentResult<CreditSummary>> {
    const t0 = Date.now();
    try {
      const rows = await db.credits.getBySession(sessionId);

      const totalAvailableCents = rows.reduce((sum, r) => sum + r.amount_cents, 0);
      const currency = rows[0]?.currency ?? 'USD';

      return {
        ok: true,
        data: {
          totalAvailableCents,
          currency,
          credits: rows.map(r => ({
            id:          r.id,
            amountCents: r.amount_cents,
            reason:      r.reason,
            expiresAt:   r.expires_at,
          })),
        },
        durationMs: Date.now() - t0,
      };
    } catch (e) {
      return { ok: false, error: String(e), durationMs: Date.now() - t0 };
    }
  },

  /**
   * Issue a new credit to a session.
   */
  async issue(params: {
    sessionId:   string;
    bookingId?:  string;
    amountCents: number;
    currency:    string;
    reason:      string;
    expiresInDays?: number;
  }): Promise<AgentResult<{ creditId: string }>> {
    const t0 = Date.now();
    try {
      const expiresAt = params.expiresInDays
        ? new Date(Date.now() + params.expiresInDays * 86400000).toISOString()
        : undefined;

      const row = await db.credits.create({
        session_id:   params.sessionId,
        booking_id:   params.bookingId,
        amount_cents: params.amountCents,
        currency:     params.currency,
        reason:       params.reason,
        status:       'available',
        expires_at:   expiresAt ?? null,
      });

      if (!row) {
        return { ok: false, error: 'DB unavailable — credit not persisted', durationMs: Date.now() - t0 };
      }

      console.log('[credit-agent] issued credit', row.id, params.amountCents, params.currency);
      return { ok: true, data: { creditId: row.id }, durationMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: String(e), durationMs: Date.now() - t0 };
    }
  },

  /**
   * Redeem (consume) a specific credit.
   */
  async redeem(creditId: string): Promise<AgentResult<void>> {
    const t0 = Date.now();
    try {
      await db.credits.redeem(creditId);
      console.log('[credit-agent] redeemed credit', creditId);
      return { ok: true, durationMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: String(e), durationMs: Date.now() - t0 };
    }
  },

  /**
   * Apply available credits to a booking (greedy: largest first).
   * Returns total cents applied and list of redeemed credit IDs.
   */
  async applyToBooking(params: {
    sessionId:    string;
    maxApplyCents: number;
  }): Promise<AgentResult<{ appliedCents: number; redeemedIds: string[] }>> {
    const t0 = Date.now();
    try {
      const summary = await creditAgent.getSummary(params.sessionId);
      if (!summary.ok || !summary.data) {
        return { ok: false, error: summary.error ?? 'Could not fetch credits', durationMs: Date.now() - t0 };
      }

      // Sort credits largest first for greedy application
      const available = [...summary.data.credits].sort((a, b) => b.amountCents - a.amountCents);

      let remaining  = params.maxApplyCents;
      let applied    = 0;
      const redeemed: string[] = [];

      for (const credit of available) {
        if (remaining <= 0) break;
        const use = Math.min(credit.amountCents, remaining);
        if (use === credit.amountCents) {
          // Fully consume this credit
          await db.credits.redeem(credit.id);
          redeemed.push(credit.id);
          applied   += use;
          remaining -= use;
        }
        // Partial redemption not supported in this version
      }

      console.log('[credit-agent] applied', applied, 'cents from', redeemed.length, 'credits');
      return {
        ok:   true,
        data: { appliedCents: applied, redeemedIds: redeemed },
        durationMs: Date.now() - t0,
      };
    } catch (e) {
      return { ok: false, error: String(e), durationMs: Date.now() - t0 };
    }
  },

  /**
   * Expire all credits past their expiry date for a session.
   * Should be called periodically (or lazily before showing credit balance).
   */
  async expireStale(sessionId: string): Promise<AgentResult<{ expiredCount: number }>> {
    const t0 = Date.now();
    try {
      const rows = await db.credits.getBySession(sessionId);
      const now  = Date.now();
      let expiredCount = 0;

      for (const row of rows) {
        if (row.expires_at && new Date(row.expires_at).getTime() < now) {
          // Mark expired
          await db.credits.redeem(row.id); // reuse redeem to update status
          expiredCount++;
        }
      }

      return { ok: true, data: { expiredCount }, durationMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: String(e), durationMs: Date.now() - t0 };
    }
  },
};
