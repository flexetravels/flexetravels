'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { CheckCircle, Plane, Calendar, Users, CreditCard, ArrowLeft, AlertCircle } from 'lucide-react';

// ─── Booking Confirmation Content ─────────────────────────────────────────────
function BookingContent() {
  const params = useSearchParams();

  const reference  = params.get('ref');
  const total      = params.get('total');
  const currency   = params.get('currency') ?? 'USD';
  const type       = params.get('type') ?? 'flight';
  const email      = params.get('email');

  if (!reference) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <AlertCircle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">No booking found</h1>
          <p className="text-muted-foreground mb-6">
            We couldn&apos;t find a booking reference. Please check your email or return to the chat.
          </p>
          <Link href="/chat" className="btn-primary">
            Back to FlexeTravels
          </Link>
        </div>
      </div>
    );
  }

  const formattedTotal = total
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(parseFloat(total))
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-4">
      <div className="max-w-lg w-full">

        {/* Success card */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl overflow-hidden">

          {/* Header gradient */}
          <div className="bg-gradient-to-r from-teal-500 to-teal-700 p-8 text-center">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-1">Booking Confirmed!</h1>
            <p className="text-teal-100 text-sm">Your {type} is booked</p>
          </div>

          {/* Details */}
          <div className="p-6 space-y-4">

            {/* Reference number */}
            <div className="bg-teal-50 dark:bg-teal-900/20 rounded-2xl p-4 text-center border border-teal-200 dark:border-teal-800">
              <p className="text-xs text-teal-600 dark:text-teal-400 font-medium uppercase tracking-widest mb-1">
                Booking Reference
              </p>
              <p className="text-3xl font-bold font-mono text-teal-700 dark:text-teal-300 tracking-wider">
                {reference}
              </p>
            </div>

            {/* Info rows */}
            <div className="space-y-3">
              {type === 'flight' && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                    <Plane className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Flight booking confirmed</p>
                    <p className="text-muted-foreground text-xs">Processed via Duffel (IATA-accredited)</p>
                  </div>
                </div>
              )}

              {formattedTotal && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                    <CreditCard className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Total charged: {formattedTotal}</p>
                    <p className="text-muted-foreground text-xs">Includes all taxes & fees</p>
                  </div>
                </div>
              )}

              {email && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Confirmation sent to</p>
                    <p className="text-muted-foreground text-xs">{email}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Service fee notice */}
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 border border-amber-200 dark:border-amber-800 flex gap-2">
              <CreditCard className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-amber-700 dark:text-amber-300">
                <span className="font-semibold">$20 FlexeTravels service fee</span> will be charged separately via Stripe email.
              </div>
            </div>

            {/* Disclaimer */}
            <div className="text-xs text-muted-foreground/70 text-center leading-relaxed border-t border-border pt-4">
              FlexeTravels is a technology platform, not a licensed travel agent.
              Flights are booked through Duffel (IATA-accredited).
              Keep your reference number for airline check-in.
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Link
                href="/chat"
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl
                           border border-border text-sm font-medium text-muted-foreground
                           hover:bg-muted transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to chat
              </Link>
              <button
                onClick={() => window.print()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl
                           bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors"
              >
                <Users className="w-4 h-4" />
                Print itinerary
              </button>
            </div>
          </div>
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-muted-foreground mt-4">
          Questions? Contact support or return to chat for help.
        </p>
      </div>
    </div>
  );
}

// ─── Page wrapper (Suspense required for useSearchParams in Next.js App Router) ─
export default function BookingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading booking...</p>
        </div>
      </div>
    }>
      <BookingContent />
    </Suspense>
  );
}
