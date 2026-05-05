'use client';

// AddLegDialog — modal to add a new leg to the canvas.
// Captures: destination city/airport, start date, end date.
// We default the start to "day after the previous leg ends" if there is one.

import { cloneElement, isValidElement, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { type CanvasLeg } from '@/lib/canvas/types';
import { makeLegId } from '@/lib/canvas/state';

interface Props {
  trigger:        React.ReactNode;
  previousLeg?:   CanvasLeg | null;       // used to infer default start date
  onAdd:          (leg: CanvasLeg) => void;
}

const IATA_RE = /^[A-Z]{3}$/;

export function AddLegDialog({ trigger, previousLeg, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState('');
  const [iata, setIata] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd]   = useState('');

  // When the dialog opens, default dates from the previous leg (if any)
  useEffect(() => {
    if (!open) return;
    if (previousLeg) {
      const next = addDays(previousLeg.endDate, 0);
      setStart(next);
      setEnd(addDays(next, 3));
    } else {
      const today = new Date();
      const t1    = addDays(formatYmd(today), 14);
      setStart(t1);
      setEnd(addDays(t1, 4));
    }
  }, [open, previousLeg]);

  const error = useMemo(() => {
    if (!city.trim()) return 'Pick a destination';
    if (iata && !IATA_RE.test(iata.toUpperCase())) return 'Airport code must be 3 letters (e.g. CDG)';
    if (!start || !end) return 'Pick both dates';
    if (end < start) return 'End date must be after start';
    return null;
  }, [city, iata, start, end]);

  function handleAdd() {
    if (error) return;
    const leg: CanvasLeg = {
      id:        makeLegId(),
      city:      city.trim(),
      iata:      iata ? iata.toUpperCase() : undefined,
      startDate: start,
      endDate:   end,
    };
    onAdd(leg);
    setOpen(false);
    // Reset for next open
    setCity('');
    setIata('');
  }

  // Clone the trigger element to attach our onClick. Falls back to wrapping in
  // a button if the consumer passed something non-element (e.g. a string).
  const triggerEl = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<{ onClick?: () => void }>, { onClick: () => setOpen(true) })
    : <button type="button" onClick={() => setOpen(true)}>{trigger}</button>;

  return (
    <>
      {triggerEl}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-navy-900 border border-navy-500/40 text-navy-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white text-xl" style={{ fontFamily: 'var(--font-spectral), Georgia, serif' }}>
            Where next?
          </DialogTitle>
          <DialogDescription className="text-navy-300">
            Add a stop to your trip. We&apos;ll find flights and hotels for it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="leg-city" className="text-xs text-navy-200 uppercase tracking-wider font-mono">City or destination</Label>
            <Input
              id="leg-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Paris"
              maxLength={80}
              className="mt-1.5 bg-navy-800/60 border-navy-500/40 text-white placeholder:text-navy-400"
            />
          </div>
          <div>
            <Label htmlFor="leg-iata" className="text-xs text-navy-200 uppercase tracking-wider font-mono">
              Airport code <span className="lowercase text-navy-400 font-sans">— optional</span>
            </Label>
            <Input
              id="leg-iata"
              value={iata}
              onChange={(e) => setIata(e.target.value.toUpperCase().slice(0, 3))}
              placeholder="CDG"
              maxLength={3}
              className="mt-1.5 bg-navy-800/60 border-navy-500/40 text-white placeholder:text-navy-400 font-mono uppercase tracking-wider"
            />
            <p className="mt-1 text-[11px] text-navy-400">Skip this and we&apos;ll pick the main airport for the city.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="leg-start" className="text-xs text-navy-200 uppercase tracking-wider font-mono">Arrive</Label>
              <Input
                id="leg-start"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="mt-1.5 bg-navy-800/60 border-navy-500/40 text-white"
              />
            </div>
            <div>
              <Label htmlFor="leg-end" className="text-xs text-navy-200 uppercase tracking-wider font-mono">Leave</Label>
              <Input
                id="leg-end"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                min={start}
                className="mt-1.5 bg-navy-800/60 border-navy-500/40 text-white"
              />
            </div>
          </div>
          {error && (
            <p className="text-amber-400 text-xs font-mono">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} className="border-navy-500/40 text-navy-200 hover:text-white hover:bg-navy-800/60">
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!!error}
            className="bg-teal-600 hover:bg-teal-500 text-white"
          >
            Add to trip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(ymd: string, days: number): string {
  if (!ymd) return '';
  const d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return formatYmd(d);
}
