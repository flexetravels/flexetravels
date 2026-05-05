// ─── Hotel photo categorizer ────────────────────────────────────────────────
// LiteAPI's /data/hotel returns a flat list of photos with optional captions
// like "Standard double room", "Pool deck", "Lobby", "Restaurant". We bucket
// them so:
//   - the room-rate cards cycle through ROOM photos (one per rate)
//   - the gallery's category chips can filter by room / amenity / facility
//   - when captions are absent we fall back to round-robin so the UI still
//     shows variety instead of repeating the hotel's exterior thumbnail
//
// Pure, no React, no fetch — exhaustively unit-testable.

export type PhotoCategory =
  | 'room'
  | 'exterior'
  | 'lobby'
  | 'restaurant'
  | 'pool'
  | 'amenity'      // gym, spa, business centre, kids club, etc.
  | 'view'         // sea/ocean/mountain/sky views
  | 'bathroom'
  | 'other';

export interface RawPhoto {
  url:         string;
  caption?:    string;
  isDefault?:  boolean;
}

export interface CategorizedPhoto {
  url:        string;
  caption?:   string;
  isDefault?: boolean;
  category:   PhotoCategory;
}

const CATEGORY_RULES: Array<{ test: RegExp; cat: PhotoCategory }> = [
  // Order matters — first match wins. Specific anchor words win over the
  // more generic "lobby" rule (which would otherwise capture "Spa entrance"
  // because of "entrance").
  { cat: 'bathroom',   test: /\b(bath(room)?|shower|wc|toilet|vanity)\b/i },
  { cat: 'pool',       test: /\bpool|swim(ming)?\b/i },
  { cat: 'restaurant', test: /\b(restaurant|dining|breakfast|cafe|café|bar|lounge|kitchen|food|cuisine)\b/i },
  // Amenities come BEFORE lobby so phrases like "Spa entrance" classify as
  // amenity (their distinguishing word is the amenity, not the entrance).
  { cat: 'amenity',    test: /\b(gym|fitness|spa|sauna|wellness|massage|business|meeting|conference|kids?|children|games?|library|garden|courtyard|patio)\b/i },
  { cat: 'lobby',      test: /\b(lobby|reception|entrance|foyer|hall(way)?|corridor)\b/i },
  { cat: 'view',       test: /\b(view|sea|ocean|mountain|skyline|terrace|balcony|panoram)/i },
  { cat: 'exterior',   test: /\b(exterior|fa[cç]ade|outside|building|street|aerial)\b/i },
  // Room is broad — match last so it doesn't catch "pool ROOM", "bathROOM"
  { cat: 'room',       test: /\b(room|suite|king|queen|double|twin|single|deluxe|standard|junior|family|studio|bedroom|bed)\b/i },
];

export function categorize(caption: string | undefined): PhotoCategory {
  if (!caption) return 'other';
  for (const rule of CATEGORY_RULES) {
    if (rule.test.test(caption)) return rule.cat;
  }
  return 'other';
}

export function categorizePhotos(photos: RawPhoto[]): CategorizedPhoto[] {
  return (photos ?? [])
    .filter(p => p && typeof p.url === 'string' && p.url.length > 0)
    .map(p => ({ ...p, category: categorize(p.caption) }));
}

/**
 * Pick a photo for the Nth room card.
 *
 * Prefers room-tagged photos (round-robin by index) so each room card shows
 * a distinct image. Falls back to any non-exterior photo, then to the full
 * gallery, so we never render a blank card.
 */
export function pickRoomPhoto(photos: CategorizedPhoto[], roomIndex: number): string | null {
  if (!photos || photos.length === 0) return null;
  const rooms = photos.filter(p => p.category === 'room');
  if (rooms.length > 0) {
    return rooms[roomIndex % rooms.length].url;
  }
  // Fallback 1: anything that isn't the hotel exterior, so room cards don't
  // all show the same shot of the building.
  const nonExterior = photos.filter(p => p.category !== 'exterior');
  if (nonExterior.length > 0) {
    return nonExterior[roomIndex % nonExterior.length].url;
  }
  // Fallback 2: round-robin the full gallery
  return photos[roomIndex % photos.length].url;
}

export interface CategoryBucket {
  category: PhotoCategory;
  label:    string;
  photos:   CategorizedPhoto[];
}

export const CATEGORY_LABELS: Record<PhotoCategory, string> = {
  room:       'Rooms',
  exterior:   'Exterior',
  lobby:      'Lobby',
  restaurant: 'Dining',
  pool:       'Pool',
  amenity:    'Amenities',
  view:       'Views',
  bathroom:   'Bathrooms',
  other:      'Other',
};

const CATEGORY_DISPLAY_ORDER: PhotoCategory[] = [
  'room', 'exterior', 'view', 'pool', 'restaurant', 'amenity', 'lobby', 'bathroom', 'other',
];

/**
 * Bucket photos by category, ordered for display (rooms first).
 * Empty buckets are dropped so the UI doesn't render dead chips.
 */
export function bucketPhotos(photos: CategorizedPhoto[]): CategoryBucket[] {
  const map = new Map<PhotoCategory, CategorizedPhoto[]>();
  for (const p of photos) {
    if (!map.has(p.category)) map.set(p.category, []);
    map.get(p.category)!.push(p);
  }
  return CATEGORY_DISPLAY_ORDER
    .filter(c => map.has(c))
    .map(c => ({ category: c, label: CATEGORY_LABELS[c], photos: map.get(c)! }));
}
