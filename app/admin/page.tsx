'use client';
// ─── FlexeTravels Admin Panel ─────────────────────────────────────────────────
// Route: /admin
// Real-time diagnostic dashboard for searches, bookings, API health, and errors.
// Auth: set ADMIN_SECRET in .env.local; pass as ?secret=… in URL or X-Admin-Secret header.

import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types (mirrors lib/logger.ts) ────────────────────────────────────────────

type LogLevel  = 'info' | 'warn' | 'error';
type ApiSource = 'duffel' | 'liteapi' | 'amadeus' | 'stripe' | 'gemini' | 'grok' | 'opentripmap' | 'foursquare' | 'unsplash' | 'system';
type EventType = 'flight_search' | 'hotel_search' | 'experience_search' | 'flight_booking'
  | 'hotel_prebook' | 'hotel_booking' | 'stripe_payment' | 'offer_verify' | 'api_error' | 'system';

interface LogEntry {
  id:          string;
  ts:          string;
  level:       LogLevel;
  event:       EventType;
  api:         ApiSource;
  sessionId?:  string;
  durationMs?: number;
  params?:     Record<string, unknown>;
  resultCount?: number;
  sources?:    string[];
  bookingRef?: string;
  orderId?:    string;
  amount?:     number;
  currency?:   string;
  success:     boolean;
  httpStatus?: number;
  errorCode?:  string;
  error?:      string;
  detail?:     Record<string, unknown>;
}

interface ApiStats {
  total: number; ok: number; fail: number; avgMs: number;
}

interface Stats {
  window:   string;
  total:    number;
  memory:   number;
  apis:     { duffel: ApiStats; liteapi: ApiStats; amadeus: ApiStats; stripe: ApiStats };
  searches: { flights: number; hotels: number; experiences: number };
  bookings: {
    flights: { total: number; ok: number; failed: number };
    hotels:  { total: number; ok: number; failed: number };
  };
  errors:   LogEntry[];
}

