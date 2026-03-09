import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FlexeTravels – AI-Powered Trip Planner',
  description:
    'Plan your perfect trip with real-time flights, hotels, and personalized itineraries — powered by Claude AI.',
  keywords: ['travel', 'AI trip planner', 'flights', 'hotels', 'itinerary'],
  openGraph: {
    title: 'FlexeTravels – AI-Powered Trip Planner',
    description: 'Plan your dream trip with AI.',
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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange={false}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
