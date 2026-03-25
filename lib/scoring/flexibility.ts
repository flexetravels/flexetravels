// ─── Flight Flexibility Scoring Engine ───────────────────────────────────────
// Normalises Duffel's raw conditions object into a 0–1 score and a label.
//
// Score composition (total = 1.0):
//   Refundability  60% — can the fare be refunded before departure?
//   Changeability  40% — can the fare be changed before departure?
//   Penalty weight     — reduces score when penalties are large relative to fare
//
// Labels:
//   Flexible  0.65 – 1.00   Full refund + change allowed, low/no penalty
//   Moderate  0.35 – 0.64   Partial refund or changeable with penalty
//   Locked    0.00 – 0.34   No refund, no change

export type FlexibilityLabel = 'Flexible' | 'Moderate' | 'Locked';

export interface FlexibilityScore {
  score:     number;          // 0.00 – 1.00 (2 d.p.)
  label:     FlexibilityLabel;
  refundable: boolean;
  changeable: boolean;
  refundPenaltyCents:  number | null;   // null = no penalty data available
  changePenaltyCents:  number | null;
  currency:  string;
  summary:   string;          // Human-readable for tooltip
}

// ─── Duffel conditions types ──────────────────────────────────────────────────

export interface DuffelConditionDetail {
  allowed:          boolean;
  penalty_amount?:  string;   // e.g. "50.00"
  penalty_currency?: string;
}

export interface DuffelConditions {
  refund_before_departure?: DuffelConditionDetail;
  change_before_departure?:  DuffelConditionDetail;
}

// ─── Score calculator ─────────────────────────────────────────────────────────

export function scoreFlexibility(
  conditions: DuffelConditions | null | undefined,
  fareCents: number,              // ticket price in cents (for penalty ratio)
): FlexibilityScore {
  // Defaults when no conditions data
  if (!conditions) {
    return {
      score: 0.2,
      label: 'Locked',
      refundable: false,
      changeable: false,
      refundPenaltyCents: null,
      changePenaltyCents: null,
      currency: 'USD',
      summary: 'Flexibility details unavailable — assume non-refundable.',
    };
  }

  const refund = conditions.refund_before_departure;
  const change  = conditions.change_before_departure;

  const refundable = refund?.allowed ?? false;
  const changeable  = change?.allowed  ?? false;

  const refundPenaltyCents = parsePenaltyCents(refund?.penalty_amount);
  const changePenaltyCents  = parsePenaltyCents(change?.penalty_amount);
  const currency = refund?.penalty_currency ?? change?.penalty_currency ?? 'USD';

  // ── Refund component (60% weight) ─────────────────────────────────────────
  let refundScore = 0;
  if (refundable) {
    if (refundPenaltyCents === null || refundPenaltyCents === 0) {
      refundScore = 1.0;   // fully refundable, no penalty
    } else {
      // Penalty ratio: 0 penalty = 1.0 score, penalty ≥ 50% of fare = 0.2 score
      const ratio = fareCents > 0 ? Math.min(refundPenaltyCents / fareCents, 1) : 0.5;
      refundScore = Math.max(0.2, 1.0 - ratio * 0.8);
    }
  }

  // ── Change component (40% weight) ─────────────────────────────────────────
  let changeScore = 0;
  if (changeable) {
    if (changePenaltyCents === null || changePenaltyCents === 0) {
      changeScore = 1.0;
    } else {
      const ratio = fareCents > 0 ? Math.min(changePenaltyCents / fareCents, 1) : 0.5;
      changeScore = Math.max(0.2, 1.0 - ratio * 0.8);
    }
  }

  // ── Weighted total ─────────────────────────────────────────────────────────
  const raw   = (refundScore * 0.60) + (changeScore * 0.40);
  const score = Math.round(raw * 100) / 100;

  // ── Label ──────────────────────────────────────────────────────────────────
  const label: FlexibilityLabel =
    score >= 0.65 ? 'Flexible' :
    score >= 0.35 ? 'Moderate' :
    'Locked';

  // ── Summary text ───────────────────────────────────────────────────────────
  const parts: string[] = [];
  if (refundable) {
    parts.push(
      refundPenaltyCents === 0  ? 'Free cancellation' :
      refundPenaltyCents !== null ? `Cancel (${formatCents(refundPenaltyCents, currency)} fee)` :
      'Cancellation allowed'
    );
  } else {
    parts.push('Non-refundable');
  }
  if (changeable) {
    parts.push(
      changePenaltyCents === 0  ? 'Free changes' :
      changePenaltyCents !== null ? `Changes (${formatCents(changePenaltyCents, currency)} fee)` :
      'Changes allowed'
    );
  } else {
    parts.push('No changes');
  }

  return {
    score,
    label,
    refundable,
    changeable,
    refundPenaltyCents,
    changePenaltyCents,
    currency,
    summary: parts.join(' · '),
  };
}

// ─── Label helpers ────────────────────────────────────────────────────────────

export const FLEXIBILITY_COLORS: Record<FlexibilityLabel, { bg: string; text: string; border: string }> = {
  Flexible: { bg: '#052e16', text: '#4ade80', border: '#166534' },
  Moderate: { bg: '#1c1400', text: '#fbbf24', border: '#92400e' },
  Locked:   { bg: '#1c0a0a', text: '#f87171', border: '#7f1d1d' },
};

export const FLEXIBILITY_TAILWIND: Record<FlexibilityLabel, string> = {
  Flexible: 'bg-green-950/80 text-green-400 border border-green-800/50',
  Moderate: 'bg-amber-950/80 text-amber-400 border border-amber-800/50',
  Locked:   'bg-red-950/80   text-red-400   border border-red-800/50',
};

export const FLEXIBILITY_ICONS: Record<FlexibilityLabel, string> = {
  Flexible: '✓',
  Moderate: '~',
  Locked:   '✕',
};

// ─── Private helpers ──────────────────────────────────────────────────────────

function parsePenaltyCents(amount: string | undefined): number | null {
  if (amount === undefined || amount === null) return null;
  const n = parseFloat(amount);
  return isNaN(n) ? null : Math.round(n * 100);
}

function formatCents(cents: number, currency: string): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}
