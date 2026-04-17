// ─── /api/send-confirmation — Email booking confirmation to customer ──────────
// Uses SMTP via nodemailer. Configure via SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.
// Falls back gracefully if SMTP is not configured (logs warning, returns 200).

import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { db, DB_AVAILABLE } from '@/lib/db/client';

// ─── In-memory rate limit: max 3 emails per sessionId per hour ───────────────
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_MAX     = 3;
const RATE_LIMIT_WINDOW  = 3600_000; // 1 hour in ms

function checkRateLimit(sessionId: string): boolean {
  const now  = Date.now();
  const entry = rateLimitMap.get(sessionId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(sessionId, { count: 1, windowStart: now });
    return true; // within limit
  }
  if (entry.count >= RATE_LIMIT_MAX) return false; // exceeded
  entry.count++;
  return true;
}

// ─── Env ─────────────────────────────────────────────────────────────────────

const SMTP_HOST = process.env.SMTP_HOST ?? '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? '587', 10);
const SMTP_USER = process.env.SMTP_USER ?? '';
const SMTP_PASS = process.env.SMTP_PASS ?? '';
const SMTP_FROM = process.env.SMTP_FROM ?? 'FlexeTravels <bookings@flexetravels.com>';
const SMTP_CONFIGURED = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

// ─── Request schema ──────────────────────────────────────────────────────────

const PassengerSchema = z.object({
  firstName: z.string(), lastName: z.string(),
  dateOfBirth: z.string(), email: z.string(), phone: z.string(),
});
const ChildSchema = z.object({
  firstName: z.string(), lastName: z.string(), dateOfBirth: z.string(),
});
const FlightSchema = z.object({
  airline: z.string(), origin: z.string(), destination: z.string(),
  departure: z.string(), arrival: z.string(), duration: z.string(),
  stops: z.number(), price: z.number(), currency: z.string(),
  cabinClass: z.string(),
  segments: z.array(z.object({
    origin: z.string(), destination: z.string(),
    departure: z.string(), arrival: z.string(),
    duration: z.string(), carrier: z.string(), flightNumber: z.string(),
  })).optional(),
  baggage: z.string().optional(),
  refundable: z.boolean().optional(),
  flexibilityLabel: z.string().optional(),
}).optional().nullable();

const HotelSchema = z.object({
  name: z.string(), location: z.string().optional(), city: z.string().optional(),
  stars: z.number().optional(), totalPrice: z.number(), pricePerNight: z.number(),
  currency: z.string(), checkIn: z.string(), checkOut: z.string(),
  address: z.string().optional(), checkinTime: z.string().optional(),
  checkoutTime: z.string().optional(), boardName: z.string().optional(),
  cancellation: z.string().optional(),
  amenities: z.array(z.string()).optional(),
}).optional().nullable();

const BodySchema = z.object({
  // Auth fields — at least one required to verify a real booking exists
  tripId:          z.string().optional(),
  paymentIntentId: z.string().optional(),
  sessionId:       z.string().optional().default('unknown'),
  flightRef: z.string().optional().default(''),
  hotelRef:  z.string().optional().default(''),
  flight:    FlightSchema,
  hotel:     HotelSchema,
  passengers:      z.array(PassengerSchema).default([]),
  childPassengers: z.array(ChildSchema).default([]),
  adults:    z.number().default(1),
  children:  z.number().default(0),
  currency:  z.string().default('USD'),
  serviceFee: z.number().default(20),
  bookedAt:  z.string().default(''),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Escape HTML special characters in any user-supplied string before
 * interpolating it into the email HTML template.
 *
 * Attack prevented: a passenger could set firstName to
 *   '<a href="https://evil.com">Refund here</a>'
 * or inject a tracking pixel '<img src="https://tracker.evil.com/px">'.
 * Without escaping, these render in the recipient's email client.
 */
function esc(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return esc(iso); }
}
function fmtTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); }
  catch { return esc(iso); }
}
function fmtPrice(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
}
function nights(checkIn: string, checkOut: string): number {
  return Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000));
}

