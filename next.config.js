/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output — minimal Docker image for Railway (~50MB vs ~500MB)
  output: 'standalone',

  // Skip ESLint during production builds — lint is enforced in CI/pre-commit instead
  eslint: { ignoreDuringBuilds: true },
  // Skip TypeScript type errors from blocking builds (type-check in CI separately)
  typescript: { ignoreBuildErrors: true },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'plus.unsplash.com' },
      { protocol: 'https', hostname: 'source.unsplash.com' },
      // Airline logos
      { protocol: 'https', hostname: 'pics.avs.io' },
      { protocol: 'https', hostname: 'assets.duffel.com' },
      { protocol: 'https', hostname: '*.duffel.com' },
      // Hotel images (LiteAPI CDN)
      { protocol: 'https', hostname: '*.liteapi.travel' },
      { protocol: 'https', hostname: 'photos.liteapi.travel' },
      { protocol: 'https', hostname: 'static.cupid.travel' },
      { protocol: 'https', hostname: '*.cupid.travel' },
      // Hotel images (backend / SerpAPI)
      { protocol: 'https', hostname: '*.googleusercontent.com' },
      { protocol: 'https', hostname: '*.googleapis.com' },
      { protocol: 'https', hostname: '*.booking.com' },
      { protocol: 'https', hostname: '*.expediagroup.com' },
      { protocol: 'https', hostname: '*.hotels.com' },
      // OpenTripMap experience images (Wikipedia / Wikimedia)
      { protocol: 'https', hostname: '*.wikimedia.org' },
      { protocol: 'https', hostname: '*.wikipedia.org' },
      // General CDNs
      { protocol: 'https', hostname: '**.amazonaws.com' },
      { protocol: 'https', hostname: '**.cloudfront.net' },
    ],
  },

  // ── Security headers ────────────────────────────────────────────────────────
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Prevent clickjacking
          { key: 'X-Frame-Options', value: 'DENY' },
          // Prevent MIME-type sniffing
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Limit referrer info sent to third-party sites
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Disable unnecessary browser features
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          // Basic XSS protection (belt + suspenders alongside CSP)
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
      {
        // Static assets — immutable cache (1 year, content-hashed by Next.js)
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // API routes — no caching, no credentials leaking
        source: '/api/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },

  // ── Proxy to existing FastAPI backend for legacy tool calls ────────────────
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) return [];  // Skip proxy if BACKEND_URL not set
    return [
      {
        source:      '/api/backend/:path*',
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
