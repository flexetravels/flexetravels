// ─── /api/checkout/quote ─────────────────────────────────────────────────────
// Pure quote endpoint for transparent checkout math. It does not create a
// payment, reserve inventory, or book anything. The frontend can use this to
// preview which payment strategy will be used before mounting a PSP widget.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildCheckoutQuote } from '@/lib/payments/strategy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Schema = z.object({
  market: z.enum(['CA', 'US', 'IN', 'OTHER']).default('CA'),
  supplier: z.enum(['duffel', 'liteapi', 'amadeus', 'travelport', 'mixed']).default('duffel'),
  preferDuffelPayments: z.boolean().optional(),
  duffelPaymentsEnabled: z.boolean().optional(),
  flights: z.array(z.object({
    amount: z.number().min(0).max(100_000),
    currency: z.string().min(3).max(3),
  })).max(10).default([]),
  hotels: z.array(z.object({
    amount: z.number().min(0).max(100_000),
    currency: z.string().min(3).max(3),
  })).max(10).optional(),
  serviceFeeAmount: z.number().min(0).max(500).default(20),
  serviceFeeCurrency: z.string().min(3).max(3).default('USD'),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const quote = buildCheckoutQuote(parsed.data);
  return NextResponse.json({ quote });
}