interface DuffelCheck {
  tokenPresent?:  boolean;
  tokenMode?:     string;
  tokenPrefix?:   string;
  connectivity?:  Record<string, unknown>;
  balance?:       Record<string, unknown>;
  offerSmoke?:    Record<string, unknown>;
  diagnosis?:     string[];
  fixes?:         string[];
  whyHotelWorksDuffelDoesnt?: string;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-CA', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA') + ' ' + fmtTime(iso);
}
function fmtMs(ms?: number) {
  if (!ms) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
function successRate(s: ApiStats) {
  if (!s.total) return '—';
  return `${Math.round((s.ok / s.total) * 100)}%`;
}
function successColor(s: ApiStats) {
  if (!s.total) return '#888';
  const r = s.ok / s.total;
  return r >= 0.9 ? '#22c55e' : r >= 0.7 ? '#f59e0b' : '#ef4444';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Badge({ text, color }: { text: string; color?: string }) {
  const bg = color ?? '#334155';
  return (
    <span style={{
      background: bg, color: '#fff', borderRadius: 4, padding: '1px 7px',
      fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
    }}>{text}</span>
  );
}

function EventBadge({ event }: { event: EventType }) {
  const map: Record<EventType, [string, string]> = {
    flight_search:    ['✈ flight search', '#1d4ed8'],
    hotel_search:     ['🏨 hotel search',  '#0e7490'],
    experience_search:['🗺 experience',    '#7e22ce'],
    flight_booking:   ['✈ book flight',   '#15803d'],
    hotel_prebook:    ['🔒 prebook hotel','#b45309'],
    hotel_booking:    ['🏨 book hotel',   '#0f766e'],
    stripe_payment:   ['💳 stripe',       '#4f46e5'],
    offer_verify:     ['🔍 verify offer', '#475569'],
    api_error:        ['⚠ api error',     '#b91c1c'],
    system:           ['⚙ system',        '#374151'],
  };
  const [label, color] = map[event] ?? [event, '#374151'];
  return <Badge text={label} color={color} />;
}

function ApiCard({ name, stats }: { name: string; stats: ApiStats }) {
  const rate  = successRate(stats);
  const color = successColor(stats);
  return (
    <div style={{ background: '#1e293b', borderRadius: 8, padding: '14px 18px', minWidth: 140 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>{name}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{rate}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
        {stats.ok}/{stats.total} ok · {fmtMs(stats.avgMs)} avg
      </div>
    </div>
  );
}

function EntryRow({ e, onSelect, selected }: { e: LogEntry; onSelect: (e: LogEntry) => void; selected: boolean }) {
  const bg = selected ? '#1e3a5f' : e.level === 'error' ? '#1c1010' : e.level === 'warn' ? '#1c1800' : 'transparent';
  return (
    <tr
      onClick={() => onSelect(e)}
      style={{ cursor: 'pointer', background: bg, borderBottom: '1px solid #1e293b' }}
    >
      <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
        {fmtTime(e.ts)}
      </td>
      <td style={{ padding: '6px 8px' }}>
        <EventBadge event={e.event} />
      </td>
      <td style={{ padding: '6px 8px' }}>
        <Badge text={e.api} color={e.success ? '#1e3a1e' : '#3a1e1e'} />
      </td>
      <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11, color: '#94a3b8' }}>
        {e.sessionId ? e.sessionId.slice(0, 12) + '…' : '—'}
      </td>
      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
        <span style={{ fontSize: 16 }}>{e.success ? '✅' : '❌'}</span>
      </td>
      <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 12, color: '#94a3b8' }}>
        {fmtMs(e.durationMs)}
      </td>
      <td style={{ padding: '6px 8px', fontSize: 12, color: e.error ? '#f87171' : '#94a3b8', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {e.error ?? (e.bookingRef ? `ref: ${e.bookingRef}` : e.resultCount !== undefined ? `${e.resultCount} results` : '—')}
      </td>
    </tr>
  );
}

function DetailPanel({ entry, onClose }: { entry: LogEntry; onClose: () => void }) {
  return (
    <div style={{
      background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
      padding: 20, position: 'sticky', top: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Transaction Detail</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>

      <Field label="Timestamp"   value={fmtDate(entry.ts)} />
      <Field label="ID"          value={entry.id} mono />
      <Field label="Event"       value={entry.event} />
      <Field label="API"         value={entry.api} />
      <Field label="Session"     value={entry.sessionId ?? '—'} mono />
      <Field label="Success"     value={entry.success ? '✅ Yes' : '❌ No'} />
      {entry.httpStatus && <Field label="HTTP Status" value={String(entry.httpStatus)} />}
      {entry.errorCode  && <Field label="Error Code"  value={entry.errorCode} mono />}
      {entry.durationMs && <Field label="Latency"     value={fmtMs(entry.durationMs)} />}
      {entry.resultCount !== undefined && <Field label="Results" value={String(entry.resultCount)} />}
      {entry.sources    && <Field label="Sources"     value={entry.sources.join(', ')} />}
      {entry.bookingRef && <Field label="Booking Ref" value={entry.bookingRef} mono />}
      {entry.orderId    && <Field label="Order ID"    value={entry.orderId} mono />}
      {entry.amount     && <Field label="Amount"      value={`${entry.amount} ${entry.currency ?? ''}`} />}

      {entry.error && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>ERROR</div>
          <div style={{ background: '#1c0a0a', border: '1px solid #7f1d1d', borderRadius: 6, padding: 10, fontSize: 12, color: '#fca5a5', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {entry.error}
          </div>
        </div>
      )}

      {entry.params && (
        <JsonBlock label="Params" data={entry.params} />
      )}
      {entry.detail && (
        <JsonBlock label="Detail" data={entry.detail} />
      )}

      {/* Duffel-specific diagnosis */}
      {entry.event === 'flight_booking' && !entry.success && (
        <div style={{ marginTop: 16, background: '#1a1000', border: '1px solid #92400e', borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', marginBottom: 6 }}>⚡ Likely causes</div>
          {entry.errorCode === 'insufficient_balance' && (
            <div style={{ fontSize: 12, color: '#fde68a' }}>
              <strong>Duffel balance is $0.</strong> Top up at app.duffel.com → Settings → Balance → Top Up.<br />
              This is why hotel works (LiteAPI uses its own sandbox card) but flights fail.
            </div>
          )}
          {entry.errorCode === 'offer_no_longer_available' && (
            <div style={{ fontSize: 12, color: '#fde68a' }}>
              <strong>Offer expired</strong> (Duffel test offers expire in ~15 minutes). User needs to re-search.
            </div>
          )}
          {!entry.errorCode && (
            <div style={{ fontSize: 12, color: '#fde68a' }}>
              Check /admin → Duffel Health tab for detailed diagnosis.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 11, color: '#64748b', width: 90, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: '#e2e8f0', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

function JsonBlock({ label, data }: { label: string; data: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        background: 'none', border: '1px solid #334155', borderRadius: 4, color: '#94a3b8',
        cursor: 'pointer', fontSize: 11, padding: '2px 8px', marginBottom: 4,
      }}>
        {open ? '▼' : '▶'} {label}
      </button>
      {open && (
        <pre style={{
          background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
          padding: 10, fontSize: 11, color: '#94a3b8', overflow: 'auto', maxHeight: 200,
          fontFamily: 'monospace',
        }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'logs' | 'bookings' | 'errors' | 'duffel';

export default function AdminPage() {
  const [tab,          setTab         ] = useState<Tab>('logs');
  const [logs,         setLogs         ] = useState<LogEntry[]>([]);
  const [stats,        setStats        ] = useState<Stats | null>(null);
  const [duffelCheck,  setDuffelCheck  ] = useState<DuffelCheck | null>(null);
  const [selected,     setSelected     ] = useState<LogEntry | null>(null);
  const [loading,      setLoading      ] = useState(false);
  const [duffelLoading,setDuffelLoading] = useState(false);
  const [filterEvent,  setFilterEvent  ] = useState('');
  const [filterApi,    setFilterApi    ] = useState('');
  const [filterSession,setFilterSession] = useState('');
  const [filterSuccess,setFilterSuccess] = useState('');
  const [autoRefresh,  setAutoRefresh  ] = useState(false);
  const [lastRefresh,  setLastRefresh  ] = useState<Date | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Secret from URL if set
  const secret = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('secret') ?? ''
    : '';
  const authHeader: Record<string, string> = secret ? { 'X-Admin-Secret': secret } : {};

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterEvent)   params.set('event',     filterEvent);
      if (filterApi)     params.set('api',        filterApi);
      if (filterSession) params.set('sessionId',  filterSession);
      if (filterSuccess) params.set('success',    filterSuccess);
      if (secret)        params.set('secret',     secret);
      params.set('limit', '300');

      const [logsRes, statsRes] = await Promise.all([
        fetch(`/api/admin/logs?${params}`,  { headers: authHeader }),
        fetch(`/api/admin/stats?${secret ? 'secret=' + secret : ''}`, { headers: authHeader }),
      ]);

      if (logsRes.ok) {
        const data = await logsRes.json() as { logs: LogEntry[] };
        setLogs(data.logs);
      }
      if (statsRes.ok) {
        setStats(await statsRes.json() as Stats);
      }
      setLastRefresh(new Date());
    } catch {/* ignore */}
    setLoading(false);
  }, [filterEvent, filterApi, filterSession, filterSuccess, secret]);

  const fetchDuffelCheck = async () => {
    setDuffelLoading(true);
    try {
      const res = await fetch(`/api/admin/duffel-check?${secret ? 'secret=' + secret : ''}`, { headers: authHeader });
      if (res.ok) setDuffelCheck(await res.json() as DuffelCheck);
    } catch {/* ignore */}
    setDuffelLoading(false);
  };

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => { void fetchLogs(); }, 10_000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchLogs]);

  const bookingLogs  = logs.filter(l => ['flight_booking','hotel_booking','hotel_prebook','stripe_payment'].includes(l.event));
  const errorLogs    = logs.filter(l => l.level === 'error' || !l.success);

  const S: React.CSSProperties = { fontFamily: 'system-ui, -apple-system, sans-serif', color: '#e2e8f0', minHeight: '100vh', background: '#020617', fontSize: 14 };
  const navStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13,
    background: active ? '#1d4ed8' : 'transparent', color: active ? '#fff' : '#94a3b8',
    border: 'none',
  });
  const thStyle: React.CSSProperties = {
    padding: '8px 10px', textAlign: 'left', fontSize: 11, color: '#64748b',
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
    borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap',
  };

  return (
    <div style={S}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid #1e293b', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: '#38bdf8' }}>⚡ FlexeTravels Admin</span>
        <span style={{ color: '#475569', fontSize: 13 }}>Diagnostic Panel</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastRefresh && <span style={{ fontSize: 11, color: '#475569' }}>Refreshed {lastRefresh.toLocaleTimeString()}</span>}
          <label style={{ fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh (10s)
          </label>
          <button onClick={() => void fetchLogs()} disabled={loading} style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
            color: '#94a3b8', cursor: 'pointer', padding: '6px 14px', fontSize: 12,
          }}>
            {loading ? '↻ Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {stats && (
        <div style={{ padding: '16px 24px', display: 'flex', gap: 12, flexWrap: 'wrap', borderBottom: '1px solid #1e293b' }}>
          <ApiCard name="Duffel"  stats={stats.apis.duffel}  />
          <ApiCard name="LiteAPI" stats={stats.apis.liteapi} />
          <ApiCard name="Amadeus" stats={stats.apis.amadeus} />
          <ApiCard name="Stripe"  stats={stats.apis.stripe}  />
          <div style={{ background: '#1e293b', borderRadius: 8, padding: '14px 18px', minWidth: 140 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Searches (1h)</div>
            <div style={{ fontSize: 12, color: '#e2e8f0' }}>✈ {stats.searches.flights} flights</div>
            <div style={{ fontSize: 12, color: '#e2e8f0' }}>🏨 {stats.searches.hotels} hotels</div>
            <div style={{ fontSize: 12, color: '#e2e8f0' }}>🗺 {stats.searches.experiences} exp</div>
          </div>
          <div style={{ background: '#1e293b', borderRadius: 8, padding: '14px 18px', minWidth: 160 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Bookings (1h)</div>
            <div style={{ fontSize: 12 }}>
              <span style={{ color: '#22c55e' }}>✓ {stats.bookings.flights.ok}</span>
              <span style={{ color: '#64748b' }}>/</span>
              <span style={{ color: '#ef4444' }}>✗ {stats.bookings.flights.failed}</span>
              <span style={{ color: '#64748b' }}> flights</span>
            </div>
            <div style={{ fontSize: 12 }}>
              <span style={{ color: '#22c55e' }}>✓ {stats.bookings.hotels.ok}</span>
              <span style={{ color: '#64748b' }}>/</span>
              <span style={{ color: '#ef4444' }}>✗ {stats.bookings.hotels.failed}</span>
              <span style={{ color: '#64748b' }}> hotels</span>
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{stats.memory} entries in memory</div>
          </div>
        </div>
      )}

      {/* Nav */}
      <div style={{ padding: '10px 24px', display: 'flex', gap: 4, borderBottom: '1px solid #1e293b' }}>
        <button style={navStyle(tab === 'logs')}     onClick={() => setTab('logs')}>All Logs ({logs.length})</button>
        <button style={navStyle(tab === 'bookings')} onClick={() => setTab('bookings')}>Bookings ({bookingLogs.length})</button>
        <button style={navStyle(tab === 'errors')}   onClick={() => setTab('errors')}>
          <span style={{ color: errorLogs.length > 0 ? '#f87171' : 'inherit' }}>Errors ({errorLogs.length})</span>
        </button>
        <button style={navStyle(tab === 'duffel')}   onClick={() => { setTab('duffel'); if (!duffelCheck) void fetchDuffelCheck(); }}>
          Duffel Health
        </button>
      </div>

      {/* Filters */}
      {(tab === 'logs' || tab === 'bookings' || tab === 'errors') && (
        <div style={{ padding: '10px 24px', display: 'flex', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid #1e293b', background: '#0a1628' }}>
          <FilterInput label="Event" value={filterEvent}   onChange={setFilterEvent}   placeholder="e.g. flight_booking" />
          <FilterInput label="API"   value={filterApi}     onChange={setFilterApi}     placeholder="e.g. duffel" />
          <FilterInput label="Session" value={filterSession} onChange={setFilterSession} placeholder="session ID prefix" />
          <select value={filterSuccess} onChange={e => setFilterSuccess(e.target.value)} style={selectStyle}>
            <option value="">All outcomes</option>
            <option value="true">✅ Success only</option>
            <option value="false">❌ Failed only</option>
          </select>
          <button onClick={() => void fetchLogs()} style={{
            background: '#1d4ed8', border: 'none', borderRadius: 6, color: '#fff',
            cursor: 'pointer', padding: '6px 14px', fontSize: 12, fontWeight: 600,
          }}>Apply</button>
          <button onClick={() => { setFilterEvent(''); setFilterApi(''); setFilterSession(''); setFilterSuccess(''); }} style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8',
            cursor: 'pointer', padding: '6px 14px', fontSize: 12,
          }}>Clear</button>
        </div>
      )}

      {/* Content */}
      <div style={{ display: 'flex', gap: 0, flex: 1 }}>

        {/* Main table */}
        <div style={{ flex: 1, overflow: 'auto', maxHeight: 'calc(100vh - 280px)' }}>

          {/* Duffel Health Tab */}
          {tab === 'duffel' && (
            <div style={{ padding: 24 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Duffel API Health Check</h2>
                <button onClick={() => void fetchDuffelCheck()} disabled={duffelLoading} style={{
                  background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
                  color: '#94a3b8', cursor: 'pointer', padding: '6px 14px', fontSize: 12,
                }}>
                  {duffelLoading ? '↻ Running checks…' : '↻ Run checks'}
                </button>
              </div>

              {!duffelCheck && !duffelLoading && (
                <p style={{ color: '#64748b' }}>Click "Run checks" to diagnose Duffel connectivity and booking capability.</p>
              )}

              {duffelCheck && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                  {/* Diagnosis banner */}
                  {duffelCheck.diagnosis?.map((d, i) => (
                    <div key={i} style={{
                      background: d.startsWith('✅') ? '#052e16' : d.startsWith('💰') ? '#1c2820' : '#1c0a0a',
                      border: `1px solid ${d.startsWith('✅') ? '#16a34a' : d.startsWith('💰') ? '#166534' : '#b91c1c'}`,
                      borderRadius: 8, padding: '12px 16px', fontSize: 14, color: '#e2e8f0',
                    }}>{d}</div>
                  ))}

                  {duffelCheck.fixes && duffelCheck.fixes.length > 0 && (
                    <div style={{ background: '#1a1000', border: '1px solid #92400e', borderRadius: 8, padding: 16 }}>
                      <div style={{ fontWeight: 700, color: '#fbbf24', marginBottom: 8 }}>🔧 How to fix</div>
                      {duffelCheck.fixes.map((f, i) => (
                        <div key={i} style={{ fontSize: 13, color: '#fde68a', marginBottom: 4 }}>→ {f}</div>
                      ))}
                    </div>
                  )}

                  {duffelCheck.whyHotelWorksDuffelDoesnt && (
                    <div style={{ background: '#0c1a2e', border: '1px solid #1d4ed8', borderRadius: 8, padding: 16 }}>
                      <div style={{ fontWeight: 700, color: '#60a5fa', marginBottom: 8 }}>ℹ Why hotel works but Duffel doesn&apos;t</div>
                      <div style={{ fontSize: 13, color: '#bfdbfe' }}>{duffelCheck.whyHotelWorksDuffelDoesnt}</div>
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                    <CheckCard title="Token" data={{
                      'Mode':    duffelCheck.tokenMode ?? '—',
                      'Prefix':  duffelCheck.tokenPrefix ?? '—',
                      'Present': duffelCheck.tokenPresent ? 'Yes' : 'No',
                    }} />
                    <CheckCard title="Connectivity" data={duffelCheck.connectivity ?? {}} />
                    <CheckCard title="Balance"      data={duffelCheck.balance      ?? {}} />
                    <CheckCard title="Offer Smoke Test" data={duffelCheck.offerSmoke ?? {}} />
                  </div>

                  <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 16 }}>
                    <div style={{ fontWeight: 700, color: '#94a3b8', marginBottom: 12 }}>Payment Model Explained</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div>
                        <div style={{ fontWeight: 600, color: '#38bdf8', marginBottom: 6 }}>✈ Duffel (Flights)</div>
                        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
                          Uses <code style={{ color: '#fde68a' }}>type: &quot;balance&quot;</code> — debits from your pre-funded Duffel account.<br />
                          <strong style={{ color: '#f87171' }}>Test mode requires a test balance top-up.</strong><br />
                          Production: customer pays you → you fund Duffel balance → Duffel pays airline.
                        </div>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: '#22d3ee', marginBottom: 6 }}>🏨 LiteAPI (Hotels)</div>
                        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
                          Uses a sandbox credit card (<code style={{ color: '#fde68a' }}>4242…</code>) in test mode — <strong style={{ color: '#22c55e' }}>no balance needed.</strong><br />
                          Production: use Duffel Payments API or collect separately via Stripe.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Log tables */}
          {tab !== 'duffel' && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#0f172a', zIndex: 1 }}>
                <tr>
                  <th style={thStyle}>Time</th>
                  <th style={thStyle}>Event</th>
                  <th style={thStyle}>API</th>
                  <th style={thStyle}>Session</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>OK</th>
                  <th style={thStyle}>Latency</th>
                  <th style={thStyle}>Info / Error</th>
                </tr>
              </thead>
              <tbody>
                {(tab === 'logs' ? logs : tab === 'bookings' ? bookingLogs : errorLogs).map(e => (
                  <EntryRow
                    key={e.id}
                    e={e}
                    onSelect={setSelected}
                    selected={selected?.id === e.id}
                  />
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#475569' }}>
                      No log entries yet. Run a search or booking in the app to see data here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail panel */}
        {selected && tab !== 'duffel' && (
          <div style={{ width: 340, flexShrink: 0, borderLeft: '1px solid #1e293b', padding: 16, overflow: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
            <DetailPanel entry={selected} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  background: '#0f172a', border: '1px solid #334155', borderRadius: 6,
  color: '#94a3b8', padding: '5px 10px', fontSize: 12,
};

function FilterInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: '#64748b' }}>{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...selectStyle, width: 160 }}
      />
    </div>
  );
}

function CheckCard({ title, data }: { title: string; data: Record<string, unknown> }) {
  const hasError = 'error' in data || data.ok === false;
  return (
    <div style={{
      background: '#0f172a',
      border: `1px solid ${hasError ? '#7f1d1d' : '#1e293b'}`,
      borderRadius: 8, padding: 14,
    }}>
      <div style={{ fontWeight: 700, color: '#94a3b8', marginBottom: 10, fontSize: 13 }}>{title}</div>
      {Object.entries(data).map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: '#64748b', width: 110, flexShrink: 0 }}>{k}</span>
          <span style={{
            fontSize: 11, fontFamily: 'monospace',
            color: v === true ? '#22c55e' : v === false ? '#ef4444' : '#e2e8f0',
            wordBreak: 'break-all',
          }}>
            {v === null || v === undefined ? '—' : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}
