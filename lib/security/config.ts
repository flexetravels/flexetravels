// ─── Security Configuration ───────────────────────────────────────────────────
// Single source of truth for all DDoS, rate-limit, circuit-breaker, and
// bot-detection settings. Adjust values here — they propagate to every module.

export const SECURITY_CONFIG = {
  // ── Per-route rate limits ────────────────────────────────────────────────────
  // Used by the persistent rate limiter in route handlers.
  rateLimits: {
    global:  { maxRequests: 100, windowMs: 60_000 },  // across ALL routes, per IP
    chat:    { maxRequests: 15,  windowMs: 60_000 },  // LLM cost protection
    booking: { maxRequests: 3,   windowMs: 60_000 },  // Stripe + Duffel + LiteAPI
    stripe:  { maxRequests: 5,   windowMs: 60_000 },  // PaymentIntent creation
    search:  { maxRequests: 20,  windowMs: 60_000 },  // hotel-detail, discover
    admin:   { maxRequests: 20,  windowMs: 60_000 },  // stats, debug endpoints
    health:  { maxRequests: 30,  windowMs: 60_000 },  // /api/health
    webhook: { maxRequests: 60,  windowMs: 60_000 },  // Stripe/Duffel webhooks
  },

  // ── Burst / DDoS detection (in-memory, applied in middleware) ────────────────
  ddos: {
    burstThreshold:     50,          // requests in burstWindowMs triggers temp block
    burstWindowMs:      10_000,      // 10-second burst window
    blockDurationMs:    300_000,     // 5 min base block for burst violations
    escalationFactor:   2,           // multiply block duration on each repeat offense
    maxBlockDurationMs: 86_400_000,  // cap escalation at 24 hours
  },

  // ── Circuit breaker (for external API calls: Duffel, LiteAPI, Stripe, Gemini)
  circuitBreaker: {
    errorThreshold: 0.5,    // open circuit when ≥50% of requests in window fail
    minRequests:    5,      // require this many requests before evaluating threshold
    windowMs:       60_000, // 1-minute rolling window
    cooldownMs:     30_000, // stay open for 30 s, then allow one half-open probe
  },

  // ── Concurrency caps for expensive endpoints ─────────────────────────────────
  maxConcurrent: {
    chat:    5,   // /api/chat — each request costs Anthropic credits
    search:  10,  // aggregator searches
    booking: 3,   // /api/book-trip — touches Stripe + Duffel + LiteAPI
  },
  concurrentQueueTimeoutMs: 10_000, // drop queued request after 10 s

  // ── Request body size limits (bytes) ─────────────────────────────────────────
  // Checked via Content-Length header in middleware (before body is parsed).
  requestSizeLimits: {
    '/api/chat':           512_000, // 500 KB — chat history includes flight/hotel data
    '/api/book-trip':      51_200,  // 50 KB — passenger data for multi-pax bookings
    '/api/stripe/prepare': 5_120,   // 5 KB
    default:               20_480,  // 20 KB for all other POST/PUT routes
  } as Record<string, number>,

  // ── Bot detection patterns ───────────────────────────────────────────────────
  // Requests whose User-Agent matches any of these are blocked, UNLESS they
  // also match legitimateBots.
  knownBotPatterns: [
    /masscan/i,
    /zgrab/i,
    /nikto/i,
    /sqlmap/i,
    /nmap/i,
    /nessus/i,
    /acunetix/i,
    /burpsuite/i,
    /dirbuster/i,
    /hydra/i,
    /python-requests\//i,
    /go-http-client\//i,
    /curl\//i,
    /wget\//i,
    /libwww-perl/i,
    /java\//i,
    /scrapy/i,
    /mechanize/i,
    /headlesschrome/i,
    /phantomjs/i,
  ] as RegExp[],

  // ── Legitimate crawlers — bypass the bot block list ──────────────────────────
  legitimateBots: [
    /googlebot/i,
    /bingbot/i,
    /slurp/i,
    /duckduckbot/i,
    /baiduspider/i,
    /yandexbot/i,
    /facebot/i,
    /twitterbot/i,
    /linkedinbot/i,
    /applebot/i,
    /vercelbot/i,
  ] as RegExp[],

  // ── Geo-blocking ─────────────────────────────────────────────────────────────
  // Set ALLOWED_COUNTRIES env var (comma-separated ISO-3166-1 alpha-2 codes)
  // to restrict traffic to specific countries. Leave unset to allow all.
  // Country is read from Cloudflare's CF-IPCountry header (Railway → Cloudflare).
  geoHeaders: ['cf-ipcountry', 'x-vercel-ip-country', 'x-country-code'] as string[],
};
