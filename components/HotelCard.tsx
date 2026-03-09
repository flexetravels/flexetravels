'use client';

import Image from 'next/image';
import { Star, MapPin, Wifi, Car, UtensilsCrossed, Waves, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState, useCallback } from 'react';
import { cn, formatPrice, formatDate } from '@/lib/utils';
import type { HotelResult } from '@/lib/types';

interface HotelCardProps {
  hotel: HotelResult;
  onSelect?: (hotel: HotelResult) => void;
  selected?: boolean;
  compact?: boolean;
}

// Map common amenity names to icons
const AMENITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  WiFi:       Wifi,
  Parking:    Car,
  Restaurant: UtensilsCrossed,
  Pool:       Waves,
};

function AmenityBadge({ name }: { name: string }) {
  const Icon = AMENITY_ICONS[name];
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
      {Icon && <Icon className="w-3 h-3" />}
      {name}
    </span>
  );
}

function StarRating({ stars }: { stars: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(
            'w-3 h-3',
            i < stars ? 'fill-amber-400 text-amber-400' : 'fill-none text-muted-foreground/40'
          )}
        />
      ))}
    </span>
  );
}

// ── Image gallery with navigation ─────────────────────────────────────────────
function HotelImageGallery({
  images,
  primaryImage,
  hotelName,
  rating,
  scoreColor,
}: {
  images: string[];
  primaryImage?: string;
  hotelName: string;
  rating: number;
  scoreColor: string;
}) {
  // Build deduplicated image list, primary first
  const allImages = primaryImage
    ? [primaryImage, ...images.filter(u => u !== primaryImage)]
    : images;
  const uniqueImages = Array.from(new Set(allImages)).filter(Boolean);

  const [idx, setIdx] = useState(0);
  const total = uniqueImages.length;

  const prev = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIdx(i => (i - 1 + total) % total);
  }, [total]);

  const next = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIdx(i => (i + 1) % total);
  }, [total]);

  const currentSrc = uniqueImages[idx] ?? '';

  return (
    <div className="relative h-44 w-full overflow-hidden bg-muted group">
      {currentSrc && (
        <Image
          key={currentSrc}
          src={currentSrc}
          alt={`${hotelName} — photo ${idx + 1}`}
          fill
          className="object-cover transition-all duration-500"
          sizes="(max-width: 600px) 100vw, 420px"
          onError={(e) => {
            // Hide broken images silently
            (e.target as HTMLImageElement).style.opacity = '0';
          }}
        />
      )}

      {/* Rating badge */}
      <div className={cn(
        'absolute top-2 right-2 flex flex-col items-center justify-center w-10 h-10 rounded-lg text-white font-bold text-sm shadow-lg z-10',
        scoreColor
      )}>
        {rating.toFixed(1)}
      </div>

      {/* Navigation arrows — only shown when multiple images */}
      {total > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
            aria-label="Previous photo"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={next}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
            aria-label="Next photo"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Dot indicators */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex gap-1">
            {uniqueImages.slice(0, 6).map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setIdx(i); }}
                className={cn(
                  'w-1.5 h-1.5 rounded-full transition-all',
                  i === idx ? 'bg-white scale-125' : 'bg-white/50 hover:bg-white/75'
                )}
                aria-label={`Photo ${i + 1}`}
              />
            ))}
          </div>

          {/* Counter */}
          <div className="absolute bottom-2 right-2 z-10 text-[10px] text-white bg-black/40 rounded px-1.5 py-0.5">
            {idx + 1}/{total}
          </div>
        </>
      )}

      {/* Gradient overlay at bottom for readability */}
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
    </div>
  );
}

