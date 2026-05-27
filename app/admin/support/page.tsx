'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type Row = Record<string, unknown>;

interface TimelineItem {
  at: string;
  type: string;
  label: string;
  status?: string;
  amount?: string;
  sourceTable: string;
  id?: string;
}

interface SupportLookupResult {
  query: string;
  sessions: Row[];
  searches: Row[];
  passengers: Row[];
  paymentQuotes: Row[];
  paymentTransactions: Row[];
  supplierBookings: Row[];
  ledgerEntries: Row[];
  legacyPayments: Row[];
  legacyBookings: Row[];
  timeline: TimelineItem[];
}

const sections: Array<{ key: keyof Omit<SupportLookupResult, 'query' | 'timeline'>; title: string }> = [
  { key: 'sessions', title: 'Sessions' },
  { key: 'searches', title: 'Searches' },
  { key: 'passengers', title: 'Passengers' },
  { key: 'paymentQuotes', title: 'Payment Quotes' },
  { key: 'paymentTransactions', title: 'Payment Transactions' },
  { key: 'supplierBookings', title: 'Supplier Bookings' },
  { key: 'ledgerEntries', title: 'Ledger Entries' },
  { key: 'legacyPayments', title: 'Legacy Payments' },
  { key: 'legacyBookings', title: 'Legacy Bookings' },
];

function formatDate(value: string) {
  if (!value) return 'Unknown time';
  try {
    return new Date(value).toLocaleString('en-CA', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return value;
  }
}

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function StatusPill({ value }: { value?: string }) {
  const status = value ?? 'recorded';
  const good = /success|succeeded|confirmed|consumed|open|recorded/i.test(status);
  const bad = /fail|error|cancel|expired|refund_due/i.test(status);
  const bg = bad ? '#3f1515' : good ? '#063f2d' : '#2f2a12';
  const color = bad ? '#fca5a5' : good ? '#7dd3b0' : '#fde68a';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      borderRadius: 999,
      padding: '2px 8px',
      background: bg,
      color,
      fontSize: 11,
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    }}>
      {status}
    </span>
  );
}

function KeyValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div style={{
      minWidth: 0,
      border: '1px solid #24342d',
      borderRadius: 10,
      padding: 12,
      background: '#07110d',
    }}>
      <div style={{ color: '#7c8b83', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7 }}>
        {label}
      </div>
      <div style={{
        marginTop: 4,
        color: '#f8fafc',
        fontSize: 13,
        overflowWrap: 'anywhere',
        fontFamily: label.toLowerCase().includes('id') ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
      }}>
        {text(value)}
      </div>
    </div>
  );
}

function RecordCard({ row }: { row: Row }) {
  const summaryKeys = [
    'id', 'session_id', 'created_at', 'status', 'search_type', 'origin', 'destination',
    'provider_payment_id', 'stripe_intent_id', 'supplier', 'product_type',
    'supplier_reference', 'supplier_booking_id', 'booking_ref', 'provider_ref',
    'amount_cents', 'currency', 'charge_amount_cents', 'charge_currency',
    'result_count', 'converted', 'latency_ms',
  ];
  const keys = summaryKeys.filter(key => key in row);

  return (
    <details style={{
      border: '1px solid #25382f',
      borderRadius: 12,
      background: '#050a07',
      overflow: 'hidden',
    }}>
      <summary style={{
        cursor: 'pointer',
        padding: '12px 14px',
        color: '#e5e7eb',
        fontWeight: 800,
      }}>
        {text(row.id ?? row.session_id ?? row.provider_payment_id ?? row.booking_ref ?? 'Record')}
      </summary>
      <div style={{ borderTop: '1px solid #15231c', padding: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
          {keys.map(key => <KeyValue key={key} label={key} value={row[key]} />)}
        </div>
        <pre style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 10,
          background: '#020403',
          color: '#b8c7bf',
          fontSize: 11,
          overflowX: 'auto',
          border: '1px solid #15231c',
        }}>
          {JSON.stringify(row, null, 2)}
        </pre>
      </div>
    </details>
  );
}

