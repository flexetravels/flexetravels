// Route-scoped fonts for the Trip Canvas.
// Spectral (display serif) and JetBrains Mono (numbers/keyboard) are only
// loaded under /trip/* — all other routes keep their existing Inter-only setup.

import { Spectral, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

const spectral = Spectral({
  subsets: ['latin'],
  weight:  ['400', '500'],
  style:   ['normal', 'italic'],
  variable: '--font-spectral',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight:  ['400', '500'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export default function TripLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${spectral.variable} ${jetbrains.variable}`}>
      {children}
    </div>
  );
}
