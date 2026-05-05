// ─── Destination media — themed fallback only ───────────────────────────────
// Used when /api/canvas/photos hasn't resolved yet (or returned 404). The
// real photos for a leg come from Unsplash's search API via that endpoint —
// see lib/canvas/unsplash-photos.ts. This file's job is only to give the
// UI something rich to paint instantly while the live fetch is in flight,
// and to act as a graceful no-network fallback.
//
// History: the previous version of this file held a hand-curated DESTINATIONS
// map of 20 cities + Pexels reel URLs. The Pexels CDN URL pattern needs an
// API-key-issued filename, so every reel returned 403; several Unsplash IDs
// also went stale (404). We pulled all of that out — the current static
// content is just three vibe-themed photo bundles, picked deterministically
// by hashing the city name.

export interface DestinationMedia {
  hero:    string;            // Unsplash URL — 1600w hero
  gallery: string[];          // 4–6 Unsplash URLs — 800w portrait/landscape mix
  vibe?:   string;            // one-word descriptor e.g. "tropical" — optional, used as a tag
}

const u = (id: string, w = 1600) => `https://images.unsplash.com/photo-${id}?w=${w}&q=80&fit=crop&auto=format`;

const FALLBACKS: Record<'beach' | 'city' | 'mountain', DestinationMedia> = {
  beach: {
    hero: u('1507525428034-b723cf961d3e'),
    gallery: [
      u('1505881502353-a1986add3762', 800),
      u('1565008576549-57569a49371d', 800),
      u('1520454974749-611b7248ffdb', 800),
      u('1573843981267-be1999ff37cd', 800),
      u('1552074283-f88b62c7e84e', 800),
      u('1583846783214-7229a91b20ed', 800),
    ],
    vibe: 'tropical',
  },
  city: {
    hero: u('1502602898657-3e91760cbb34'),
    gallery: [
      u('1496442226666-8d4d0e62e6e9', 800),
      u('1513635269975-59663e0ac1ad', 800),
      u('1539037116277-4db20889f2d4', 800),
      u('1543783207-ec64e4d95325', 800),
      u('1555881400-74d7acaacd8b', 800),
      u('1524231757912-21f4fe3a7200', 800),
    ],
    vibe: 'urban',
  },
  mountain: {
    hero: u('1464822759023-fed622ff2c3b'),
    gallery: [
      u('1495567720989-cebdbdd97913', 800),
      u('1469474968028-56623f02e42e', 800),
      u('1500530855697-b586d89ba3ee', 800),
      u('1454496522488-7a8e488e8606', 800),
      u('1469522554290-031a76e9c75d', 800),
      u('1517999144091-3d9dca6d1e43', 800),
    ],
    vibe: 'highland',
  },
};

const BEACH_KEYWORDS    = /(beach|island|bay|coast|cay|reef|lagoon|gulf|caribbean|hawaii|riviera|cayo|vallarta|cabo|cancun|maui|punta|honolulu)/i;
const MOUNTAIN_KEYWORDS = /(mountain|alps|peak|valley|highland|sierra|andes|rockies|forest|lake|lago|park|national|aspen|whistler|tahoe|banff)/i;

function pickFallback(name: string): DestinationMedia {
  const n = (name || '').toLowerCase();
  if (BEACH_KEYWORDS.test(n))    return FALLBACKS.beach;
  if (MOUNTAIN_KEYWORDS.test(n)) return FALLBACKS.mountain;
  let h = 0;
  for (let i = 0; i < n.length; i++) h = ((h << 5) - h + n.charCodeAt(i)) | 0;
  const bucket = Math.abs(h) % 3;
  return bucket === 0 ? FALLBACKS.city : bucket === 1 ? FALLBACKS.beach : FALLBACKS.mountain;
}

export function getDestinationMedia(city: string, iata?: string): DestinationMedia {
  // Used as the instant placeholder while the live Unsplash fetch is pending.
  // The real photos come from /api/canvas/photos — see DayLegBlock.tsx.
  return pickFallback(city || iata || '');
}
