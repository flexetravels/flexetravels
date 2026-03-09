'use client';

import { useState, useCallback, useRef } from 'react';
import Image from 'next/image';
import {
  ChevronDown, ChevronRight, GripVertical, Plane, Hotel,
  MapPin, Clock, PlusCircle, Trash2, Edit3, X, ChevronsLeft,
} from 'lucide-react';
import { cn, formatPrice, formatDate } from '@/lib/utils';
import { FlightCard } from './FlightCard';
import { HotelCard } from './HotelCard';
import type { Itinerary, ItineraryDay } from '@/lib/types';

// ─── Drag-and-drop (without react-dnd to avoid SSR issues) ────────────────────
function useDragOrder<T extends { id: string }>(
  items: T[],
  onChange: (newItems: T[]) => void
) {
  const dragIdx = useRef<number | null>(null);

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    dragIdx.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    const next = [...items];
    const [moved] = next.splice(dragIdx.current, 1);
    next.splice(idx, 0, moved);
    dragIdx.current = idx;
    onChange(next);
  };

  const handleDrop = () => { dragIdx.current = null; };

  return { handleDragStart, handleDragOver, handleDrop };
}

// ─── Activity type icon / color ────────────────────────────────────────────────
const ACTIVITY_COLOR: Record<string, string> = {
  sightseeing:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  food:         'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  transport:    'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  accommodation:'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  activity:     'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  free:         'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

// ─── DayCard ──────────────────────────────────────────────────────────────────
interface DayCardProps {
  day:       ItineraryDay;
  index:     number;
  onEdit?:   (day: ItineraryDay) => void;
  onDelete?: (id: string) => void;
  onDragStart: (e: React.DragEvent, idx: number) => void;
  onDragOver:  (e: React.DragEvent, idx: number) => void;
  onDrop:      () => void;
}

function DayCard({ day, index, onEdit, onDelete, onDragStart, onDragOver, onDrop }: DayCardProps) {
  const [open, setOpen] = useState(index === 0);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={onDrop}
      className="day-card group animate-fade-in-up"
    >
      {/* Header */}
      <div
        className="header"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* Drag handle */}
          <div
            className="drag-handle opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="w-4 h-4" />
          </div>

          {/* Day badge */}
          <span className="flex-shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center bg-teal-600 dark:bg-teal-500 text-white">
            {day.day}
          </span>

          {/* Title */}
          <span className="truncate text-sm font-semibold text-foreground">{day.title}</span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Cost */}
          {day.totalCost !== undefined && (
            <span className="price-badge text-xs">{formatPrice(day.totalCost)}</span>
          )}
          {/* Actions */}
          <button
            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted transition-all"
            onClick={(e) => { e.stopPropagation(); onEdit?.(day); }}
            title="Edit day"
          >
            <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button
            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 transition-all"
            onClick={(e) => { e.stopPropagation(); onDelete?.(day.id); }}
            title="Remove day"
          >
            <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
          </button>
          {open
            ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          }
        </div>
      </div>

      {/* Accordion body */}
      {open && (
        <div className="body">
          {/* Cover image */}
          {day.coverImage && (
            <div className="relative h-24 -mx-3 -mt-2 mb-3 overflow-hidden">
              <Image
                src={day.coverImage}
                alt={day.title}
                fill
                className="object-cover"
                sizes="300px"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              <div className="absolute bottom-1.5 left-2 text-xs font-medium text-white flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {day.location}
              </div>
              {day.date && (
                <div className="absolute top-1.5 right-2 text-xs bg-black/40 text-white px-1.5 py-0.5 rounded">
                  {formatDate(day.date)}
                </div>
              )}
            </div>
          )}

          {/* Flight block (compact) */}
          {day.flight && (
            <div className="mb-2">
              <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground mb-1">
                <Plane className="w-3 h-3" />
                Flight
              </div>
              <FlightCard flight={day.flight} compact />
            </div>
          )}

          {/* Hotel block (compact) */}
          {day.hotel && (
            <div className="mb-2">
              <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground mb-1">
                <Hotel className="w-3 h-3" />
                Stay
              </div>
              <HotelCard hotel={day.hotel} compact />
            </div>
          )}

          {/* Activities */}
          {day.activities.length > 0 && (
            <div className="space-y-1.5">
              {day.activities.map((act, i) => (
                <div key={i} className="flex items-start gap-2">
                  {act.time && (
                    <span className="flex-shrink-0 flex items-center gap-0.5 text-xs text-muted-foreground pt-0.5 min-w-[46px]">
                      <Clock className="w-3 h-3" />
                      {act.time}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className={cn(
                      'inline-block text-xs rounded-full px-1.5 py-0.5 font-medium mb-0.5',
                      ACTIVITY_COLOR[act.type] ?? ACTIVITY_COLOR.free
                    )}>
                      {act.type}
                    </span>
                    <p className="text-xs font-medium text-foreground truncate">{act.title}</p>
                    {act.location && (
                      <p className="text-xs text-muted-foreground flex items-center gap-0.5 truncate">
                        <MapPin className="w-2.5 h-2.5" />
                        {act.location}
                      </p>
                    )}
                  </div>
                  {act.cost !== undefined && (
                    <span className="flex-shrink-0 text-xs font-semibold text-foreground">
                      ${act.cost}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          {day.notes && (
            <p className="mt-2 text-xs italic text-muted-foreground border-t border-border pt-2">
              {day.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Sidebar ─────────────────────────────────────────────────────────────
interface ItinerarySidebarProps {
  itinerary:    Itinerary | null;
  onUpdate:     (it: Itinerary) => void;
  onEditDay:    (day: ItineraryDay) => void;
  sidebarOpen:  boolean;
  onClose:      () => void;
  ghostEnabled: boolean;
  onGhostToggle:(v: boolean) => void;
}

export function ItinerarySidebar({
  itinerary,
  onUpdate,
  onEditDay,
  sidebarOpen,
  onClose,
  ghostEnabled,
  onGhostToggle,
}: ItinerarySidebarProps) {
  const handleDaysChange = useCallback(
    (newDays: ItineraryDay[]) => {
      if (!itinerary) return;
      onUpdate({ ...itinerary, days: newDays, updatedAt: new Date().toISOString() });
    },
    [itinerary, onUpdate]
  );

  const { handleDragStart, handleDragOver, handleDrop } = useDragOrder(
    itinerary?.days ?? [],
    handleDaysChange
  );

  const handleDeleteDay = (id: string) => {
    if (!itinerary) return;
    onUpdate({
      ...itinerary,
      days: itinerary.days
        .filter((d) => d.id !== id)
        .map((d, i) => ({ ...d, day: i + 1 })),
      updatedAt: new Date().toISOString(),
    });
  };

  const totalCost = itinerary?.totalCost
    ?? itinerary?.days.reduce((s, d) => s + (d.totalCost ?? 0), 0)
    ?? 0;

  return (
    <>
      <aside
        className={cn(
          'sidebar',
          sidebarOpen ? 'open' : 'collapsed'
        )}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground truncate">
              {itinerary?.title ?? 'Trip Itinerary'}
            </h2>
            {itinerary && (
              <p className="text-xs text-muted-foreground truncate">
                {itinerary.destination}
                {itinerary.days.length > 0 && ` · ${itinerary.days.length} days`}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 ml-2 p-1.5 rounded-lg hover:bg-muted transition-colors md:hidden"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
          <button
            onClick={onClose}
            className="flex-shrink-0 ml-2 p-1.5 rounded-lg hover:bg-muted transition-colors hidden md:flex items-center"
            title="Collapse sidebar"
          >
            <ChevronsLeft className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Cost summary */}
        {itinerary && totalCost > 0 && (
          <div className="px-4 py-2 border-b border-border bg-muted/30 flex-shrink-0">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Estimated total</span>
              <span className="font-bold text-foreground text-sm">
                {formatPrice(totalCost, itinerary.currency)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {itinerary.adults} adult{itinerary.adults !== 1 ? 's' : ''}
            </div>
          </div>
        )}

        {/* Day cards (scrollable) */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {!itinerary || itinerary.days.length === 0 ? (
            <EmptyState />
          ) : (
            itinerary.days.map((day, idx) => (
              <DayCard
                key={day.id}
                day={day}
                index={idx}
                onEdit={onEditDay}
                onDelete={handleDeleteDay}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              />
            ))
          )}
        </div>

        {/* Footer: Ghost toggle */}
        <div className="flex-shrink-0 px-3 py-3 border-t border-border space-y-2">
          {/* Travel Ghost toggle */}
          <div className="ghost-toggle">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground">Travel Ghost</p>
              <p className="text-xs text-muted-foreground leading-snug">
                Save itinerary across sessions
              </p>
            </div>
            <button
              role="switch"
              aria-checked={ghostEnabled}
              onClick={() => onGhostToggle(!ghostEnabled)}
              className={cn(
                'relative flex-shrink-0 w-10 h-6 rounded-full transition-colors duration-200',
                ghostEnabled
                  ? 'bg-teal-600 dark:bg-teal-500'
                  : 'bg-muted'
              )}
            >
              <span
                className={cn(
                  'absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
                  ghostEnabled ? 'translate-x-4' : 'translate-x-0'
                )}
              />
            </button>
          </div>

          {/* Add day shortcut */}
          <button
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-teal-600/50 hover:bg-teal-50/50 dark:hover:bg-teal-950/30 transition-all duration-150"
            title="Type /add-day in chat"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            Add day via chat (<code className="font-mono">/add-day</code>)
          </button>
        </div>
      </aside>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
        <MapPin className="w-7 h-7 text-muted-foreground/50" />
      </div>
      <p className="text-sm font-medium text-foreground">No itinerary yet</p>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
        Start a conversation with the AI to build your trip.
        Flight &amp; hotel selections will appear here.
      </p>
    </div>
  );
}
