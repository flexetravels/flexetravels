'use client';

import Image from 'next/image';
import { MapPin, Star, Tag, ExternalLink, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ExperienceResult } from '@/lib/types';

// ─── Category → colour mapping ────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  'Museum':           'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  'Art Gallery':      'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  'Historic Site':    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'Landmark':         'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'Culture':          'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'Nature':           'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  'Park':             'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  'Beach':            'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  'Adventure':        'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  'Entertainment':    'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300',
  'Food & Drink':     'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  'Viewpoint':        'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  'Sport':            'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

function getCategoryColor(category: string): string {
  return (
    CATEGORY_COLORS[category] ??
    'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  );
}

// ─── Star rating (0–5 scale) ──────────────────────────────────────────────────
function MiniStars({ rating }: { rating: number }) {
  const full    = Math.floor(rating);
  const partial = rating % 1 >= 0.5;
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(
            'w-3 h-3',
            i < full
              ? 'fill-amber-400 text-amber-400'
              : i === full && partial
              ? 'fill-amber-200 text-amber-400'
              : 'fill-none text-muted-foreground/30'
          )}
        />
      ))}
      <span className="ml-1 text-xs text-muted-foreground">{rating.toFixed(1)}</span>
    </span>
  );
}

// ─── Experience placeholder gradients (when no photo) ────────────────────────
const PLACEHOLDER_GRADIENTS = [
  'from-violet-500 to-purple-700',
  'from-teal-500 to-emerald-700',
  'from-amber-500 to-orange-600',
  'from-sky-500 to-blue-700',
  'from-rose-500 to-pink-700',
  'from-cyan-500 to-teal-700',
];

function getGradient(id: string): string {
  // Stable hash → consistent gradient per place
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return PLACEHOLDER_GRADIENTS[hash % PLACEHOLDER_GRADIENTS.length];
}

// ─── Main ExperienceCard ──────────────────────────────────────────────────────
interface ExperienceCardProps {
  experience: ExperienceResult;
  compact?:   boolean;
}

export function ExperienceCard({ experience: exp, compact }: ExperienceCardProps) {
  const categoryColor = getCategoryColor(exp.category);
  const gradient      = getGradient(exp.id);

  return (
    <div className={cn(
      'travel-card overflow-hidden group transition-all duration-200',
      compact ? 'text-xs' : 'text-sm'
    )}>
      {/* Hero image / gradient placeholder */}
      {!compact && (
        <div className="relative h-36 w-full overflow-hidden">
          {exp.image ? (
            <Image
              src={exp.image}
              alt={exp.name}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 600px) 100vw, 420px"
              onError={(e) => {
                // Fade out broken image — gradient shows through
                (e.target as HTMLImageElement).style.opacity = '0';
              }}
              unoptimized
            />
          ) : (
            <div className={cn('w-full h-full bg-gradient-to-br', gradient)} />
          )}

          {/* Gradient overlay for text legibility */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />

          {/* Category badge — top left */}
          <span className={cn(
            'absolute top-2.5 left-2.5 z-10 inline-flex items-center gap-1',
            'text-[10px] font-semibold px-2 py-0.5 rounded-full',
            categoryColor
          )}>
            <Tag className="w-2.5 h-2.5" />
            {exp.category}
          </span>

          {/* Price badge — top right */}
          {exp.price != null ? (
            <span className="absolute top-2.5 right-2.5 z-10 text-[10px] font-bold
                             bg-black/60 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
              <Ticket className="w-2.5 h-2.5" />
              {exp.currency === 'USD' ? '$' : (exp.currency ?? '')}{exp.price}
            </span>
          ) : (
            <span className="absolute top-2.5 right-2.5 z-10 text-[10px] font-bold
                             bg-emerald-600/80 text-white px-2 py-0.5 rounded-full">
              Free
            </span>
          )}

          {/* Name overlay at bottom */}
          <div className="absolute bottom-0 inset-x-0 px-3 pb-2.5 pt-8 z-10">
            <h3 className="font-bold text-white leading-tight text-[0.9rem] line-clamp-2 drop-shadow">
              {exp.name}
            </h3>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="p-3">
        {/* Compact mode: show name + category inline */}
        {compact && (
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-semibold text-foreground truncate">{exp.name}</h3>
            <span className={cn(
              'flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full',
              categoryColor
            )}>
              {exp.category}
            </span>
          </div>
        )}

        {/* Location */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{exp.location !== exp.city ? exp.location : exp.city}</span>
        </div>

        {/* Rating */}
        {exp.rating != null && exp.rating > 0 && (
          <div className="mt-1.5">
            <MiniStars rating={exp.rating} />
          </div>
        )}

        {/* Description */}
        {!compact && exp.description && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {exp.description}
          </p>
        )}

        {/* Duration + CTA row */}
        <div className="flex items-center justify-between gap-2 mt-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {exp.duration && <span>⏱ {exp.duration}</span>}
            <span className="text-[10px] capitalize opacity-60">via {exp.provider}</span>
          </div>

          {exp.bookable && exp.bookingUrl ? (
            <a
              href={exp.bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg
                         text-xs font-semibold bg-teal-600 text-white hover:bg-teal-700
                         transition-colors"
            >
              Book <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <span className="text-[10px] text-muted-foreground/60 italic">
              Discovery only
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