function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section style={{
      border: '1px solid #1e3027',
      borderRadius: 16,
      background: '#08100c',
      padding: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 17, color: '#f8fafc' }}>{title}</h2>
        <StatusPill value={`${rows.length} record${rows.length === 1 ? '' : 's'}`} />
      </div>
      {rows.length === 0 ? (
        <p style={{ margin: 0, color: '#7c8b83', fontSize: 13 }}>No matching records.</p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((row, index) => (
            <RecordCard key={String(row.id ?? row.session_id ?? index)} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function SupportLookupPage() {
  const [secret, setSecret] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SupportLookupResult | null>(null);

  useEffect(() => {
    setSecret(localStorage.getItem('ft_admin_secret') ?? '');
  }, []);

  const totals = useMemo(() => {
    if (!result) return null;
    return sections.reduce((sum, section) => sum + result[section.key].length, 0);
  }, [result]);

  async function lookup() {
    setError('');
    setResult(null);
    if (!secret.trim()) {
      setError('Enter the admin secret first.');
      return;
    }
    if (query.trim().length < 3) {
      setError('Enter at least 3 characters.');
      return;
    }
    localStorage.setItem('ft_admin_secret', secret.trim());
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/support?q=${encodeURIComponent(query.trim())}`, {
        headers: { 'X-Admin-Secret': secret.trim() },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Lookup failed.');
      } else {
        setResult(data as SupportLookupResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: '#000',
      color: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        borderBottom: '1px solid #1e3027',
        background: 'rgba(0,0,0,0.92)',
        backdropFilter: 'blur(16px)',
      }}>
        <div style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '18px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
        }}>
          <Link href="/" style={{ color: '#f8fafc', textDecoration: 'none', fontSize: 20, fontWeight: 900 }}>
            Flexe<span style={{ color: '#00a76f' }}>Travels</span>
          </Link>
          <span style={{ color: '#64748b' }}>Support Lookup</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <Link href="/admin" style={{ color: '#9ca3af', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
              Diagnostics
            </Link>
            <Link href="/#search" style={{ color: '#9ca3af', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
              Search
            </Link>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 20px 60px' }}>
        <section style={{
          border: '1px solid #1e3027',
          borderRadius: 18,
          padding: 18,
          background: 'linear-gradient(135deg, #07110d, #020403)',
          boxShadow: '0 24px 80px rgba(0, 167, 111, 0.12)',
        }}>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.1 }}>Find a customer session fast</h1>
          <p style={{ margin: '8px 0 18px', color: '#9ca3af', maxWidth: 760 }}>
            Search by session id, customer email, Stripe PaymentIntent id, quote id, booking reference, PNR, or supplier booking id.
            Sensitive document and token fields are redacted in this view.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 320px) minmax(220px, 1fr) auto', gap: 10 }}>
            <input
              type="password"
              value={secret}
              onChange={event => setSecret(event.target.value)}
              placeholder="ADMIN_SECRET"
              style={{
                border: '1px solid #294439',
                borderRadius: 12,
                background: '#020403',
                color: '#f8fafc',
                padding: '13px 14px',
                fontSize: 14,
                minWidth: 0,
              }}
            />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') void lookup();
              }}
              placeholder="Email, session id, pi_..., quote id, booking ref, PNR"
              style={{
                border: '1px solid #294439',
                borderRadius: 12,
                background: '#020403',
                color: '#f8fafc',
                padding: '13px 14px',
                fontSize: 14,
                minWidth: 0,
              }}
            />
            <button
              onClick={() => void lookup()}
              disabled={loading}
              style={{
                border: 'none',
                borderRadius: 12,
                background: '#00a76f',
                color: '#00150e',
                padding: '0 22px',
                fontWeight: 900,
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              {loading ? 'Searching...' : 'Lookup'}
            </button>
          </div>

          {error && (
            <p style={{
              margin: '14px 0 0',
              border: '1px solid #7f1d1d',
              background: '#2a0d0d',
              color: '#fecaca',
              borderRadius: 12,
              padding: 12,
            }}>
              {error}
            </p>
          )}
        </section>

        {result && (
          <div style={{ display: 'grid', gap: 18, marginTop: 18 }}>
            <section style={{
              border: '1px solid #1e3027',
              borderRadius: 16,
              background: '#08100c',
              padding: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>Timeline</h2>
                  <p style={{ margin: '4px 0 0', color: '#7c8b83', fontSize: 13 }}>
                    {totals} records found for <span style={{ color: '#d1fae5', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{result.query}</span>
                  </p>
                </div>
                <StatusPill value={`${result.timeline.length} timeline events`} />
              </div>

              {result.timeline.length === 0 ? (
                <p style={{ color: '#9ca3af' }}>No timeline events found.</p>
              ) : (
                <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
                  {result.timeline.map((item, index) => (
                    <div key={`${item.sourceTable}-${item.id}-${index}`} style={{
                      display: 'grid',
                      gridTemplateColumns: '170px 120px minmax(0, 1fr) auto',
                      gap: 12,
                      alignItems: 'center',
                      border: '1px solid #182820',
                      borderRadius: 12,
                      padding: 12,
                      background: '#050a07',
                    }}>
                      <div style={{ color: '#9ca3af', fontSize: 12 }}>{formatDate(item.at)}</div>
                      <StatusPill value={item.type} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{item.label}</div>
                        <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                          {item.sourceTable}{item.id ? ` · ${item.id}` : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {item.status && <StatusPill value={item.status} />}
                        {item.amount && <div style={{ color: '#d1fae5', fontSize: 12, marginTop: 4 }}>{item.amount}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 18 }}>
              {sections.map(section => (
                <Section key={section.key} title={section.title} rows={result[section.key]} />
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
