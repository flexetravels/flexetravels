'use client';

/**
 * HotelDetailModal — Full-screen hotel detail view rivaling Booking.com.
 * Opens as a slide-up sheet/modal when user clicks "Full details" on a hotel card.
 *
 * Sections:
 *   A. Photo gallery with lightbox
 *   B. Hotel overview (name, stars, score, address, check-in/out times)
 *   C. Key highlights extracted from description
 *   D. Amenities grid with icons
 *   E. Description with read-more
 *   F. Room comparison
 *   G. Cancellation policy timeline
 *   H. Location (OpenStreetMap embed)
 */

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  X, Star, MapPin, Clock, ChevronLeft, ChevronRight, Maximize2,
  Wifi, Car, UtensilsCrossed, Waves, Dumbbell, Wind, Coffee, Tv,
  Luggage, Baby, PawPrint, ShoppingBag, Zap, Phone, Globe,
  CheckCircle, XCircle, AlertCircle, Users, BedDouble, Utensils,
  RefreshCw, Loader2, ExternalLink,
} from 'lucide-react';
import { cn, formatPrice, formatDate } from '@/lib/utils';
import type { HotelResult } from '@/lib/types';

// ── Types ─────────────────────────────────────────────────────────────────────
interface HotelDetailData {
  id:           string;
  name:         string;
  starRating?:  number;
  description?: string;
  images?:      Array<{ url: string; caption?: string; isDefault?: boolean }>;
  amenities?:   string[];
  checkinTime?:  string;
  checkoutTime?: string;
  address?:     string;
  city?:        string;
  countryCode?: string;
  coordinates?: { lat: number; lon: number };
  contact?:     { phone?: string; email?: string; website?: string };
}

interface HotelDetailModalProps {
  hotel: HotelResult | null;
  onClose: () => void;
  onSelect?: (hotel: HotelResult) => void;
}

// ── Amenity icon map (extended) ───────────────────────────────────────────────
const AMENITY_ICON_MAP: Array<{ keywords: string[]; icon: React.ComponentType<{ className?: string }>; label: string }> = [
  { keywords: ['wifi', 'internet', 'wireless'],        icon: Wifi,              label: 'Free WiFi' },
  { keywords: ['parking', 'garage', 'valet'],          icon: Car,               label: 'Parking' },
  { keywords: ['restaurant', 'dining', 'cuisine'],     icon: UtensilsCrossed,   label: 'Restaurant' },
  { keywords: ['pool', 'swimming', 'aqua'],            icon: Waves,             label: 'Pool' },
  { keywords: ['gym', 'fitness', 'sport'],             icon: Dumbbell,          label: 'Gym' },
  { keywords: ['air condition', 'ac ', 'a/c', 'hvac'], icon: Wind,              label: 'Air Conditioning' },
  { keywords: ['breakfast', 'coffee', 'cafe'],         icon: Coffee,            label: 'Café / Bar' },
  { keywords: ['tv', 'television', 'cable'],           icon: Tv,                label: 'TV' },
  { keywords: ['luggage', 'baggage', 'storage'],       icon: Luggage,           label: 'Luggage Storage' },
  { keywords: ['kids', 'children', 'family', 'baby'],  icon: Baby,              label: 'Family Friendly' },
  { keywords: ['pet', 'dog', 'cat'],                   icon: PawPrint,          label: 'Pet Friendly' },
  { keywords: ['shop', 'boutique', 'retail'],          icon: ShoppingBag,       label: 'Shopping' },
  { keywords: ['electric', 'charging', 'ev '],         icon: Zap,               label: 'EV Charging' },
  { keywords: ['spa', 'massage', 'sauna', 'wellness'], icon: Users,             label: 'Spa & Wellness' },
  { keywords: ['bar', 'lounge', 'pub'],                icon: Utensils,          label: 'Bar / Lounge' },
];

function getAmenityIcon(amenity: string): { icon: React.ComponentType<{ className?: string }>; label: string } | null {
  const lower = amenity.toLowerCase();
  for (const entry of AMENITY_ICON_MAP) {
    if (entry.keywords.some(k => lower.includes(k))) {
      return { icon: entry.icon, label: entry.label };
    }
  }
  return null;
}

