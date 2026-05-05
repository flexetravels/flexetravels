'use client';

// ErrorBoundary — top-level React error boundary mounted in app/layout.tsx.
// Catches uncaught exceptions in the render tree, ships a sanitized crash
// report to /api/client-error, and renders a recoverable fallback UI.
//
// Lightweight stand-in for Sentry/PostHog — it gives us crash visibility in
// /api/admin/logs today without provisioning a third-party DSN. The fallback
// UI is plain (no Tailwind classes a future refactor could remove) so it's
// resilient to whatever broke in the design system.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean; eventId?: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof window === 'undefined') return;

    // Best-effort sessionId — anonymous canvas sessions write this to
    // localStorage. Falls back to undefined if it isn't there.
    let sessionId: string | undefined;
    try {
      sessionId = window.localStorage.getItem('ft_session') ?? undefined;
    } catch { /* localStorage may be disabled in some contexts */ }

    const payload = {
      message:   String(error.message ?? 'Unknown error').slice(0, 500),
      stack:     (error.stack ?? '').slice(0, 4000),
      component: (info.componentStack ?? '').slice(0, 2000),
      path:      window.location.pathname.slice(0, 200),
      loadedAt:  Math.floor(performance.timeOrigin),
      sessionId,
    };

    // Fire and forget — keepalive ensures the report ships even if the page
    // navigates away as part of recovery.
    try {
      fetch('/api/client-error', {
        method:    'POST',
        headers:   { 'Content-Type': 'application/json' },
        body:      JSON.stringify(payload),
        keepalive: true,
      }).catch(() => { /* swallow — already crashed, nothing useful to do */ });
    } catch { /* ignore */ }
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight:       '60vh',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          padding:         '2rem',
          fontFamily:      'ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            Something broke on this page.
          </h1>
          <p style={{ fontSize: '0.95rem', color: '#9ca3af', marginBottom: '1.25rem', lineHeight: 1.5 }}>
            Our team has been notified automatically. You can usually recover by
            reloading or going back to the home page. Your trip data is safe — we
            persist every change as you make it.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={this.reset}
              style={{
                padding:      '0.5rem 1rem',
                background:   '#0d9488',
                color:        'white',
                border:       'none',
                borderRadius: '0.5rem',
                cursor:       'pointer',
                fontSize:     '0.9rem',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                padding:        '0.5rem 1rem',
                border:         '1px solid #4b5563',
                borderRadius:   '0.5rem',
                textDecoration: 'none',
                color:          'inherit',
                fontSize:       '0.9rem',
              }}
            >
              Go home
            </a>
          </div>
        </div>
      </div>
    );
  }
}
