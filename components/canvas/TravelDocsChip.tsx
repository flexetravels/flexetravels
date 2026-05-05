'use client';

import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { CanvasTravelDocs } from '@/lib/canvas/types';

interface Props {
  value?: CanvasTravelDocs;
  onChange: (next: CanvasTravelDocs) => void;
}

const PASSPORTS = [
  ['IN', 'India'],
  ['CA', 'Canada'],
  ['US', 'United States'],
  ['GB', 'United Kingdom'],
  ['AU', 'Australia'],
  ['NZ', 'New Zealand'],
  ['PH', 'Philippines'],
  ['CN', 'China'],
];

const COMMON_VISAS = [
  ['US', 'U.S. visa/status'],
  ['CA', 'Canada visa/status'],
  ['GB', 'UK visa/status'],
  ['SCHENGEN', 'Schengen visa/status'],
  ['EU', 'EU residence/status'],
  ['AU', 'Australia visa/status'],
  ['NZ', 'New Zealand visa/status'],
];

export function TravelDocsChip({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const passportCountry = value?.passportCountry ?? '';
  const visas = new Set(value?.visaCountries ?? []);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const summary = passportCountry
    ? `${passportCountry} passport${visas.size > 0 ? ` · ${visas.size} visa${visas.size === 1 ? '' : 's'}` : ''}`
    : 'Passport / transit';

  function update(nextPassport: string, nextVisas: string[]) {
    onChange({
      passportCountry: nextPassport || undefined,
      visaCountries: Array.from(new Set(nextVisas)).slice(0, 30),
      updatedAt: Date.now(),
    });
  }

  function toggleVisa(code: string) {
    const next = new Set(visas);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    update(passportCountry, Array.from(next));
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="group inline-flex items-center gap-1.5 px-2 h-6 rounded-md hover:bg-navy-800/40 text-xs text-navy-200 hover:text-white"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Passport and transit visa filters"
      >
        <ShieldCheck className="w-3 h-3 text-teal-400" />
        <span>{summary}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Passport and transit documents"
          className="absolute left-0 top-full mt-2 w-80 rounded-lg p-4 bg-navy-900 hairline z-30 space-y-4"
        >
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-navy-400 font-mono mb-2">Passport held</p>
            <select
              value={passportCountry}
              onChange={(e) => update(e.target.value, Array.from(visas))}
              className="w-full bg-navy-800/70 border border-navy-500/30 rounded px-2.5 py-2 text-sm text-white outline-none focus:border-teal-500/60"
            >
              <option value="">Select passport country</option>
              {PASSPORTS.map(([code, label]) => (
                <option key={code} value={code}>{label} ({code})</option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-navy-400 font-mono mb-2">
              Valid visas / transit permissions already held
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {COMMON_VISAS.map(([code, label]) => (
                <label
                  key={code}
                  className="flex items-center gap-2 rounded-md border border-navy-600/40 bg-navy-950/35 px-2.5 py-2 text-xs text-navy-200"
                >
                  <input
                    type="checkbox"
                    checked={visas.has(code)}
                    onChange={() => toggleVisa(code)}
                    className="h-3.5 w-3.5 accent-teal-500"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-navy-400 leading-snug">
            We use this only to filter risky transit routings before checkout. Passport numbers stay in secure checkout, not on the canvas.
          </p>
        </div>
      )}
    </div>
  );
}

