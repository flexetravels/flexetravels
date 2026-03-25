// ─── Admin: Transaction Logs API ─────────────────────────────────────────────
// GET /api/admin/logs?event=&api=&sessionId=&success=&since=&limit=&source=file
// Secured by ADMIN_SECRET env var (send via X-Admin-Secret header or ?secret= query param)

import { NextResponse } from 'next/server';
import { queryLogs, loadLogsFromFile, type EventType, type ApiSource } from '@/lib/logger';

function checkAuth(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return true; // no secret set → allow (dev mode)

  const headerSecret = req.headers.get('x-admin-secret');
  const url          = new URL(req.url);
  const querySecret  = url.searchParams.get('secret');
  return headerSecret === secret || querySecret === secret;
}

export async function GET(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url    = new URL(req.url);
  const p      = url.searchParams;

  const event     = p.get('event')     as EventType | null;
  const api       = p.get('api')       as ApiSource | null;
  const sessionId = p.get('sessionId') ?? undefined;
  const successRaw = p.get('success');
  const since     = p.get('since')     ?? undefined;
  const limit     = Math.min(parseInt(p.get('limit') ?? '200', 10), 1000);
  const source    = p.get('source');   // 'file' → read from disk instead of memory

  const success = successRaw === null ? undefined
    : successRaw === 'true' ? true
    : false;

  let logs = source === 'file'
    ? loadLogsFromFile(limit)
    : queryLogs({ event: event ?? undefined, api: api ?? undefined, sessionId, success, since, limit });

  // Apply filters when reading from file (queryLogs already filters memory)
  if (source === 'file') {
    if (event)     logs = logs.filter(l => l.event     === event);
    if (api)       logs = logs.filter(l => l.api       === api);
    if (sessionId) logs = logs.filter(l => l.sessionId === sessionId);
    if (success !== undefined) logs = logs.filter(l => l.success === success);
    logs = logs.slice(0, limit);
  }

  return NextResponse.json({ count: logs.length, logs });
}

// DELETE — clear in-memory logs
export async function DELETE(req: Request) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // We can only clear memory (file is append-only for safety)
  const { memoryLog } = await import('@/lib/logger') as unknown as { memoryLog: unknown[] };
  (memoryLog as unknown[]).length = 0;
  return NextResponse.json({ cleared: true });
}
