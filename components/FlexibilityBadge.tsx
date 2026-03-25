'use client';

/**
 * FlexibilityBadge — compact pill showing a flight's cancellation/change policy.
 * Renders Flexible (green), Moderate (amber), or Locked (red) with a tooltip.
 */

import { useState } from 'react';
import { FLEXIBILITY_TAILWIND, FLEXIBILITY_ICONS } from '@/lib/scoring/flexibility';
import type { FlexibilityLabel } from '@/lib/scoring/flexibility';

interface FlexibilityBadgeProps {
  label:    FlexibilityLabel;
  summary?: string;   // tooltip text
  score?:   number;   // 0–1 (shown as percentage on hover)
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
      <span
        className={[
          'inline-flex items-center gap-1 rounded-full font-semibold cursor-default',
          textSize,
          px,
          FLEXIBILITY_TAILWIND[label],
        ].join(' ')}
      >
        <span className="text-[9px]">{FLEXIBILITY_ICONS[label]}</span>
        {label}
        {score !== undefined && (
          <span className="opacity-60">
            {Math.round(score * 100)}%
          </span>
        )}
      </span>

      {/* Tooltip */}
      {showTooltip && summary && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50
                     bg-popover text-popover-foreground text-[11px] rounded-lg
                     shadow-xl border border-border/50 px-2.5 py-1.5
                     whitespace-nowrap max-w-[240px] pointer-events-none"
        >
          <div className="font-semibold mb-0.5">{label} Policy</div>
          <div className="text-muted-foreground leading-snug">{summary}</div>
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2
                          border-4 border-transparent border-t-border/50" />
        </div>
      )}
    </div>
  );
}
