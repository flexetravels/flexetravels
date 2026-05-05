'use client';

// /trip — entry point. Creates a fresh canvas tied to the current session
// and redirects to /trip/[id]. If creation fails (DB down, network), shows a
// graceful retry. Mirrors the existing /chat session-id pattern.

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { generateSessionId } from '@/lib/utils';

export default function NewTripPage() {
  return (
    <Suspense fallback={<NewTripStartingShell />}>
      <NewTripBody />
    </Suspense>
  );
}

function NewTripStartingShell() {
  return (
    <div className="min-h-screen bg-navy-950 text-navy-100 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="mx-auto mb-6 h-10 w-10 rounded-full border-2 border-teal-500/30 border-t-teal-500 animate-spin" />
        <p className="text-sm uppercase tracking-[0.2em] text-teal-400 font-mono mb-2">Starting a new trip</p>
        <p className="text-navy-200 italic" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
          Setting up your canvas…
        </p>
      </div>
    </div>
  );
}

function NewTripBody() {
  const router = useRouter();
  const params = useSearchParams();
  // Snapshot params once at render time. useSearchParams returns a new
  // ReadonlyURLSearchParams reference on each render, so passing it into
  // a useEffect dep array would loop. Pulling primitives out is stable.
  const fromParam  = params.get('from');
  const titleParam = params.get('title');
  const newParam   = params.get('new');

  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const sessionId = getOrCreateSessionId();

    // Resume the user's most-recent trip if we have one in localStorage.
    // ?new=1 forces a fresh canvas (e.g. the post-confirmation CTA); otherwise
    // returning users land back where they left off — no lost selections.
    const forceNew = newParam === '1';
    let lastTripId: string | null = null;
    try { lastTripId = window.localStorage.getItem('ft_last_trip_id'); } catch { /* ignore */ }

    if (!forceNew && lastTripId && /^[0-9a-f-]{36}$/i.test(lastTripId)) {
      // Verify the trip still exists for this session before jumping to it
      // (the user may have cleared cookies, switched devices, or had the
      // canvas archived). On 403/404 we fall through to creating a new one.
      (async () => {
        try {
          const probe = await fetch(`/api/trip/${lastTripId}?sessionId=${encodeURIComponent(sessionId)}`);
          if (probe.ok) {
            router.replace(`/trip/${lastTripId}`);
            return;
          }
        } catch { /* fall through to create */ }
        await createNewTrip();
      })();
      return;
    }

    void createNewTrip();

    async function createNewTrip() {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch('/api/trip', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          signal:  controller.signal,
          body:    JSON.stringify({
            sessionId,
            title: titleParam || 'New trip',
            from:  fromParam === 'chat' || fromParam === 'shared' ? fromParam : 'new',
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || 'Could not start a new trip. Please try again.');
          return;
        }

        const data = await res.json();
        try { window.localStorage.setItem('ft_last_trip_id', data.id); } catch { /* ignore */ }
        // Use a hard navigation here. This is a handoff page, and hard replace
        // avoids getting stranded if the app router transition/chunk load is
        // interrupted while the dev server is compiling or recovering.
        window.location.replace(`/trip/${data.id}`);
      } catch (e) {
        setError(e instanceof DOMException && e.name === 'AbortError'
          ? 'Starting the trip took too long. Please try again.'
          : e instanceof Error ? e.message : 'Network error');
      } finally {
        window.clearTimeout(timeout);
      }
    }
  }, [router, fromParam, titleParam, newParam]);

  return (
    <div className="min-h-screen bg-navy-950 text-navy-100 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        {error ? (
          <>
            <p className="text-sm text-amber-400 mb-3 font-mono uppercase tracking-wider">Couldn&apos;t start</p>
            <h1 className="text-2xl font-semibold text-white mb-3">{error}</h1>
            <button
              onClick={() => { startedRef.current = false; setError(null); router.refresh(); }}
              className="mt-4 px-5 h-10 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto mb-6 h-10 w-10 rounded-full border-2 border-teal-500/30 border-t-teal-500 animate-spin" />
            <p className="text-sm uppercase tracking-[0.2em] text-teal-400 font-mono mb-2">Starting a new trip</p>
            <p className="text-navy-200 italic" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
              Setting up your canvas…
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return '';
  const KEY = 'ft_session_id';
  let id = window.localStorage.getItem(KEY);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    id = generateSessionId();
    window.localStorage.setItem(KEY, id);
  }
  return id;
}
