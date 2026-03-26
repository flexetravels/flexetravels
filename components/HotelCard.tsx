'use client';

/**
 * HotelCard — Magazine-cover style with expandable detail + room selector.
 * Hero image fills the top, name + stars as bold overlay.
 * "Details & Rooms" button lazily fetches /api/hotel-detail and shows:
 *   - Richer image gallery from LiteAPI
 *   - HTML description (truncatable)
 *   - Real facilities/amenities list
 *   - Check-in/out times + board type
 *   - All room types with rates for selection
 */

import Image from 'next/image';
import {
  MapPin, Wifi, Car, UtensilsCrossed, Waves,
  ChevronLeft, ChevronRight, Check, ChevronDown, ChevronUp,
  Clock, Users, Utensils, RefreshCw, Loader2,
} from 'lucide-react';
import { useState, useCallback, useRef } from 'react';
import { cn, formatPrice, formatDate } from '@/lib/utils';
import type { HotelResult } from '@/lib/types';

interface HotelDetailResponse {
  id:           string;
  name:         string;
  starRating?:  number;
  description?: string;   // HTML
  images?:      Array<{ url: string; caption?: string; isDefault?: boolean }>;
  amenities?:   string[];
  checkinTime?:  string;
  checkoutTime?: string;
  address?:     string;
  city?:        string;
  countryCode?: string;
  contact?:     { phone?: string; email?: string; website?: string };
}

interface HotelCardProps {
  hotel: HotelResult;
  onSelect?: (hotel: HotelResult) => void;
  selected?: boolean;
  compact?: boolean;
}

// ── Amenity icon map ──────────────────────────────────────────────────────────
const AMENITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  WiFi: Wifi, Parking: Car, Restaurant: UtensilsCrossed, Pool: Waves,
};

// Board-type labels
const BOARD_LABELS: Record<string, string> = {
  RO: 'Room Only', BB: 'Bed & Breakfast', HB: 'Half Board',
  FB: 'Full Board', AI: 'All Inclusive',
};

