// Trip Canvas — the page that hosts the interactive canvas.
// Server component shell; the actual canvas is a client component because it
// reads sessionId from localStorage and manages a lot of state.

import { notFound } from 'next/navigation';
import CanvasPage from '@/components/canvas/CanvasPage';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  return <CanvasPage tripId={id} />;
}

export const metadata = {
  title: 'Your trip · FlexeTravels',
};

// Always render fresh — this page reads from session-scoped state.
export const dynamic = 'force-dynamic';