// ─── Email HTML builder ──────────────────────────────────────────────────────

function buildEmailHtml(d: z.infer<typeof BodySchema>): string {
  const fl = d.flight;
  const ht = d.hotel;
  const cur = fl?.currency ?? ht?.currency ?? d.currency;
  const flightCost = fl?.price ?? 0;
  const hotelCost  = ht?.totalPrice ?? 0;
  const total = flightCost + hotelCost + d.serviceFee;

  // All values interpolated into HTML are run through esc() to prevent HTML
  // injection via passenger names, hotel names, or other user/API-sourced strings.
  const segmentsHtml = fl?.segments?.map(s => `
    <tr>
      <td style="padding:6px 8px;font-family:monospace;font-weight:bold;font-size:13px;color:#0d9488">${esc(s.flightNumber)}</td>
      <td style="padding:6px 8px;font-size:13px">${esc(s.origin)} → ${esc(s.destination)}</td>
      <td style="padding:6px 8px;font-size:13px">${fmtTime(s.departure)} — ${fmtTime(s.arrival)}</td>
      <td style="padding:6px 8px;font-size:13px;color:#6b7280">${esc(s.duration)}</td>
    </tr>
  `).join('') ?? '';

  const passengersHtml = d.passengers.map((p, i) => `
    <tr>
      <td style="padding:6px 8px;font-size:13px;font-weight:600">${esc(p.firstName)} ${esc(p.lastName)}</td>
      <td style="padding:6px 8px;font-size:13px;color:#6b7280">Adult ${i + 1}</td>
      <td style="padding:6px 8px;font-size:13px">${fmtDate(p.dateOfBirth)}</td>
      <td style="padding:6px 8px;font-size:13px">${esc(p.email)}</td>
      <td style="padding:6px 8px;font-size:13px">${esc(p.phone)}</td>
    </tr>
  `).join('');

  const childrenHtml = d.childPassengers.map((c, i) => `
    <tr>
      <td style="padding:6px 8px;font-size:13px;font-weight:600">${esc(c.firstName)} ${esc(c.lastName)}</td>
      <td style="padding:6px 8px;font-size:13px;color:#d97706">Child ${i + 1}</td>
      <td style="padding:6px 8px;font-size:13px">${fmtDate(c.dateOfBirth)}</td>
      <td style="padding:6px 8px;font-size:13px" colspan="2">—</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:640px;margin:0 auto;padding:20px">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0d9488,#0f766e);border-radius:16px 16px 0 0;padding:32px;text-align:center">
    <h1 style="color:white;margin:0;font-size:24px">Booking Confirmed!</h1>
    <p style="color:#99f6e4;margin:8px 0 0;font-size:14px">Your trip is booked and ready to go</p>
  </div>

  <div style="background:white;border-radius:0 0 16px 16px;padding:24px;border:1px solid #e5e7eb;border-top:0">

    <!-- References -->
    <div style="display:flex;gap:12px;margin-bottom:24px">
      ${d.flightRef ? `
      <div style="flex:1;background:#f0fdfa;border:1px solid #99f6e4;border-radius:12px;padding:12px;text-align:center">
        <p style="font-size:10px;color:#0d9488;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 4px">Flight Reference</p>
        <p style="font-size:22px;font-weight:900;font-family:monospace;color:#0f766e;margin:0">${esc(d.flightRef)}</p>
      </div>` : ''}
      ${d.hotelRef ? `
      <div style="flex:1;background:#f0fdfa;border:1px solid #99f6e4;border-radius:12px;padding:12px;text-align:center">
        <p style="font-size:10px;color:#0d9488;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 4px">Hotel Booking ID</p>
        <p style="font-size:22px;font-weight:900;font-family:monospace;color:#0f766e;margin:0">${esc(d.hotelRef)}</p>
      </div>` : ''}
    </div>

    ${fl ? `
    <!-- Flight Details -->
    <div style="margin-bottom:24px">
      <h2 style="font-size:14px;color:#0d9488;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #f0fdfa;padding-bottom:8px;margin:0 0 12px">
        ✈ Flight Itinerary
      </h2>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#6b7280">Airline</td>
          <td style="padding:4px 0;font-size:13px;font-weight:600">${esc(fl.airline)}</td>
          <td style="padding:4px 0;font-size:13px;color:#6b7280">Class</td>
          <td style="padding:4px 0;font-size:13px;font-weight:600">${esc(fl.cabinClass?.charAt(0).toUpperCase())}${esc(fl.cabinClass?.slice(1))}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#6b7280">Route</td>
          <td style="padding:4px 0;font-size:13px;font-weight:600">${esc(fl.origin)} → ${esc(fl.destination)}</td>
          <td style="padding:4px 0;font-size:13px;color:#6b7280">Duration</td>
          <td style="padding:4px 0;font-size:13px;font-weight:600">${esc(fl.duration)}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#6b7280">Departure</td>
          <td style="padding:4px 0;font-size:13px;font-weight:600">${fmtDate(fl.departure)} · ${fmtTime(fl.departure)}</td>
          <td style="padding:4px 0;font-size:13px;color:#6b7280">Arrival</td>
          <td style="padding:4px 0;font-size:13px;font-weight:600">${fmtDate(fl.arrival)} · ${fmtTime(fl.arrival)}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#6b7280">Stops</td>
          <td style="padding:4px 0;font-size:13px;font-weight:600">${fl.stops === 0 ? 'Non-stop' : `${fl.stops} stop(s)`}</td>
          <td style="padding:4px 0;font-size:13px;color:#6b7280">Fare</td>
          <td style="padding:4px 0;font-size:13px;font-weight:600">${fmtPrice(fl.price, fl.currency)} per person</td>
        </tr>
        ${fl.baggage ? `<tr><td style="padding:4px 0;font-size:13px;color:#6b7280">Baggage</td><td colspan="3" style="padding:4px 0;font-size:13px">${esc(fl.baggage)}</td></tr>` : ''}
        ${fl.flexibilityLabel ? `<tr><td style="padding:4px 0;font-size:13px;color:#6b7280">Flexibility</td><td colspan="3" style="padding:4px 0;font-size:13px;color:#0d9488;font-weight:600">${esc(fl.flexibilityLabel)}</td></tr>` : ''}
      </table>

      ${segmentsHtml ? `
      <p style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin:16px 0 8px">Flight Segments</p>
      <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px">
        <tr style="background:#f3f4f6"><th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280">Flight</th><th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280">Route</th><th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280">Time</th><th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280">Duration</th></tr>
        ${segmentsHtml}
      </table>` : ''}
    </div>` : ''}

    ${ht ? `
    <!-- Hotel Details -->
    <div style="margin-bottom:24px">
      <h2 style="font-size:14px;color:#0d9488;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #f0fdfa;padding-bottom:8px;margin:0 0 12px">
        🏨 Hotel Accommodation
      </h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:4px 0;font-size:13px;color:#6b7280">Hotel</td><td colspan="3" style="padding:4px 0;font-size:13px;font-weight:600">${esc(ht.name)}${ht.stars ? ` ${'★'.repeat(ht.stars)}` : ''}</td></tr>
        ${ht.address ? `<tr><td style="padding:4px 0;font-size:13px;color:#6b7280">Address</td><td colspan="3" style="padding:4px 0;font-size:13px">${esc(ht.address)}</td></tr>` : ''}
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#6b7280">Check-in</td>
          <td style="padding:4px 0;font-size:13px;font-weight:600">${fmtDate(ht.checkIn)}${ht.checkinTime ? ` · ${esc(ht.checkinTime)}` : ''}</td>
          <td style="padding:4px 0;font-size:13px;color:#6b7280">Check-out</td>
          <td style="padding:4px 0;font-size:13px;font-weight:600">${fmtDate(ht.checkOut)}${ht.checkoutTime ? ` · ${esc(ht.checkoutTime)}` : ''}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#6b7280">Duration</td>
          <td style="padding:4px 0;font-size:13px;font-weight:600">${nights(ht.checkIn, ht.checkOut)} night(s)</td>
          <td style="padding:4px 0;font-size:13px;color:#6b7280">Rate</td>
          <td style="padding:4px 0;font-size:13px;font-weight:600">${fmtPrice(ht.pricePerNight, ht.currency)}/night · ${fmtPrice(ht.totalPrice, ht.currency)} total</td>
        </tr>
        ${ht.boardName ? `<tr><td style="padding:4px 0;font-size:13px;color:#6b7280">Board</td><td colspan="3" style="padding:4px 0;font-size:13px">${esc(ht.boardName)}</td></tr>` : ''}
        ${ht.cancellation ? `<tr><td style="padding:4px 0;font-size:13px;color:#6b7280">Cancellation</td><td colspan="3" style="padding:4px 0;font-size:13px;color:#16a34a;font-weight:600">${esc(ht.cancellation)}</td></tr>` : ''}
      </table>
    </div>` : ''}

    <!-- Passengers -->
    <div style="margin-bottom:24px">
      <h2 style="font-size:14px;color:#0d9488;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #f0fdfa;padding-bottom:8px;margin:0 0 12px">
        👤 Passenger Information
      </h2>
      <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px">
        <tr style="background:#f3f4f6">
          <th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280">Name</th>
          <th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280">Type</th>
          <th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280">Date of Birth</th>
          <th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280">Email</th>
          <th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280">Phone</th>
        </tr>
        ${passengersHtml}
        ${childrenHtml}
      </table>
    </div>

    <!-- Payment Summary -->
    <div style="margin-bottom:24px">
      <h2 style="font-size:14px;color:#0d9488;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #f0fdfa;padding-bottom:8px;margin:0 0 12px">
        💳 Payment Summary
      </h2>
      <table style="width:100%;border-collapse:collapse">
        ${fl ? `<tr><td style="padding:6px 0;font-size:13px;color:#6b7280">Flight (${d.adults} adult${d.adults > 1 ? 's' : ''}${d.children ? ` + ${d.children} child${d.children > 1 ? 'ren' : ''}` : ''})</td><td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right">${fmtPrice(flightCost, cur)}</td></tr>` : ''}
        ${ht ? `<tr><td style="padding:6px 0;font-size:13px;color:#6b7280">Hotel — ${nights(ht.checkIn, ht.checkOut)} night(s)</td><td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right">${fmtPrice(hotelCost, cur)}</td></tr>` : ''}
        <tr><td style="padding:6px 0;font-size:13px;color:#6b7280">FlexeTravels service fee</td><td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right">${fmtPrice(d.serviceFee, cur)}</td></tr>
        <tr style="border-top:2px solid #0d9488"><td style="padding:10px 0;font-size:15px;font-weight:900">Total</td><td style="padding:10px 0;font-size:15px;font-weight:900;color:#0f766e;text-align:right">${fmtPrice(total, cur)}</td></tr>
      </table>
    </div>

    <!-- Important Info -->
    <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:12px;padding:16px;margin-bottom:16px">
      <p style="font-size:12px;font-weight:700;color:#0d9488;margin:0 0 8px">Important Information</p>
      <ul style="margin:0;padding:0 0 0 16px;font-size:12px;color:#374151;line-height:1.8">
        ${d.flightRef ? `<li>Use reference <strong style="font-family:monospace">${esc(d.flightRef)}</strong> for airline check-in and boarding.</li>` : ''}
        ${d.hotelRef ? `<li>Present booking ID <strong style="font-family:monospace">${esc(d.hotelRef)}</strong> at the hotel front desk.</li>` : ''}
        <li>Ensure all passenger names match your travel document (passport/ID) exactly.</li>
        <li>For changes or cancellations, contact FlexeTravels support with your booking reference.</li>
        <li><strong>24-Hour Cancellation:</strong> Under US DOT rules, you may cancel your flight free of charge within 24 hours of booking, provided your departure is 7+ days away. Contact support@flexetravels.com to cancel.</li>
        <li><strong>Baggage:</strong> Baggage allowance varies by fare class and airline. Check with your airline for carry-on and checked baggage details.</li>
        <li><strong>Canadian Flights:</strong> Flights departing Canada are protected under the Air Passenger Protection Regulations (APPR) for delays, cancellations, and denied boarding.</li>
      </ul>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding-top:16px;border-top:1px solid #e5e7eb">
      <p style="font-size:12px;font-weight:600;color:#0d9488;margin:0">FlexeTravels — AI-Powered Travel Booking</p>
      <p style="font-size:11px;color:#9ca3af;margin:4px 0 0">www.flexetravels.com · support@flexetravels.com</p>
      <p style="font-size:11px;color:#9ca3af;margin:4px 0 0">This email serves as your official booking confirmation.</p>
      <div style="text-align:center;margin-top:12px">
        <p style="font-size:10px;color:#9ca3af;margin:0">Questions or complaints: support@flexetravels.com · US DOT Aviation Consumer Protection: 1-202-366-2220</p>
        <p style="font-size:10px;color:#9ca3af;margin:4px 0 0">FlexeTravels is a technology platform. Flights booked via Duffel (IATA-accredited). Hotels via LiteAPI.</p>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const { tripId, paymentIntentId, sessionId } = data;

  // ── Booking existence verification ───────────────────────────────────────────
  // Require a real booking to exist before sending any email.
  if (DB_AVAILABLE) {
    if (!tripId && !paymentIntentId) {
      return NextResponse.json(
        { error: 'A tripId or paymentIntentId is required to send confirmation' },
        { status: 400 },
      );
    }
    let verified = false;
    if (tripId) {
      const trip = await db.trips.get(tripId).catch(() => null);
      verified = !!(trip && trip.session_id === sessionId);
    }
    if (!verified && paymentIntentId) {
      const payment = await db.payments.getByIntentId(paymentIntentId).catch(() => null);
      verified = !!payment;
    }
    if (!verified) {
      console.warn('[send-confirmation] No verified booking found — rejecting email request');
      return NextResponse.json({ error: 'No verified booking found' }, { status: 403 });
    }
  }

  // ── Rate limit ────────────────────────────────────────────────────────────────
  if (!checkRateLimit(sessionId)) {
    console.warn('[send-confirmation] Rate limit exceeded for session', sessionId);
    return NextResponse.json({ error: 'Too many confirmation emails. Try again later.' }, { status: 429 });
  }

  const toEmail = data.passengers[0]?.email;
  if (!toEmail) {
    return NextResponse.json({ error: 'No passenger email found' }, { status: 400 });
  }

  if (!SMTP_CONFIGURED) {
    console.warn('[send-confirmation] SMTP not configured — skipping email. Set SMTP_HOST, SMTP_USER, SMTP_PASS.');
    return NextResponse.json({ success: true, skipped: true, reason: 'SMTP not configured' });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const subject = data.flightRef && data.hotelRef
      ? `Booking Confirmed — ${data.flightRef} + ${data.hotelRef}`
      : data.flightRef
        ? `Flight Booking Confirmed — ${data.flightRef}`
        : `Hotel Booking Confirmed — ${data.hotelRef}`;

    await transporter.sendMail({
      from: SMTP_FROM,
      to: toEmail,
      subject,
      html: buildEmailHtml(data),
    });

    console.log('[send-confirmation] Email sent to', toEmail);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[send-confirmation] Failed to send email:', e);
    return NextResponse.json({ error: 'Email delivery failed' }, { status: 502 });
  }
}
