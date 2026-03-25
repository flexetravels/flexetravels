'use client';

/**
 * FlexibilityBadge — compact pill showing a flight's cancellation/change policy.
 * Uses plain-English labels so customers immediately understand the policy.
 * Hover tooltip shows the full conditions from Duffel (e.g. "Refundable with £30 fee").
 */

import { useState } from 'react';
import { FLEXIBILITY_TAILWIND, FLEXIBILITY_ICONS } from '@/lib/scoring/flexibility';
import type { FlexibilityLabel } from '@/lib/scoring/flexibility';

// Customer-facing display text — avoids internal scoring jargon
const DISPLAY_LABEL: Record<FlexibilityLabel, string> = {
  Flexible: 'Free cancellation',
  Moderate: 'Changeable (fee)',
  Locked:   'Non-refundable',
};

// Short description shown in the tooltip header
const TOOLTIP_HEADER: Record<FlexibilityLabel, string> = {
  Flexible: 'Free cancellation available',
  Moderate: 'Changes allowed with a fee',
  Locked:   'Non-refundable — no changes',
};

interface FlexibilityBadgeProps {
  label:    FlexibilityLabel;
  summary?: string;   // full conditions text from Duffel (e.g. "Refundable with £30 fee")
  score?:   number;   // 0–1 internal score — only shown in tooltip, not on badge face
  size?:    'sm' | 'md';
}

export function FlexibilityBadge({
  label,
  summary,
  score,
  size = 'md',
}: FlexibilityBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const textSize = size === 'sm' ? 'text-[9px]' : 'text-[10px]';
  const px       = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-0.5';

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Badge pill — plain English, no percentage on face */}
      <span
        className={[
          'inline-flex items-center gap-1 rounded-full font-semibold cursor-default',
          textSize,
          px,
          FLEXIBILITY_TAILWIND[label],
        ].join(' ')}
      >
        <span className="text-[9px]">{FLEXIBILITY_ICONS[label]}</span>
        {DISPLAY_LABEL[label]}
      </span>

      {/* Tooltip — shown on hover with full details */}
      {showTooltip && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50
                     bg-popover text-popover-foreground text-[11px] rounded-lg
                     shadow-xl border border-border/50 px-2.5 py-2
                     whitespace-nowrap max-w-[260px] pointer-events-none"
        >
          <div className="font-semibold mb-0.5">{TOOLTIP_HEADER[label]}</div>
          {summary && (
            <div className="text-muted-foreground leading-snug">{summary}</div>
          )}
          {score !== undefined && (
            <div className="text-muted-foreground/60 mt-1 text-[10px]">
              Flexibility score: {Math.round(score * 100)}%
            </div>
          )}
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2
                          border-4 border-transparent border-t-border/50" />
        </div>
      )}
    </div>
  );
}
