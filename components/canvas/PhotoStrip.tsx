'use client';

// PhotoStrip — horizontal-scrolling 4–6 photo gallery, lazy-loaded.
// Shown below the hero on each leg block to give the destination more weight
// without front-loading the whole canvas with images.

import { useEffect, useRef, useState } from 'react';

interface Props {
  photos: string[];
  alt:    string;          // accessible label (e.g. "Paris")
}

export function PhotoStrip({ photos, alt }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            obs.disconnect();
            break;
          }
        }
      },
      { rootMargin: '300px 0px' },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  if (!photos || photos.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <div
        className="flex max-w-full gap-2 overflow-x-auto py-3 px-2.5 sm:px-3 snap-x snap-mandatory scrollbar-thin"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {photos.slice(0, 6).map((src, i) => (
          <div
            key={src + i}
            className="h-28 w-[46vw] max-w-[168px] flex-shrink-0 snap-start rounded-lg overflow-hidden bg-navy-800/70 sm:w-[168px]"
          >
            {visible ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={`${alt} — gallery photo ${i + 1}`}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                onError={(e) => {
                  // Hide the image if the URL is broken
                  (e.currentTarget as HTMLImageElement).style.opacity = '0';
                }}
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-navy-700/60 to-navy-900/60" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
