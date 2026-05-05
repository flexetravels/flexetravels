'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function TripError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[trip canvas error]', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-navy-950 text-navy-100 flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-amber-400 font-mono mb-3">Something went sideways</p>
        <h1 className="text-2xl font-semibold text-white mb-3">We couldn&apos;t open this trip</h1>
        <p className="text-navy-200 mb-6 text-sm">
          The link may have expired, or the canvas hit a snag. Start fresh and we&apos;ll have you back planning in seconds.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-4 h-10 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium"
          >
            Try again
          </button>
          <Link
            href="/trip"
            className="px-4 h-10 rounded-md border border-navy-500/40 text-navy-200 hover:text-white hover:border-teal-500/50 text-sm font-medium flex items-center"
          >
            Start a new trip
          </Link>
        </div>
      </div>
    </div>
  );
}