// ─── Main HotelCard component ─────────────────────────────────────────────────
export function HotelCard({ hotel, onSelect, selected, compact }: HotelCardProps) {
  const nights =
    hotel.checkIn && hotel.checkOut
      ? Math.round(
          (new Date(hotel.checkOut).getTime() - new Date(hotel.checkIn).getTime()) /
          86_400_000
        )
      : null;

  const scoreColor =
    hotel.rating >= 9   ? 'bg-emerald-500'
    : hotel.rating >= 8 ? 'bg-teal-600 dark:bg-teal-500'
    : hotel.rating >= 7 ? 'bg-amber-500'
    : 'bg-orange-500';

  // Build image list: prefer hotel.images[], fall back to single hotel.image
  const galleryImages = hotel.images && hotel.images.length > 0
    ? hotel.images
    : hotel.image ? [hotel.image] : [];

  return (
    <div
      className={cn(
        'travel-card overflow-hidden',
        selected && 'ring-2 ring-teal-600 dark:ring-teal-400',
        compact ? 'text-xs' : 'text-sm'
      )}
    >
      {/* Image gallery */}
      {!compact && galleryImages.length > 0 && (
        <HotelImageGallery
          images={galleryImages}
          primaryImage={hotel.image}
          hotelName={hotel.name}
          rating={hotel.rating}
          scoreColor={scoreColor}
        />
      )}

      {/* Body */}
      <div className="p-3 flex gap-3">
        {/* Left */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground truncate">{hotel.name}</h3>
              <div className="flex items-center gap-1 mt-0.5">
                <StarRating stars={hotel.stars} />
                {compact && (
                  <span className={cn(
                    'ml-1 text-xs font-bold px-1.5 py-0.5 rounded text-white',
                    scoreColor
                  )}>
                    {hotel.rating.toFixed(1)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
            <MapPin className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{hotel.location}</span>
            {hotel.distanceCenter && (
              <span className="flex-shrink-0">· {hotel.distanceCenter} from center</span>
            )}
          </div>

          {hotel.checkIn && hotel.checkOut && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {formatDate(hotel.checkIn)} – {formatDate(hotel.checkOut)}
              {nights && <span> · {nights} night{nights !== 1 ? 's' : ''}</span>}
            </div>
          )}

          {/* Amenities */}
          {!compact && hotel.amenities && hotel.amenities.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {hotel.amenities.slice(0, 4).map((a) => (
                <AmenityBadge key={a} name={a} />
              ))}
              {hotel.amenities.length > 4 && (
                <span className="text-xs text-muted-foreground self-center">
                  +{hotel.amenities.length - 4} more
                </span>
              )}
            </div>
          )}
        </div>

        {/* Price + CTA */}
        <div className="flex-shrink-0 text-right flex flex-col items-end justify-between">
          <div>
            <div className="text-lg font-bold text-foreground">
              {formatPrice(hotel.pricePerNight, hotel.currency)}
            </div>
            <div className="text-xs text-muted-foreground">/night</div>
            {nights && (
              <div className="text-xs font-medium text-foreground mt-0.5">
                {formatPrice(hotel.totalPrice, hotel.currency)} total
              </div>
            )}
          </div>

          {!compact && (
            <div className="flex flex-col items-end gap-1 mt-2">
              {hotel.cancellation && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                  {hotel.cancellation}
                </span>
              )}
              <button
                onClick={() => onSelect?.(hotel)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150',
                  selected
                    ? 'bg-teal-600 text-white dark:bg-teal-500'
                    : 'bg-teal-50 text-teal-700 hover:bg-teal-100 dark:bg-teal-900/30 dark:text-teal-300 dark:hover:bg-teal-900/50'
                )}
              >
                {selected ? '✓ Selected' : 'Select'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Indicative pricing notice + source badge */}
      {(hotel.isSample || hotel.provider) && (
        <div className="px-3 pb-2 flex items-center justify-between gap-2">
          {hotel.isSample && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">
              ⚠ Indicative price — confirmed at booking
            </span>
          )}
          {hotel.provider && !hotel.isSample && (
            <span className="text-[10px] text-muted-foreground capitalize ml-auto">
              via {hotel.provider}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
