'use client';

/**
 * HotelCard — Compact magazine-cover card.
 * Hero image fills the top, name + stars as bold overlay.
 * "View details" opens the full-screen HotelDetailModal (no inline expansion).
 * "Select" picks this hotel for booking.
 */

import Image from 'next/image';
import {
  MapPin, Wifi, Car, UtensilsCrossed, Waves,
  ChevronLeft, ChevronRight, Check, BedDouble, Eye, ChevronDown, ChevronUp,
  Users, ShieldCheck, ShieldOff, Loader2,
} from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';
import { cn, formatPrice, formatDate, formatMoneyDual } from '@/lib/utils';
import { useCurrency } from '@/components/CurrencyContext';
import type { HotelResult } from '@/lib/types';

interface HotelCardProps {
  hotel: HotelResult;
  onSelect?: (hotel: HotelResult) => void;
  onOpenDetail?: (hotel: HotelResult) => void;
  selected?: boolean;
  compact?: boolean;
  isBestDeal?: boolean;
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

// ── Room type helpers ─────────────────────────────────────────────────────────
type RoomTypeRate = NonNullable<NonNullable<HotelResult['allRoomTypes']>[number]['rates']>[number];
type RoomType = NonNullable<HotelResult['allRoomTypes']>[number];

/** Pick the cheapest rate for a room type */
function cheapestRate(room: RoomType): RoomTypeRate | undefined {
  return (room.rates ?? []).reduce<RoomTypeRate | undefined>((best, r) => {
    if (!best) return r;
    return (r.price ?? Infinity) < (best.price ?? Infinity) ? r : best;
  }, undefined);
}

/** Derive a booking token from a room type — mirrors liteapi.ts bookingToken logic */
function roomBookingToken(room: RoomType): string {
  const rate = cheapestRate(room);
  const raw = room.offerId ?? rate?.rateId ?? '';
  return raw ? `liteapi_${raw}` : '';
}

// ── Inline hotel detail type + module-level cache ────────────────────────────
interface InlineHotelDetail {
  images: Array<{ url: string; caption?: string }>;
  amenities: string[];
  description?: string;
  starRating?: number;
}
const hotelDetailCache = new Map<string, InlineHotelDetail>();

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// ── Star row ──────────────────────────────────────────────────────────────────
function Stars({ count }: { count: number }) {
  if (count <= 0) return null; // unrated — don't show empty stars
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
  if (score <= 0) return null; // unrated — don't show fabricated score
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

// ── Room type selector component ──────────────────────────────────────────────
function RoomSelector({
  rooms,
  selectedOfferId,
  onSelectRoom,
  nights,
  currency,
}: {
  rooms: NonNullable<HotelResult['allRoomTypes']>;
  selectedOfferId: string;
  onSelectRoom: (room: RoomType) => void;
  nights: number;
  currency: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = rooms.slice(0, 6); // cap at 6 room types

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-3 py-2.5
                   bg-muted/30 hover:bg-muted/50 text-xs font-semibold
                   text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <BedDouble className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
          Room options
          <span className="font-normal text-muted-foreground">({visible.length} available)</span>
        </span>
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="divide-y divide-border/40">
          {visible.map((room, i) => {
            const rate     = cheapestRate(room);
            const token    = roomBookingToken(room);
            const isActive = token === selectedOfferId || (!selectedOfferId && i === 0);
            const ppn      = rate?.price != null && nights > 0
              ? Math.round(rate.price / nights * 100) / 100
              : undefined;
            const board = rate?.boardName ?? (rate?.boardType ? BOARD_LABELS[rate.boardType] ?? rate.boardType : null);
            const refundable = rate?.refundable;

            return (
              <button
                key={room.offerId ?? i}
                type="button"
                onClick={() => onSelectRoom(room)}
                className={cn(
                  'w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors text-xs',
                  isActive
                    ? 'bg-teal-50 dark:bg-teal-900/20'
                    : 'bg-background hover:bg-muted/40'
                )}
              >
                {/* Selection indicator */}
                <div className={cn(
                  'mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                  isActive ? 'border-teal-500 bg-teal-500' : 'border-border'
                )}>
                  {isActive && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>

                {/* Room info */}
                <div className="flex-1 min-w-0">
                  <p className={cn('font-semibold leading-tight', isActive ? 'text-teal-700 dark:text-teal-300' : 'text-foreground')}>
                    {room.name ?? `Room Type ${i + 1}`}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {room.maxOccupancy && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full
                                       bg-muted text-muted-foreground text-[10px] font-medium">
                        <Users className="w-2.5 h-2.5" />
                        {room.maxOccupancy} max
                      </span>
                    )}
                    {board && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full
                                       bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400
                                       text-[10px] font-medium">
                        <UtensilsCrossed className="w-2.5 h-2.5" />
                        {board}
                      </span>
                    )}
                    {refundable != null && (
                      refundable ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full
                                         bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400
                                         text-[10px] font-medium">
                          <ShieldCheck className="w-2.5 h-2.5" />
                          Refundable
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full
                                         bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400
                                         text-[10px] font-medium">
                          <ShieldOff className="w-2.5 h-2.5" />
                          Non-refundable
                        </span>
                      )
                    )}
                  </div>
                </div>

                {/* Price */}
                {ppn != null && (
                  <div className="text-right flex-shrink-0">
                    <p className={cn('font-black text-sm', isActive ? 'text-teal-700 dark:text-teal-300' : 'text-foreground')}>
                      {formatPrice(ppn, rate?.currency ?? currency)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">/night</p>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function HotelCard({ hotel, onSelect, onOpenDetail, selected, compact, isBestDeal }: HotelCardProps) {
  const nights =
    hotel.checkIn && hotel.checkOut
      ? Math.round(
          (new Date(hotel.checkOut).getTime() - new Date(hotel.checkIn).getTime()) / 86_400_000
        )
      : 1;

  const galleryImages = hotel.images?.length ? hotel.images : hotel.image ? [hotel.image] : [];

  // Track the currently-selected room type (defaults to hotel.bookingToken = cheapest room)
  const [selectedToken, setSelectedToken] = useState<string>(hotel.bookingToken ?? '');

  // Build the hotel object for the Select callback, swapping in the chosen room's token
  const effectiveHotel = useMemo<HotelResult>(() => {
    if (!selectedToken || selectedToken === hotel.bookingToken) return hotel;
    // Find the room matching the selected token and update price fields
    const room = (hotel.allRoomTypes ?? []).find(r => roomBookingToken(r) === selectedToken);
    if (!room) return { ...hotel, bookingToken: selectedToken };
    const rate = cheapestRate(room);
    const total = rate?.price;
    const ppn = total != null && nights > 0 ? Math.round(total / nights * 100) / 100 : hotel.pricePerNight;
    const boardType = rate?.boardType ?? hotel.boardType;
    const boardName = rate?.boardName ?? hotel.boardName;
    const refundable = rate?.refundable;
    return {
      ...hotel,
      bookingToken: selectedToken,
      pricePerNight: ppn,
      totalPrice: total ?? hotel.totalPrice,
      boardType,
      boardName,
      cancellation: refundable === true ? 'Free cancellation' : refundable === false ? undefined : hotel.cancellation,
    };
  }, [hotel, selectedToken, nights]);

  const handleSelect = useCallback(() => {
    onSelect?.(effectiveHotel);
  }, [effectiveHotel, onSelect]);

  const handleSelectRoom = useCallback((room: RoomType) => {
    const token = roomBookingToken(room);
    if (token) setSelectedToken(token);
  }, []);

  // ── Inline detail expansion state ─────────────────────────────────────────
  const [expanded,      setExpanded]      = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [inlineDetail,  setInlineDetail]  = useState<InlineHotelDetail | null>(null);

  const handleToggleDetail = useCallback(async () => {
    if (hotel.isSample) return;

    if (expanded) {
      setExpanded(false);
      return;
    }

    // Serve from cache if available
    const cached = hotelDetailCache.get(hotel.id);
    if (cached) {
      setInlineDetail(cached);
      setExpanded(true);
      return;
    }

    // Fetch from API
    setExpanded(true);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/hotel-detail?hotelId=${encodeURIComponent(hotel.id)}`);
      if (res.ok) {
        const data = await res.json() as {
          images?: Array<{ url: string; caption?: string }>;
          amenities?: string[];
          description?: string;
          starRating?: number;
        };
        const detail: InlineHotelDetail = {
          images:      data.images      ?? [],
          amenities:   data.amenities   ?? [],
          description: data.description,
          starRating:  data.starRating,
        };
        hotelDetailCache.set(hotel.id, detail);
        setInlineDetail(detail);
      }
    } catch {
      // silently degrade — card already shows basics
    } finally {
      setLoadingDetail(false);
    }
  }, [hotel.id, hotel.isSample, expanded]);

  const amenities = hotel.amenities ?? [];
  const hasRoomOptions = (hotel.allRoomTypes?.length ?? 0) > 1;

  // Use real star rating from detail endpoint when available (more accurate than list endpoint)
  const displayStars = inlineDetail?.starRating ?? hotel.stars;

  // Board label for the effective (selected-room) rate
  const boardDisplay = effectiveHotel.boardName
    ?? (effectiveHotel.boardType ? BOARD_LABELS[effectiveHotel.boardType] ?? effectiveHotel.boardType : null);

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
          <p className="text-xs text-muted-foreground">{displayStars > 0 ? `${displayStars}★ · ` : ''}{hotel.location}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-bold">{formatPrice(hotel.pricePerNight, hotel.currency)}</p>
          <p className="text-[10px] text-muted-foreground">/night</p>
        </div>
      </div>
    );
  }

  const ariaLabel = `${hotel.name}, ${displayStars} stars, ${formatPrice(effectiveHotel.pricePerNight, effectiveHotel.currency)} per night in ${hotel.location}`;

  // Home-currency conversion lines for per-night + total price.
  const { homeCurrency, rates } = useCurrency();
  const { secondary: ppnConverted }   = formatMoneyDual(effectiveHotel.pricePerNight, effectiveHotel.currency, homeCurrency, rates);
  const { secondary: totalConverted } = formatMoneyDual(effectiveHotel.totalPrice,    effectiveHotel.currency, homeCurrency, rates);

  return (
    <div
      role="article"
      aria-label={ariaLabel}
      className={cn(
        'travel-card overflow-hidden transition-all duration-200',
        selected && 'ring-2 ring-teal-500 dark:ring-teal-400 shadow-lg shadow-teal-500/10'
      )}>
      {/* ── Hero image ──────────────────────────────────────────────────── */}
      {galleryImages.length > 0 ? (
        <HeroGallery
          images={galleryImages}
          primaryImage={hotel.image}
          hotelName={hotel.name}
          stars={displayStars}
          score={hotel.rating}
        />
      ) : (
        <div className="h-28 bg-gradient-to-br from-teal-500/20 to-indigo-500/20
                        flex items-end px-4 pb-3 rounded-t-[13px] relative">
          {isBestDeal && (
            <span className="absolute top-2.5 right-2.5 text-[10px] font-bold text-amber-700 dark:text-amber-300
                             bg-amber-50 dark:bg-amber-900/25 border border-amber-200 dark:border-amber-700
                             px-2 py-0.5 rounded-full">
              Best deal
            </span>
          )}
          <div>
            <h3 className="font-black text-base text-foreground">{hotel.name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <Stars count={displayStars} />
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
          <div className="text-[11px] text-muted-foreground/80 bg-muted/40 rounded-lg px-3 py-1.5 flex items-center justify-between gap-2 flex-wrap">
            <span>
              📅 {formatDate(hotel.checkIn)} → {formatDate(hotel.checkOut)}
              {nights ? ` · ${nights} night${nights !== 1 ? 's' : ''}` : ''}
            </span>
            {hotel.roomCount && hotel.roomCount > 1 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold
                               px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30
                               text-indigo-700 dark:text-indigo-300 flex-shrink-0">
                <BedDouble className="w-2.5 h-2.5" />
                {hotel.roomCount} rooms
              </span>
            )}
          </div>
        )}

        {/* Board type badge — only shown when no room selector (avoids duplication) */}
        {boardDisplay && !hasRoomOptions && (
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full
                             bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
              <UtensilsCrossed className="w-2.5 h-2.5" /> {boardDisplay}
            </span>
          </div>
        )}

        {/* ── Room type selector ──────────────────────────────────────────── */}
        {!hotel.isSample && hasRoomOptions && hotel.allRoomTypes && (
          <RoomSelector
            rooms={hotel.allRoomTypes}
            selectedOfferId={selectedToken}
            onSelectRoom={handleSelectRoom}
            nights={nights}
            currency={hotel.currency}
          />
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

        {/* ── Photos & amenities inline toggle ────────────────────────────── */}
        {!hotel.isSample && (
          <>
            <button
              onClick={handleToggleDetail}
              aria-expanded={expanded}
              aria-label={expanded
                ? `Hide photos and amenities for ${hotel.name}`
                : `View photos and amenities for ${hotel.name}`}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl
                         bg-muted/50 hover:bg-muted/80 text-xs font-medium text-muted-foreground
                         transition-colors"
            >
              {loadingDetail
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-200', expanded && 'rotate-180')} />
              }
              {expanded ? 'Hide photos' : 'View photos & amenities'}
            </button>

            {/* Expanded inline detail panel */}
            {expanded && (
              <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden">
                {loadingDetail ? (
                  <div className="flex items-center justify-center gap-2 py-6">
                    <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
                    <span className="text-xs text-muted-foreground">Loading photos…</span>
                  </div>
                ) : inlineDetail ? (
                  <div className="p-3 space-y-3">
                    {/* Photo grid */}
                    {inlineDetail.images.length > 0 && (
                      <div className="grid grid-cols-3 gap-1">
                        {inlineDetail.images.slice(0, 6).map((img, i) => (
                          <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                            <img
                              src={img.url}
                              alt={img.caption ?? `Photo ${i + 1}`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={e => { (e.target as HTMLImageElement).style.opacity = '0'; }}
                            />
                            {i === 5 && inlineDetail.images.length > 6 && (
                              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                <span className="text-white text-xs font-bold">+{inlineDetail.images.length - 6}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Extended amenities from detail API */}
                    {inlineDetail.amenities.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {inlineDetail.amenities.slice(0, 12).map(a => {
                          const Icon = AMENITY_ICONS[a];
                          return (
                            <span key={a} className="inline-flex items-center gap-1 text-[10px] font-medium
                                                     px-2 py-0.5 rounded-full bg-muted/80 text-muted-foreground">
                              {Icon && <Icon className="w-2.5 h-2.5" />}
                              {a}
                            </span>
                          );
                        })}
                        {inlineDetail.amenities.length > 12 && (
                          <span className="text-[10px] text-muted-foreground/60 self-center">
                            +{inlineDetail.amenities.length - 12} more
                          </span>
                        )}
                      </div>
                    )}

                    {/* Short description */}
                    {inlineDetail.description && (
                      <p className="text-[11px] text-muted-foreground line-clamp-3 leading-relaxed">
                        {stripHtml(inlineDetail.description)}
                      </p>
                    )}

                    {/* Open full modal */}
                    {onOpenDetail && (
                      <button
                        onClick={() => onOpenDetail(hotel)}
                        className="flex items-center gap-1 text-xs text-teal-500 hover:text-teal-400 font-medium transition-colors"
                      >
                        <Eye className="w-3 h-3" />
                        Open full details & rooms
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-6">
                    <span className="text-xs text-muted-foreground">No additional details available.</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Price row + CTA ────────────────────────────────────────────── */}
        <div className="flex items-end justify-between pt-1 border-t border-border/50">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-foreground tracking-tight leading-none">
                {formatPrice(effectiveHotel.pricePerNight, effectiveHotel.currency)}
              </span>
              <span className="text-xs text-muted-foreground">/night</span>
            </div>
            {ppnConverted && (
              <p className="text-[11px] font-bold text-teal-700 dark:text-teal-300 mt-0.5 leading-none"
                 title={`Approximate conversion at today's rate. Charge is in ${effectiveHotel.currency}.`}>
                {ppnConverted}/night
              </p>
            )}
            {hotel.roomCount && hotel.roomCount > 1 && (
              <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium mt-0.5">
                {hotel.roomCount} rooms · {formatPrice(Math.round(effectiveHotel.pricePerNight / hotel.roomCount * 100) / 100, effectiveHotel.currency)}/room
              </p>
            )}
            {nights && (
              <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                {formatPrice(effectiveHotel.totalPrice, effectiveHotel.currency)} total
                {totalConverted && (
                  <span className="font-bold text-teal-700 dark:text-teal-300"> · {totalConverted}</span>
                )}
              </p>
            )}
            {effectiveHotel.cancellation ? (
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 font-medium">
                ✓ {effectiveHotel.cancellation}
              </p>
            ) : (
              <p className="text-[10px] text-rose-500 dark:text-rose-400 mt-0.5 font-medium">
                Non-refundable
              </p>
            )}
          </div>

          {hotel.isSample ? (
            <span className="px-4 py-2.5 rounded-xl text-[13px] font-bold
                             bg-muted text-muted-foreground cursor-not-allowed opacity-60">
              Not bookable
            </span>
          ) : (
            <button
              onClick={handleSelect}
              aria-label={`Select ${hotel.name} in ${hotel.location} for ${formatPrice(effectiveHotel.pricePerNight, effectiveHotel.currency)} per night`}
              className={cn(
                'px-4 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-150 flex items-center gap-1.5',
                selected
                  ? 'bg-teal-600 dark:bg-teal-500 text-white shadow-lg shadow-teal-500/25'
                  : 'bg-teal-600 hover:bg-teal-700 text-white shadow-md shadow-teal-500/20 hover:shadow-lg hover:shadow-teal-500/30 active:scale-95'
              )}
            >
              {selected ? <><Check className="w-3.5 h-3.5" /> Selected</> : 'Select'}
            </button>
          )}
        </div>

        {/* Indicative pricing notice */}
        {hotel.isSample && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20
                        border border-amber-200 dark:border-amber-800/50
                        px-3 py-2 rounded-lg leading-snug">
            ⚠ <strong>Estimated pricing only.</strong> Live hotel rates aren&apos;t available for this destination yet — search again or try a different city to see bookable options.
          </p>
        )}
      </div>
    </div>
  );
}
