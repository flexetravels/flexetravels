'use client';

// ─── FlexeTravels — Shared Navigation ────────────────────────────────────────
// Used across landing, about, partners, how-it-works pages.
// Mobile: hamburger drawer. Desktop: inline links.

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plane, Sparkles, Menu, X } from 'lucide-react';

const NAV_LINKS = [
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/about',        label: 'About'        },
  { href: '/partners',     label: 'For Partners'  },
];

export function Nav() {
  const [scrolled,  setScrolled]  = useState(false);
  const [menuOpen,  setMenuOpen]  = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const hasBg = scrolled || menuOpen;

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300
                  ${hasBg
                    ? 'bg-[#070b12]/96 backdrop-blur-lg border-b border-white/[0.07] shadow-2xl'
                    : ''
                  }`}
      aria-label="Main navigation"
    >
      <div className="flex items-center justify-between px-5 sm:px-8 py-4 max-w-7xl mx-auto">

        {/* ── Logo ── */}
        <Link href="/" className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-teal-800
                          flex items-center justify-center shadow-lg shadow-teal-900/40">
            <Plane className="w-[18px] h-[18px] text-white" strokeWidth={1.8} />
          </div>
          <span className="font-bold text-white text-base tracking-tight">
            Flexe<span className="text-teal-400">Travels</span>
          </span>
          <span className="hidden sm:inline text-[10px] text-white/35 border border-white/10
                           rounded-full px-2 py-0.5 font-medium tracking-wide">
            AI Travel
          </span>
        </Link>

        {/* ── Desktop links ── */}
        <div className="hidden md:flex items-center gap-0.5">
          {NAV_LINKS.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors duration-150
                          ${pathname === l.href
                            ? 'text-teal-400 bg-teal-500/10'
                            : 'text-white/55 hover:text-white hover:bg-white/[0.06]'
                          }`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* ── Right actions ── */}
        <div className="flex items-center gap-2">
          <Link
            href="/chat"
            className="flex items-center gap-1.5 px-4 sm:px-5 py-2.5 rounded-full text-sm font-bold
                       bg-gradient-to-r from-teal-500 to-cyan-500 text-white
                       shadow-lg shadow-teal-900/30 hover:shadow-teal-900/50
                       hover:from-teal-400 hover:to-cyan-400
                       transition-all duration-200 hover:-translate-y-px touch-manipulation"
          >
            <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">Plan a Trip</span>
            <span className="sm:hidden">Plan</span>
          </Link>

          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="md:hidden p-2.5 rounded-xl text-white/60 hover:text-white
                       hover:bg-white/[0.08] transition-colors touch-manipulation
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen
              ? <X    className="w-5 h-5" />
              : <Menu className="w-5 h-5" />
            }
          </button>
        </div>
      </div>

      {/* ── Mobile drawer ── */}
      <div
        className={`md:hidden transition-all duration-300 overflow-hidden
                    ${menuOpen ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'}`}
        aria-hidden={!menuOpen}
      >
        <div className="border-t border-white/[0.07] px-5 py-3 bg-[#070b12]/98 space-y-1">
          {NAV_LINKS.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className={`flex items-center px-4 py-3.5 rounded-xl text-sm font-medium
                          transition-colors touch-manipulation
                          ${pathname === l.href
                            ? 'text-teal-400 bg-teal-500/10'
                            : 'text-white/70 hover:text-white hover:bg-white/[0.06]'
                          }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