// ── Extract highlights from description HTML ──────────────────────────────────
const HIGHLIGHT_KEYWORDS: Array<{ keywords: string[]; emoji: string; label: string }> = [
  { keywords: ['beachfront', 'beach front', 'on the beach', 'steps from the beach'], emoji: '🏖', label: 'Beachfront' },
  { keywords: ['ocean view', 'sea view', 'ocean-view', 'sea-view'],                  emoji: '🌊', label: 'Ocean View' },
  { keywords: ['pool'],                                                                emoji: '🏊', label: 'Pool' },
  { keywords: ['spa', 'wellness', 'massage'],                                          emoji: '🧖', label: 'Spa' },
  { keywords: ['city center', 'city centre', 'downtown', 'heart of'],                emoji: '🏙', label: 'City Center' },
  { keywords: ['rooftop'],                                                             emoji: '🌆', label: 'Rooftop' },
  { keywords: ['all-inclusive', 'all inclusive'],                                     emoji: '🍽', label: 'All Inclusive' },
  { keywords: ['mountain view', 'mountain-view'],                                     emoji: '🏔', label: 'Mountain View' },
  { keywords: ['romantic', 'honeymoon', 'couples'],                                  emoji: '💑', label: 'Romantic' },
  { keywords: ['family friendly', 'family-friendly', 'kids club', "children's pool"], emoji: '👨‍👩‍👧', label: 'Family Friendly' },
  { keywords: ['free wifi', 'complimentary wifi'],                                    emoji: '📶', label: 'Free WiFi' },
  { keywords: ['airport transfer', 'shuttle'],                                        emoji: '🚌', label: 'Airport Shuttle' },
  { keywords: ['infinity pool'],                                                       emoji: '✨', label: 'Infinity Pool' },
  { keywords: ['private beach'],                                                       emoji: '🏖', label: 'Private Beach' },
];

function extractHighlights(text: string): Array<{ emoji: string; label: string }> {
  if (!text) return [];
  const plain = text.replace(/<[^>]+>/g, ' ').toLowerCase();
  const found: Array<{ emoji: string; label: string }> = [];
  const seen = new Set<string>();
  for (const h of HIGHLIGHT_KEYWORDS) {
    if (h.keywords.some(k => plain.includes(k)) && !seen.has(h.label)) {
      found.push({ emoji: h.emoji, label: h.label });
      seen.add(h.label);
    }
    if (found.length >= 6) break;
  }
  return found;
}

