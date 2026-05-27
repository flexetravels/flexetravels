import { NextResponse } from 'next/server';
import pkg from '@/package.json';

export const dynamic = 'force-dynamic';

function firstSet(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export async function GET() {
  const commit = firstSet(
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.RAILWAY_GIT_COMMIT,
    process.env.GITHUB_SHA,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.SOURCE_VERSION,
    process.env.NEXT_PUBLIC_BUILD_SHA,
  );

  return NextResponse.json({
    app: pkg.name,
    version: pkg.version,
    commit,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? 'unknown',
    railwayService: process.env.RAILWAY_SERVICE_NAME ?? null,
    generatedAt: new Date().toISOString(),
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
