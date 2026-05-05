'use client';

// TravellersChip — inline editor for adults + children + per-child ages.
// Lives next to the Home Origin chip in the trip header. Click to expand into
// a small popover; changes dispatch `set_travellers` immediately so the next
// search picks up the right counts. Accurate ages matter: < 2 → lap infant
// (often free), 2–11 → child fare (≈ 75% of adult), 12+ → adult fare.

import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Users } from 'lucide-react';

interface Props {
  adults:     number;
  children:   number;
  childAges?: number[];
  onChange:   (next: { adults: number; children: number; childAges?: number[] }) => void;
}

const MAX_ADULTS   = 9;
const MAX_CHILDREN = 6;

export function TravellersChip({ adults, children, childAges, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const summary = (() => {
    const a = `${adults} adult${adults === 1 ? '' : 's'}`;
    if (children === 0) return a;
    return `${a} · ${children} child${children === 1 ? '' : 'ren'}`;
  })();

  function setAdults(n: number) {
    onChange({ adults: clamp(n, 1, MAX_ADULTS), children, childAges });
  }
  function setChildren(n: number) {
    const next = clamp(n, 0, MAX_CHILDREN);
    // Resize childAges to match the new count
    const ages = next > 0
      ? Array.from({ length: next }, (_, i) => childAges?.[i] ?? 8)
      : undefined;
    onChange({ adults, children: next, childAges: ages });
  }
  function setAge(i: number, age: number) {
    const ages = Array.from({ length: children }, (_, j) =>
      j === i ? clamp(age, 0, 17) : (childAges?.[j] ?? 8),
    );
    onChange({ adults, children, childAges: ages });
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="group inline-flex items-center gap-1.5 px-2 h-6 rounded-md hover:bg-navy-800/40 text-xs text-navy-200 hover:text-white"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Edit travellers"
      >
        <Users className="w-3 h-3 text-teal-400" />
        <span>{summary}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Travellers"
          className="absolute left-0 top-full mt-2 w-72 rounded-lg p-4 bg-navy-900 hairline z-30 space-y-3"
        >
          <Counter label="Adults"   sub="13+ years"     value={adults}   min={1} max={MAX_ADULTS}   onChange={setAdults} />
          <Counter label="Children" sub="0–17 years"     value={children} min={0} max={MAX_CHILDREN} onChange={setChildren} />

          {children > 0 && (
            <div className="pt-1 border-t border-navy-500/20">
              <p className="text-[10px] uppercase tracking-[0.18em] text-navy-400 font-mono mb-2">
                Age of each child <span className="lowercase text-navy-500 font-sans">— at travel</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: children }, (_, i) => {
                  const v = childAges?.[i] ?? 8;
                  return (
                    <label key={i} className="flex flex-col gap-1">
                      <span className="text-[10px] text-navy-300">Child {i + 1}</span>
                      <select
                        value={v}
                        onChange={(e) => setAge(i, Number(e.target.value))}
                        className="bg-navy-800/70 border border-navy-500/30 rounded px-1.5 py-1 text-xs text-white outline-none focus:border-teal-500/60"
                      >
                        {Array.from({ length: 18 }, (_, age) => (
                          <option key={age} value={age}>{age === 0 ? '<1 yr' : `${age} yr`}</option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
              <p className="text-[10px] text-navy-400 mt-2 leading-snug">
                <strong className="text-teal-300">Why ages matter:</strong> infants under 2 are typically priced as a lap-seat
                (often free or a small percentage of the adult fare); ages 2–11 get a child fare; 12+ pay full adult.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function Counter({ label, sub, value, min, max, onChange }: {
  label: string; sub?: string; value: number; min: number; max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-white">{label}</p>
        {sub && <p className="text-[10px] text-navy-400">{sub}</p>}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(value - 1)}
          disabled={value <= min}
          aria-label={`Decrease ${label.toLowerCase()}`}
          className="h-7 w-7 rounded-md border border-navy-500/40 flex items-center justify-center text-navy-200 hover:text-white hover:border-teal-500/60 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Minus className="w-3 h-3" />
        </button>
        <span className="w-5 text-center text-sm tabular-nums text-white">{value}</span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          disabled={value >= max}
          aria-label={`Increase ${label.toLowerCase()}`}
          className="h-7 w-7 rounded-md border border-navy-500/40 flex items-center justify-center text-navy-200 hover:text-white hover:border-teal-500/60 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}