// ── Score label ───────────────────────────────────────────────────────────────
function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 9.0) return { label: 'Exceptional',  color: 'bg-green-600' };
  if (score >= 8.5) return { label: 'Superb',       color: 'bg-green-500' };
  if (score >= 8.0) return { label: 'Excellent',    color: 'bg-teal-600' };
  if (score >= 7.5) return { label: 'Very Good',    color: 'bg-teal-500' };
  if (score >= 7.0) return { label: 'Good',         color: 'bg-blue-500' };
  return              { label: 'Pleasant',          color: 'bg-slate-500' };
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({
  images,
  startIndex,
  onClose,
}: {
  images: Array<{ url: string; caption?: string }>;
  startIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  const prev = () => setIdx(i => (i - 1 + images.length) % images.length);
  const next = () => setIdx(i => (i + 1) % images.length);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
        onClick={onClose}
      >
        <X className="w-5 h-5" />
      </button>
      <button
        className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
        onClick={(e) => { e.stopPropagation(); prev(); }}
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <div className="max-w-5xl max-h-[90vh] mx-16 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
        <div className="relative w-full" style={{ maxHeight: '80vh' }}>
          <img
            src={images[idx].url}
            alt={images[idx].caption ?? `Photo ${idx + 1}`}
            className="object-contain max-h-[75vh] max-w-full mx-auto rounded-lg"
          />
        </div>
        {images[idx].caption && (
          <p className="text-sm text-white/70 text-center">{images[idx].caption}</p>
        )}
        <p className="text-xs text-white/40 text-center">{idx + 1} / {images.length}</p>
      </div>
      <button
        className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
        onClick={(e) => { e.stopPropagation(); next(); }}
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export function HotelDetailModal({ hotel, onClose, onSelect }: HotelDetailModalProps) {
  const [detail,       setDetail]       = useState<HotelDetailData | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [heroIdx,      setHeroIdx]      = useState(0);
  const [lightbox,     setLightbox]     = useState<number | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [showAllAmen,  setShowAllAmen]  = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);

  const fetchDetail = useCallback(async (hotelId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hotel-detail?hotelId=${encodeURIComponent(hotelId)}`);
      if (res.ok) {
        const data = await res.json() as HotelDetailData;
        setDetail(data);
      }
    } catch {
      // silently degrade — card data already provides basics
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hotel) {
      setDetail(null);
      setHeroIdx(0);
      setLightbox(null);
      setDescExpanded(false);
      setShowAllAmen(false);
      setSelectedRoom(null);
      fetchDetail(hotel.id);
    }
  }, [hotel, fetchDetail]);

  // Lock body scroll when open
  useEffect(() => {
    if (hotel) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [hotel]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!hotel) return null;

  // Build images array: detail images if available, otherwise card image
  const allImages: Array<{ url: string; caption?: string }> = [];
  if (detail?.images && detail.images.length > 0) {
    allImages.push(...detail.images.filter(img => img.url));
  } else if (hotel.image) {
    allImages.push({ url: hotel.image });
  }
  const heroImage = allImages[heroIdx]?.url ?? hotel.image ?? '';

  // Amenities
  const amenities = detail?.amenities ?? hotel.amenities ?? [];
  const visibleAmenities = showAllAmen ? amenities : amenities.slice(0, 12);

  // Highlights from description
  const highlights = extractHighlights(detail?.description ?? '');

  // Score
  const score = hotel.rating ?? 0;
  const { label: scoreText, color: scoreBg } = score > 0 ? scoreLabel(score) : { label: '', color: '' };

  // Strip HTML for description
  const descHtml = detail?.description ?? '';
  const descPlain = descHtml.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();

  // Cancel policies
  const cancelPolicies = hotel.cancelPolicies ?? [];
  const isRefundable   = hotel.refundableTag === 'RFN' || hotel.cancellation === 'Free cancellation';

  // Room types for comparison
  const roomTypes = hotel.allRoomTypes ?? [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal sheet — slides up from bottom, centered on desktop */}
      <div
        className={cn(
          'fixed z-[110] bg-background shadow-2xl',
          // Mobile: full screen slide-up sheet
          'inset-x-0 bottom-0 rounded-t-2xl max-h-[95vh]',
          // Desktop: centered modal
          'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2',
          'sm:w-full sm:max-w-3xl sm:rounded-2xl sm:max-h-[92vh]',
          'flex flex-col overflow-hidden',
          'animate-slide-up',
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* ── CLOSE BUTTON ────────────────────────────────────────────────────── */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-card/90 border border-border
                     flex items-center justify-center shadow-md hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* ── SCROLLABLE CONTENT ──────────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 [scrollbar-width:thin]">

          {/* ── A. HERO PHOTO GALLERY ───────────────────────────────────────── */}
          <div className="relative w-full aspect-video bg-muted overflow-hidden group">
            {heroImage ? (
              <img
                src={heroImage}
                alt={hotel.name}
                className="w-full h-full object-cover transition-opacity duration-300"
              />
            ) : (
              <div className="w-full h-full bg-muted flex items-center justify-center">
                <span className="text-muted-foreground text-sm">No photo available</span>
              </div>
            )}

            {/* Expand to lightbox */}
            {allImages.length > 0 && (
              <button
                onClick={() => setLightbox(heroIdx)}
                className="absolute top-3 left-3 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70
                           flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Hero nav arrows */}
            {allImages.length > 1 && (
              <>
                <button
                  onClick={() => setHeroIdx(i => (i - 1 + allImages.length) % allImages.length)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50
                             flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setHeroIdx(i => (i + 1) % allImages.length)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50
                             flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                {/* Dot pagination */}
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                  {allImages.slice(0, 8).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setHeroIdx(i)}
                      className={cn('w-1.5 h-1.5 rounded-full transition-all',
                        i === heroIdx ? 'bg-white scale-125' : 'bg-white/50'
                      )}
                    />
                  ))}
                  {allImages.length > 8 && (
                    <span className="text-white/60 text-[10px] ml-1">+{allImages.length - 8}</span>
                  )}
                </div>
              </>
            )}

            {/* Image count badge */}
            {allImages.length > 1 && (
              <div className="absolute bottom-2 right-3 text-xs text-white/80 bg-black/50 rounded-full px-2 py-0.5">
                {heroIdx + 1}/{allImages.length}
              </div>
            )}

            {/* Loading overlay */}
            {loading && !detail && (
              <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
              </div>
            )}
          </div>

          {/* Thumbnail strip */}
          {allImages.length > 1 && (
            <div className="flex gap-1.5 px-4 py-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden bg-muted/30">
              {allImages.slice(0, 12).map((img, i) => (
                <button
                  key={i}
                  onClick={() => { setHeroIdx(i); }}
                  className={cn(
                    'flex-none w-16 h-12 rounded-md overflow-hidden border-2 transition-all',
                    i === heroIdx ? 'border-teal-500' : 'border-transparent opacity-60 hover:opacity-100'
                  )}
                >
                  <img src={img.url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
              {allImages.length > 12 && (
                <button
                  onClick={() => setLightbox(0)}
                  className="flex-none w-16 h-12 rounded-md bg-muted border-2 border-dashed border-muted-foreground/30
                             flex items-center justify-center text-xs text-muted-foreground hover:border-teal-500 transition-colors"
                >
                  +{allImages.length - 12}
                </button>
              )}
            </div>
          )}

          <div className="px-4 pb-6 space-y-5 pt-3">

            {/* ── B. HOTEL OVERVIEW ─────────────────────────────────────────── */}
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold text-foreground leading-tight">{hotel.name}</h2>
                  {/* Stars */}
                  {hotel.stars > 0 && (
                    <div className="flex items-center gap-0.5 mt-0.5">
                      {Array.from({ length: hotel.stars }).map((_, i) => (
                        <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      ))}
                    </div>
                  )}
                </div>
                {/* Score badge */}
                {score > 0 && (
                  <div className="flex-shrink-0 text-right">
                    <div className={cn('inline-flex items-center justify-center w-10 h-10 rounded-xl text-white font-bold text-sm', scoreBg)}>
                      {score.toFixed(1)}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{scoreText}</p>
                  </div>
                )}
              </div>

              {/* Address */}
              {(detail?.address || hotel.location) && (
                <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-teal-500" />
                  <span className="line-clamp-2">
                    {detail?.address ?? hotel.location}
                    {detail?.city && detail.city !== hotel.location ? `, ${detail.city}` : ''}
                  </span>
                  {/* Map link */}
                  {detail?.coordinates && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${detail.coordinates.lat},${detail.coordinates.lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 text-teal-500 hover:text-teal-400"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}

              {/* Check-in/out + board type */}
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                {(detail?.checkinTime || hotel.checkIn) && (
                  <div className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-teal-500" />
                    <span>Check-in: <strong className="text-foreground">{detail?.checkinTime ?? formatDate(hotel.checkIn)}</strong></span>
                  </div>
                )}
                {(detail?.checkoutTime || hotel.checkOut) && (
                  <div className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>Check-out: <strong className="text-foreground">{detail?.checkoutTime ?? formatDate(hotel.checkOut)}</strong></span>
                  </div>
                )}
                {hotel.boardName && (
                  <span className="px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 text-xs font-medium">
                    {hotel.boardName}
                  </span>
                )}
              </div>
            </div>

            {/* ── C. KEY HIGHLIGHTS ─────────────────────────────────────────── */}
            {highlights.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Highlights</h3>
                <div className="flex flex-wrap gap-2">
                  {highlights.map((h, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 text-xs font-medium
                                             px-3 py-1.5 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400">
                      <span>{h.emoji}</span>
                      <span>{h.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── D. AMENITIES GRID ─────────────────────────────────────────── */}
            {amenities.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Amenities</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {visibleAmenities.map((a, i) => {
                    const mapped = getAmenityIcon(a);
                    const Icon = mapped?.icon;
                    return (
                      <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                        {Icon
                          ? <Icon className="w-4 h-4 flex-shrink-0 text-teal-500" />
                          : <div className="w-4 h-4 flex-shrink-0 rounded-full bg-teal-500/20" />
                        }
                        <span className="truncate">{a}</span>
                      </div>
                    );
                  })}
                </div>
                {amenities.length > 12 && (
                  <button
                    onClick={() => setShowAllAmen(v => !v)}
                    className="mt-2 text-xs text-teal-500 hover:text-teal-400 font-medium"
                  >
                    {showAllAmen ? 'Show less' : `Show all ${amenities.length} amenities`}
                  </button>
                )}
              </div>
            )}

            {/* ── E. DESCRIPTION ────────────────────────────────────────────── */}
            {descPlain && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">About this property</h3>
                <div className={cn(
                  'text-sm text-muted-foreground leading-relaxed transition-all overflow-hidden',
                  !descExpanded && 'line-clamp-4'
                )}>
                  {descPlain}
                </div>
                {descPlain.length > 300 && (
                  <button
                    onClick={() => setDescExpanded(v => !v)}
                    className="mt-1 text-xs text-teal-500 hover:text-teal-400 font-medium"
                  >
                    {descExpanded ? 'Read less' : 'Read more'}
                  </button>
                )}
              </div>
            )}

            {/* ── F. ROOM COMPARISON ────────────────────────────────────────── */}
            {roomTypes.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Available Rooms</h3>
                <div className="space-y-2">
                  {roomTypes.map((rt, i) => {
                    const cheapestRate = rt.rates?.reduce((min: typeof rt.rates[0] | undefined, r) => {
                      if (!min || (r.price ?? Infinity) < (min.price ?? Infinity)) return r;
                      return min;
                    }, undefined);
                    const price = cheapestRate?.price;
                    const refund = cheapestRate?.refundable;
                    const isSelected = selectedRoom === rt.offerId;

                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedRoom(isSelected ? null : (rt.offerId ?? null))}
                        className={cn(
                          'w-full text-left rounded-xl border p-3 transition-all',
                          isSelected
                            ? 'border-teal-500 bg-teal-500/5 shadow-sm'
                            : 'border-border hover:border-teal-500/50 bg-card'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{rt.name}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {rt.maxOccupancy && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <Users className="w-3 h-3" /> Up to {rt.maxOccupancy}
                                </span>
                              )}
                              {cheapestRate?.boardName && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                  {cheapestRate.boardName}
                                </span>
                              )}
                              {refund !== undefined && (
                                <span className={cn('inline-flex items-center gap-1 text-[10px]',
                                  refund ? 'text-green-500' : 'text-red-400')}>
                                  {refund
                                    ? <><CheckCircle className="w-3 h-3" /> Refundable</>
                                    : <><XCircle className="w-3 h-3" /> Non-refundable</>
                                  }
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            {price && (
                              <p className="text-base font-bold text-foreground">
                                {formatPrice(price / Math.max(1, hotel.roomCount ?? 1))}
                              </p>
                            )}
                            <p className="text-[10px] text-muted-foreground">per night</p>
                          </div>
                        </div>
                        {isSelected && (
                          <p className="text-xs text-teal-500 mt-1.5">✓ Room selected — click "Select Hotel" below to book</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── G. CANCELLATION POLICY ────────────────────────────────────── */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">Cancellation Policy</h3>
              <div className={cn(
                'flex items-start gap-2 p-3 rounded-xl text-sm',
                isRefundable ? 'bg-green-500/10' : 'bg-red-500/10'
              )}>
                {isRefundable
                  ? <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  : <XCircle    className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                }
                <div>
                  <p className={cn('font-medium', isRefundable ? 'text-green-600 dark:text-green-400' : 'text-red-500')}>
                    {hotel.cancellation ?? (isRefundable ? 'Free cancellation' : 'Non-refundable')}
                  </p>
                  {cancelPolicies.length > 0 && (
                    <ul className="mt-1 space-y-1">
                      {cancelPolicies.map((p: { cancelTime?: string; amount?: number; currency?: string; type?: string }, i: number) => (
                        <li key={i} className="text-xs text-muted-foreground">
                          {p.cancelTime
                            ? `After ${new Date(p.cancelTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: `
                            : ''}
                          {p.amount && p.currency
                            ? `${formatPrice(p.amount, p.currency)} penalty`
                            : p.type === 'NIGHTS' ? 'Night(s) penalty' : 'Penalty applies'
                          }
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* ── H. LOCATION MAP ───────────────────────────────────────────── */}
            {detail?.coordinates && (
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Location</h3>
                <div className="rounded-xl overflow-hidden border border-border" style={{ height: 200 }}>
                  <iframe
                    width="100%"
                    height="200"
                    style={{ border: 0 }}
                    loading="lazy"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${detail.coordinates.lon - 0.01},${detail.coordinates.lat - 0.01},${detail.coordinates.lon + 0.01},${detail.coordinates.lat + 0.01}&layer=mapnik&marker=${detail.coordinates.lat},${detail.coordinates.lon}`}
                    title={`Map for ${hotel.name}`}
                  />
                </div>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${detail.coordinates.lat}&mlon=${detail.coordinates.lon}&zoom=15`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-teal-500 hover:text-teal-400 mt-1 inline-flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open in maps
                </a>
              </div>
            )}

            {/* Contact info */}
            {detail?.contact && (detail.contact.phone || detail.contact.website) && (
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground border-t border-border pt-3">
                {detail.contact.phone && (
                  <a href={`tel:${detail.contact.phone}`} className="flex items-center gap-1 hover:text-foreground">
                    <Phone className="w-3.5 h-3.5" /> {detail.contact.phone}
                  </a>
                )}
                {detail.contact.website && (
                  <a href={detail.contact.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground">
                    <Globe className="w-3.5 h-3.5" /> Website
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── STICKY FOOTER CTA ───────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-border bg-card/95 backdrop-blur-sm px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xl font-bold text-foreground">
                {formatPrice(hotel.pricePerNight)}
                <span className="text-sm font-normal text-muted-foreground"> /night</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Total {formatPrice(hotel.totalPrice)} · {hotel.cancellation}
              </p>
            </div>
            <button
              onClick={() => {
                // If user selected a specific room, build modified hotel with that token
                if (selectedRoom && hotel.allRoomTypes) {
                  const rt = hotel.allRoomTypes.find(r => r.offerId === selectedRoom);
                  if (rt) {
                    const cheapRate = rt.rates?.reduce((m: typeof rt.rates[0] | undefined, r) =>
                      (!m || (r.price ?? Infinity) < (m.price ?? Infinity)) ? r : m, undefined);
                    const updatedHotel: HotelResult = {
                      ...hotel,
                      bookingToken: `liteapi_${rt.offerId}`,
                      pricePerNight: cheapRate?.price
                        ? Math.round((cheapRate.price / Math.max(1,
                          Math.round((new Date(hotel.checkOut).getTime() - new Date(hotel.checkIn).getTime()) / 86400000)
                          )) * 100) / 100
                        : hotel.pricePerNight,
                      totalPrice: cheapRate?.price ?? hotel.totalPrice,
                    };
                    onSelect?.(updatedHotel);
                    onClose();
                    return;
                  }
                }
                onSelect?.(hotel);
                onClose();
              }}
              className="flex-shrink-0 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-semibold text-sm transition-colors"
            >
              Select Hotel
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox (z above modal) */}
      {lightbox !== null && allImages.length > 0 && (
        <Lightbox
          images={allImages}
          startIndex={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}