// ── Star row ──────────────────────────────────────────────────────────────────
function Stars({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} className={cn('w-3 h-3', i < count ? 'text-amber-400' : 'text-white/30')}
             viewBox="0 0 20 20" fill="currentColor">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

// ── Score badge (Booking.com style) ───────────────────────────────────────────
function ScoreBadge({ score }: { score: number }) {
  const bg =
    score >= 9   ? 'bg-emerald-500'
    : score >= 8 ? 'bg-teal-600'
    : score >= 7 ? 'bg-amber-500'
    : 'bg-orange-500';
  return (
    <div className={cn(
      'w-9 h-9 rounded-xl flex flex-col items-center justify-center text-white font-black text-[13px] shadow-lg',
      bg
    )}>
      {score.toFixed(1)}
    </div>
  );
}

// ── Hero image gallery ────────────────────────────────────────────────────────
function HeroGallery({
  images, primaryImage, hotelName, stars, score,
}: {
  images: string[]; primaryImage?: string; hotelName: string; stars: number; score: number;
}) {
  const all = primaryImage
    ? [primaryImage, ...images.filter(u => u !== primaryImage)]
    : images;
  const unique = Array.from(new Set(all)).filter(Boolean);
  const [idx, setIdx] = useState(0);
  const total = unique.length;
  const prev = useCallback((e: React.MouseEvent) => { e.stopPropagation(); setIdx(i => (i - 1 + total) % total); }, [total]);
  const next = useCallback((e: React.MouseEvent) => { e.stopPropagation(); setIdx(i => (i + 1) % total); }, [total]);
  const src = unique[idx] ?? '';

  return (
    <div className="relative h-40 sm:h-44 md:h-48 w-full overflow-hidden bg-muted group rounded-t-[13px]">
      {src && (
        <Image
          key={src}
          src={src}
          alt={`${hotelName} — ${idx + 1}`}
          fill
          className="object-cover transition-all duration-700 group-hover:scale-[1.02]"
          sizes="(max-width: 480px) 90vw, (max-width: 600px) 100vw, 480px"
          onError={e => { (e.target as HTMLImageElement).style.opacity = '0'; }}
        />
      )}

      {/* Dark gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent pointer-events-none" />

      {/* Hotel name + stars on image */}
      <div className="absolute bottom-0 inset-x-0 px-4 pb-3 z-10">
        <h3 className="text-white font-black text-base leading-tight line-clamp-1 drop-shadow-md">
          {hotelName}
        </h3>
        <div className="mt-1">
          <Stars count={stars} />
        </div>
      </div>

      {/* Score badge — top right */}
      <div className="absolute top-2.5 right-2.5 z-10">
        <ScoreBadge score={score} />
      </div>

      {/* Nav arrows */}
      {total > 1 && (
        <>
          <button onClick={prev} aria-label="Previous photo"
            className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10
                       w-9 h-9 rounded-full bg-black/50 text-white
                       flex items-center justify-center touch-manipulation
                       transition-opacity hover:bg-black/70
                       opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={next} aria-label="Next photo"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10
                       w-9 h-9 rounded-full bg-black/50 text-white
                       flex items-center justify-center touch-manipulation
                       transition-opacity hover:bg-black/70
                       opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
            <ChevronRight className="w-4 h-4" />
          </button>
          {/* Dot strip */}
          <div className="absolute bottom-2 right-12 z-10 flex gap-1.5 items-center">
            {unique.slice(0, 5).map((_, i) => (
              <button key={i} onClick={e => { e.stopPropagation(); setIdx(i); }}
                className={cn('w-1.5 h-1.5 rounded-full transition-all touch-manipulation',
                  i === idx ? 'bg-white w-3' : 'bg-white/50 hover:bg-white/80'
                )} aria-label={`Photo ${i + 1}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Detail image strip ────────────────────────────────────────────────────────
function DetailImageStrip({ images }: { images: Array<{ url: string; caption?: string }> }) {
  if (!images || images.length === 0) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-hide">
      {images.slice(0, 12).map((img, i) => (
        <div key={i} className="relative w-24 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-muted snap-start">
          <Image
            src={img.url}
            alt={img.caption ?? `Photo ${i + 1}`}
            fill
            className="object-cover"
            sizes="96px"
            onError={e => { (e.target as HTMLImageElement).style.opacity = '0'; }}
          />
        </div>
      ))}
    </div>
  );
}

// ── Room type card ─────────────────────────────────────────────────────────────
interface RoomType {
  offerId?: string;
  name?: string;
  maxOccupancy?: number;
  rates?: Array<{
    rateId?: string;
    name?: string;
    boardType?: string;
    boardName?: string;
    price?: number;
    currency?: string;
    commission?: number;
    refundable?: boolean;
  }>;
}

function RoomCard({
  room, isSelected, nights, currency, onSelect,
}: {
  room: RoomType;
  isSelected: boolean;
  nights: number;
  currency: string;
  onSelect: () => void;
}) {
  const cheapestRate = room.rates
    ?.filter(r => r.price != null)
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];

  const pricePerNight = cheapestRate?.price
    ? (nights > 1 ? cheapestRate.price / nights : cheapestRate.price)
    : null;

  const boardLabel = cheapestRate?.boardName
    ?? (cheapestRate?.boardType ? BOARD_LABELS[cheapestRate.boardType] ?? cheapestRate.boardType : null);

  const refundable = cheapestRate?.refundable ?? false;

  return (
    <div className={cn(
      'rounded-xl border p-3 transition-all cursor-pointer',
      isSelected
        ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20 shadow-sm shadow-teal-500/20'
        : 'border-border hover:border-teal-400 hover:bg-muted/40'
    )} onClick={onSelect}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate text-foreground">
            {room.name ?? 'Standard Room'}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {room.maxOccupancy && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Users className="w-2.5 h-2.5" /> {room.maxOccupancy}
              </span>
            )}
            {boardLabel && (
              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
                <Utensils className="w-2 h-2" /> {boardLabel}
              </span>
            )}
            {refundable ? (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">✓ Free cancel</span>
            ) : (
              <span className="text-[10px] text-rose-500 font-medium">Non-refundable</span>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          {pricePerNight != null ? (
            <>
              <p className="text-sm font-black text-foreground">{formatPrice(pricePerNight, cheapestRate?.currency ?? currency)}</p>
              <p className="text-[10px] text-muted-foreground">/night</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">—</p>
          )}
        </div>
      </div>
      {isSelected && (
        <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-teal-600 dark:text-teal-400">
          <Check className="w-3 h-3" /> Selected
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function HotelCard({ hotel, onSelect, selected, compact }: HotelCardProps) {
  const nights =
    hotel.checkIn && hotel.checkOut
      ? Math.round(
          (new Date(hotel.checkOut).getTime() - new Date(hotel.checkIn).getTime()) / 86_400_000
        )
      : 1;

  const galleryImages = hotel.images?.length ? hotel.images : hotel.image ? [hotel.image] : [];

  // ── Detail panel state ──────────────────────────────────────────────────────
  const [expanded, setExpanded]         = useState(false);
  const [detail, setDetail]             = useState<HotelDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [selectedRoomOfferId, setSelectedRoomOfferId] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (detail || detailLoading || !hotel.id) return;
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/hotel-detail?hotelId=${encodeURIComponent(hotel.id)}`);
      if (res.ok) {
        const data: HotelDetailResponse = await res.json();
        setDetail(data);
      }
    } catch {
      // non-fatal — detail panel degrades gracefully
    } finally {
      setDetailLoading(false);
    }
  }, [detail, detailLoading, hotel.id]);

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(prev => {
      if (!prev) fetchDetail();
      return !prev;
    });
  }, [fetchDetail]);

  // When a room is selected, build a modified HotelResult with the chosen room's offerId
  // and update pricing from the cheapest rate in that room type.
  const handleRoomSelect = useCallback((room: RoomType) => {
    const offerId = room.offerId;
    setSelectedRoomOfferId(offerId ?? null);

    // Build the modified hotel to pass up when user clicks "Select"
    if (!offerId) return;
    const cheapestRate = room.rates
      ?.filter(r => r.price != null)
      .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];

    pendingHotelRef.current = {
      ...hotel,
      bookingToken:  offerId,
      boardType:     cheapestRate?.boardType ?? hotel.boardType,
      boardName:     cheapestRate?.boardName ?? hotel.boardName,
      ...(cheapestRate?.price != null && nights > 0 ? {
        pricePerNight: Math.round(cheapestRate.price / nights * 100) / 100,
        totalPrice:    cheapestRate.price,
      } : {}),
    };
  }, [hotel, nights]);

  // Ref to hold the room-modified hotel until user clicks "Select"
  const pendingHotelRef = useRef<HotelResult>(hotel);

  const handleSelect = useCallback(() => {
    onSelect?.(selectedRoomOfferId ? pendingHotelRef.current : hotel);
  }, [hotel, onSelect, selectedRoomOfferId]);

  // Effective amenities: prefer detail API (real), fallback to search result
  const amenities = (detail?.amenities?.length ? detail.amenities : hotel.amenities) ?? [];

  // Detail images: prefer API images (sorted defaultImage first), fallback to hotel.images
  const detailImages = detail?.images?.length
    ? detail.images.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
    : [];

  const allRoomTypes = hotel.allRoomTypes ?? [];

  // Board label for the default rate
  const boardDisplay = hotel.boardName
    ?? (hotel.boardType ? BOARD_LABELS[hotel.boardType] ?? hotel.boardType : null);

  // ── Compact variant ────────────────────────────────────────────────────────
  if (compact) {
    return (
      <div className={cn(
        'travel-card p-3 flex items-center gap-3',
        selected && 'ring-2 ring-teal-500 dark:ring-teal-400'
      )}>
        <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-muted flex-shrink-0">
          {galleryImages[0] && (
            <Image src={galleryImages[0]} alt={hotel.name} fill className="object-cover" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{hotel.name}</p>
          <p className="text-xs text-muted-foreground">{hotel.stars}★ · {hotel.location}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-bold">{formatPrice(hotel.pricePerNight, hotel.currency)}</p>
          <p className="text-[10px] text-muted-foreground">/night</p>
        </div>
      </div>
    );
  }

  // ── Plain description text (strip HTML tags) ───────────────────────────────
  const plainDesc = detail?.description
    ? detail.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : null;

  return (
    <div className={cn(
      'travel-card overflow-hidden transition-all duration-200',
      selected && 'ring-2 ring-teal-500 dark:ring-teal-400 shadow-lg shadow-teal-500/10'
    )}>
      {/* ── Hero image ──────────────────────────────────────────────────── */}
      {galleryImages.length > 0 ? (
        <HeroGallery
          images={galleryImages}
          primaryImage={hotel.image}
          hotelName={hotel.name}
          stars={hotel.stars}
          score={hotel.rating}
        />
      ) : (
        <div className="h-28 bg-gradient-to-br from-teal-500/20 to-indigo-500/20
                        flex items-end px-4 pb-3 rounded-t-[13px]">
          <div>
            <h3 className="font-black text-base text-foreground">{hotel.name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <Stars count={hotel.stars} />
              <ScoreBadge score={hotel.rating} />
            </div>
          </div>
        </div>
      )}

      {/* ── Info panel ──────────────────────────────────────────────────── */}
      <div className="p-3.5 space-y-3">
        {/* Location + dates */}
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span className="truncate">{hotel.location}</span>
          {hotel.distanceCenter && (
            <span className="flex-shrink-0 text-muted-foreground/60">· {hotel.distanceCenter}</span>
          )}
        </div>

        {hotel.checkIn && hotel.checkOut && (
          <div className="text-[11px] text-muted-foreground/80 bg-muted/40 rounded-lg px-3 py-1.5">
            📅 {formatDate(hotel.checkIn)} → {formatDate(hotel.checkOut)}
            {nights ? ` · ${nights} night${nights !== 1 ? 's' : ''}` : ''}
          </div>
        )}

        {/* Board type badge */}
        {boardDisplay && (
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full
                             bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
              <Utensils className="w-2.5 h-2.5" /> {boardDisplay}
            </span>
          </div>
        )}

        {/* Amenities (first 5) */}
        {amenities.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {amenities.slice(0, 5).map(a => {
              const Icon = AMENITY_ICONS[a];
              return (
                <span key={a} className="inline-flex items-center gap-1 text-[10px] font-medium
                                         px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
                  {Icon && <Icon className="w-2.5 h-2.5" />}
                  {a}
                </span>
              );
            })}
            {amenities.length > 5 && (
              <span className="text-[10px] text-muted-foreground/60 self-center">
                +{amenities.length - 5} more
              </span>
            )}
          </div>
        )}

        {/* ── Details & Rooms toggle ─────────────────────────────────────── */}
        <button
          onClick={handleToggleExpand}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl
                     bg-muted/50 hover:bg-muted/80 text-xs font-medium text-muted-foreground
                     transition-colors"
        >
          <span className="flex items-center gap-1.5">
            {detailLoading && <Loader2 className="w-3 h-3 animate-spin" />}
            {expanded ? 'Hide details' : `View details${allRoomTypes.length > 0 ? ` & ${allRoomTypes.length} room${allRoomTypes.length !== 1 ? 's' : ''}` : ''}`}
          </span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {/* ── Expanded detail panel ──────────────────────────────────────── */}
        {expanded && (
          <div className="space-y-3 pt-1 border-t border-border/40">
            {/* Detail image strip */}
            {detailImages.length > 0 && (
              <DetailImageStrip images={detailImages} />
            )}

            {/* Description */}
            {plainDesc && (
              <div>
                <p className={cn(
                  'text-[11px] text-muted-foreground leading-relaxed',
                  !showFullDesc && 'line-clamp-3'
                )}>
                  {plainDesc}
                </p>
                {plainDesc.length > 200 && (
                  <button
                    onClick={e => { e.stopPropagation(); setShowFullDesc(s => !s); }}
                    className="text-[10px] text-teal-600 dark:text-teal-400 font-medium mt-0.5 hover:underline"
                  >
                    {showFullDesc ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            )}

            {/* Check-in/out times */}
            {(detail?.checkinTime || detail?.checkoutTime) && (
              <div className="flex gap-3">
                {detail.checkinTime && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>Check-in: <span className="font-medium text-foreground">{detail.checkinTime}</span></span>
                  </div>
                )}
                {detail.checkoutTime && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>Check-out: <span className="font-medium text-foreground">{detail.checkoutTime}</span></span>
                  </div>
                )}
              </div>
            )}

            {/* Full amenities list (from detail API) */}
            {detail?.amenities && detail.amenities.length > 5 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1.5">Facilities</p>
                <div className="flex flex-wrap gap-1">
                  {detail.amenities.map(a => {
                    const Icon = AMENITY_ICONS[a];
                    return (
                      <span key={a} className="inline-flex items-center gap-1 text-[10px] font-medium
                                               px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
                        {Icon && <Icon className="w-2.5 h-2.5" />}
                        {a}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Room type selector */}
            {allRoomTypes.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide mb-1.5">
                  Available Rooms
                </p>
                <div className="space-y-1.5">
                  {allRoomTypes.map((room, i) => (
                    <RoomCard
                      key={room.offerId ?? i}
                      room={room}
                      isSelected={selectedRoomOfferId === room.offerId}
                      nights={nights}
                      currency={hotel.currency}
                      onSelect={() => handleRoomSelect(room)}
                    />
                  ))}
                </div>
                {selectedRoomOfferId && (
                  <p className="text-[10px] text-teal-600 dark:text-teal-400 mt-2 font-medium flex items-center gap-1">
                    <RefreshCw className="w-2.5 h-2.5" />
                    Room selected — click &ldquo;Select&rdquo; to book at the updated price
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Price row + CTA ────────────────────────────────────────────── */}
        <div className="flex items-end justify-between pt-1 border-t border-border/50">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-foreground tracking-tight leading-none">
                {formatPrice(hotel.pricePerNight, hotel.currency)}
              </span>
              <span className="text-xs text-muted-foreground">/night</span>
            </div>
            {nights && (
              <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                {formatPrice(hotel.totalPrice, hotel.currency)} total
              </p>
            )}
            {hotel.cancellation && (
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 font-medium">
                ✓ {hotel.cancellation}
              </p>
            )}
          </div>

          <button
            onClick={handleSelect}
            className={cn(
              'px-4 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-150 flex items-center gap-1.5',
              selected
                ? 'bg-teal-600 dark:bg-teal-500 text-white shadow-lg shadow-teal-500/25'
                : 'bg-teal-600 hover:bg-teal-700 text-white shadow-md shadow-teal-500/20 hover:shadow-lg hover:shadow-teal-500/30 active:scale-95'
            )}
          >
            {selected ? <><Check className="w-3.5 h-3.5" /> Selected</> : 'Select'}
          </button>
        </div>

        {/* Indicative pricing notice */}
        {hotel.isSample && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20
                        px-2.5 py-1 rounded-lg">
            ⚠ Indicative price — rates confirmed at booking
          </p>
        )}
      </div>
    </div>
  );
}
