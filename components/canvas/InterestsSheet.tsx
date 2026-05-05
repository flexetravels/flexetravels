'use client';

// InterestsSheet — one-time "what's your vibe?" picker that biases the AI's
// destination, hotel, and activity picks. Skippable. Persisted into
// state.meta.interests via a `set_interests` op.
//
// Visual: full-width modal on mobile, centered ~640px sheet on desktop, with
// 12 vibe cards each using a small Unsplash thumbnail. Multi-select up to 3.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';

interface Vibe {
  id:      string;          // canonical key persisted in state
  label:   string;          // user-facing
  blurb:   string;          // short hint shown under label
  imageId: string;          // Unsplash photo id
}

const VIBES: Vibe[] = [
  { id: 'beach',    label: 'Beach & sun',     blurb: 'sand, sea, sunsets',     imageId: '1507525428034-b723cf961d3e' },
  { id: 'romance',  label: 'Romance',         blurb: 'candle-lit & quiet',      imageId: '1502602898657-3e91760cbb34' },
  { id: 'foodie',   label: 'Foodie',          blurb: 'chefs & late dinners',    imageId: '1414235077428-338989a2e8c0' },
  { id: 'culture',  label: 'Culture & arts',  blurb: 'museums, history',        imageId: '1525874684015-58379d421a52' },
  { id: 'adventure',label: 'Adventure',       blurb: 'hike, dive, drive',       imageId: '1551632811-561732d1e306' },
  { id: 'wellness', label: 'Wellness',        blurb: 'spa, yoga, slow',         imageId: '1540555700478-4be289fbecef' },
  { id: 'city',     label: 'City break',      blurb: 'cafés & sidewalks',       imageId: '1496442226666-8d4d0e62e6e9' },
  { id: 'family',   label: 'Family',          blurb: 'kid-friendly stays',      imageId: '1530878957260-a6b5e9c30b9b' },
  { id: 'wildlife', label: 'Wildlife',        blurb: 'safaris & reefs',         imageId: '1546182990-dffeafbe841d' },
  { id: 'luxury',   label: 'Luxury',          blurb: 'no-compromise stays',     imageId: '1551918120-9739cb430c6d' },
  { id: 'budget',   label: 'Budget',          blurb: 'value-first',             imageId: '1488646953014-85cb44e25828' },
  { id: 'offbeat',  label: 'Off-the-beaten',  blurb: 'fewer crowds',            imageId: '1469474968028-56623f02e42e' },
];

const MAX_PICKS = 3;

interface Props {
  open:    boolean;
  onClose: () => void;
  onSave:  (interests: string[]) => void;
  onSkip:  () => void;
  initial?: string[];
}

export function InterestsSheet({ open, onClose, onSave, onSkip, initial }: Props) {
  const [picked, setPicked] = useState<string[]>(initial ?? []);
  // Only reset picked state when the dialog OPENS — not on every parent
  // re-render. Without this guard, callers passing `initial={meta.interests ?? []}`
  // would mint a new empty array each render, which would clobber `picked`
  // after every click and disable the Save button.
  const wasOpenRef = useRef(open);
  useEffect(() => {
    if (open && !wasOpenRef.current) setPicked(initial ?? []);
    wasOpenRef.current = open;
  }, [open, initial]);

  const remaining = useMemo(() => MAX_PICKS - picked.length, [picked]);

  function toggle(id: string) {
    setPicked(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= MAX_PICKS) return prev;
      return [...prev, id];
    });
  }

  function handleSave() {
    onSave(picked);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-navy-900 border border-navy-500/40 text-navy-100 sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle
            className="text-white text-2xl md:text-3xl"
            style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}
          >
            What&apos;s your vibe?
          </DialogTitle>
          <DialogDescription className="text-navy-300">
            Pick up to {MAX_PICKS} — Maya will use these to bias hotels, dinners, and day plans toward what you actually love.
            <span className="block mt-1 text-[11px] text-navy-400">You can change this anytime.</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 py-4">
          {VIBES.map((v) => {
            const active = picked.includes(v.id);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => toggle(v.id)}
                aria-pressed={active}
                className={`group relative overflow-hidden rounded-xl text-left transition focus:outline-none focus:ring-2 focus:ring-teal-500/60 ${
                  active ? 'ring-2 ring-teal-500' : 'ring-1 ring-navy-500/30 hover:ring-teal-500/40'
                }`}
                style={{ aspectRatio: '4 / 3' }}
              >
                <div
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                  style={{
                    backgroundImage: `linear-gradient(180deg, rgba(11,14,24,0.05), rgba(11,14,24,0.85)), url('https://images.unsplash.com/photo-${v.imageId}?w=600&q=80&fit=crop&auto=format')`,
                    backgroundColor: '#1c2540',
                  }}
                />
                {active && (
                  <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-teal-500 flex items-center justify-center shadow-md">
                    <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <p
                    className="text-white text-sm font-medium leading-tight"
                    style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}
                  >
                    {v.label}
                  </p>
                  <p className="text-[11px] text-navy-100/80 mt-0.5">{v.blurb}</p>
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-navy-400 font-mono uppercase tracking-wider text-center -mt-2 mb-1">
          {picked.length === 0
            ? `pick 1–${MAX_PICKS} · or skip`
            : remaining > 0
              ? `${picked.length} picked · ${remaining} more if you like`
              : `${picked.length} picked · max reached`}
        </p>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={onSkip}
            className="border-navy-500/40 text-navy-200 hover:text-white hover:bg-navy-800/60"
          >
            Skip for now
          </Button>
          <Button
            onClick={handleSave}
            disabled={picked.length === 0}
            className="bg-teal-600 hover:bg-teal-500 text-white disabled:bg-navy-700/60 disabled:text-navy-400"
          >
            Save vibes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Exported so other components (e.g. a settings popover) can read the same labels
export const VIBE_LABELS: Record<string, string> = Object.fromEntries(
  VIBES.map(v => [v.id, v.label]),
);
