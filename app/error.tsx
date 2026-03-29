'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      <div className="text-5xl mb-4">✈️</div>
      <h1 className="text-2xl font-black text-foreground mb-2">Turbulence ahead</h1>
      <p className="text-muted-foreground mb-6 max-w-sm">
        We hit a snag somewhere over the clouds. Let&apos;s try that again.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold transition-colors"
        >
          Try again
        </button>
        <a
          href="/"
          className="px-5 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          Go home
        </a>
      </div>
    </div>
  );
}
