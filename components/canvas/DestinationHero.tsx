'use client';

// DestinationHero — photo-only hero for a leg block. Replaces the earlier
// DestinationReel which tried to render an autoplay video on top of the
// poster; the public Pexels CDN URL pattern needs an API-key-issued filename
// per video (the guess-the-URL approach returns 403), so the video element
// kept covering the poster with a black frame.
//
// Lazy-loads via IntersectionObserver: only the legs the user has scrolled
// to actually fetch their hero. The bottom-up gradient overlay keeps the
// city-name + dates legible on top of any photo.

import { useEffect, useRef, useState } from 'react';

interface Props {
  src:        string;          // hero image URL (Unsplash served, sized to 1600w)
  fallbackSrc?: string;        // known-good gallery image if the hero URL 404/400s
  alt:        string;          // accessible label, e.g. "Puerto Vallarta"
  className?: string;
  overlay?:   React.ReactNode; // leg label / dates rendered on top
}

export function DestinationHero({ src, fallbackSrc, alt, className = '', overlay }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [activeSrc, setActiveSrc] = useState(src);

  useEffect(() => {
    setActiveSrc(src || fallbackSrc || '');
  }, [src, fallbackSrc]);

  // Defer fetching the hero until the leg is near the viewport. Same trick
  // PhotoStrip uses — keeps the canvas snappy when the user has many legs.
  useEffect(() => {
    if (!wrapRef.current) return;
    if (typeof IntersectionObserver === 'undefined') { setShouldLoad(true); return; }
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { setShouldLoad(true); obs.disconnect(); break; }
      }
    }, { rootMargin: '200px 0px' });
    obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, []);

  return (
    // The caller (DayLegBlock) passes `absolute inset-0` to fill the leg's
    // h-56 / h-64 wrapper. We avoid combining `relative` with that here —
    // both are `position` utilities and Tailwind's source order makes
    // `relative` win in the cascade, which collapses the wrapper to height 0.
    // Children below use `absolute inset-0` against this wrapper directly.
    <div ref={wrapRef} className={`overflow-hidden ${className}`}>
      <div className="absolute inset-0 bg-gradient-to-br from-navy-800 to-navy-950" aria-hidden />

      {shouldLoad && activeSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={activeSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => {
            if (fallbackSrc && activeSrc !== fallbackSrc) setActiveSrc(fallbackSrc);
            else setActiveSrc('');
          }}
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
        />
      )}

      {/* Legibility gradient — keeps the leg label readable on bright photos */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(11,14,24,0) 30%, rgba(11,14,24,0.35) 70%, rgba(11,14,24,0.9) 100%)' }}
        aria-hidden
      />

      {overlay}
    </div>
  );
}
