import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { CurrencyProvider } from '@/components/CurrencyContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FlexeTravels – Flights and Hotels',
  description:
    'Search live flights and hotels with transparent pricing and a flat booking fee.',
  keywords: ['travel', 'flights', 'hotels', 'booking', 'transparent pricing'],
  openGraph: {
    title: 'FlexeTravels – Flights and Hotels',
    description: 'Search live flights and hotels with transparent pricing.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0d8a62' },
    { media: '(prefers-color-scheme: dark)',  color: '#0b0e18' },
  ],
  width: 'device-width',
  initialScale: 1,
  // Prevent browser from zooming on input focus (iOS Safari)
  // maximumScale:1 deliberately omitted — we want to allow pinch-zoom for accessibility
  // viewportFit:'cover' enables content to extend into iPhone notch/island safe areas
  viewportFit: 'cover',
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'TravelAgency',
  name: 'FlexeTravels',
  url: 'https://www.flexetravels.com',
  telephone: '+17789016639',
  email: 'support@flexetravels.com',
  address: {
    '@type': 'PostalAddress',
    addressRegion: 'BC',
    addressCountry: 'CA',
  },
  description: 'Travel booking platform. Book flights and hotels with a flat $20 service fee.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange={false}
        >
          <CurrencyProvider>
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </CurrencyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
