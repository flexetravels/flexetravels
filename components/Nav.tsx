'use client';

// ─── FlexeTravels — Shared Navigation ────────────────────────────────────────
// Used across landing, about, partners, how-it-works pages.
// Mobile: hamburger drawer. Desktop: inline links.
// Auth: Google sign-in via Supabase. Shows avatar when signed in.

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Plane, Sparkles, Menu, X, LogOut, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { User as SupabaseUser } from '@supabase/supabase-js';

const NAV_LINKS = [
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/about',        label: 'About'        },
  { href: '/partners',     label: 'For Partners'  },
];

// Trip-canvas v2 routes the planning UI to /trip when the flag is on.
// Middleware also redirects /chat → /trip in that case, so this is a perf
// optimization (avoids the redirect hop) more than a behavioural change.
const PLAN_HREF = process.env.NEXT_PUBLIC_TRIP_CANVAS === 'true' ? '/trip' : '/chat';

export function Nav() {
  const [scrolled,  setScrolled]  = useState(false);
  const [menuOpen,  setMenuOpen]  = useState(false);
  const [user, setUser]           = useState<SupabaseUser | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); setAvatarOpen(false); }, [pathname]);

  // Load auth session
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: { user?: SupabaseUser } | null } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: { user?: SupabaseUser } | null) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Close avatar dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setAvatarOpen(false);
    router.refresh();
  };

  const hasBg = scrolled || menuOpen;

  const avatarUrl = user?.user_metadata?.avatar_url;
  const userName  = user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? 'User';

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
            href={PLAN_HREF}
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

          {/* Auth: Avatar or Sign In */}
          {user ? (
            <div ref={avatarRef} className="relative">
              <button
                onClick={() => setAvatarOpen(o => !o)}
                className="w-9 h-9 rounded-full overflow-hidden border-2 border-white/20
                           hover:border-teal-400 transition-colors flex-shrink-0"
                aria-label="Account menu"
              >
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt={userName}
                    width={36}
                    height={36}
                    className="object-cover w-full h-full"
                  />
                ) : (
                  <div className="w-full h-full bg-teal-600 flex items-center justify-center text-white text-sm font-bold">
                    {userName.charAt(0).toUpperCase()}
                  </div>
                )}
              </button>

              {/* Dropdown */}
              {avatarOpen && (
                <div className="absolute right-0 top-12 w-52 rounded-xl bg-[#0f1420] border border-white/10
                                shadow-2xl shadow-black/50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 z-50">
                  <div className="px-4 py-3 border-b border-white/[0.07]">
                    <p className="text-sm font-semibold text-white truncate">{userName}</p>
                    <p className="text-[11px] text-white/40 truncate">{user.email}</p>
                  </div>
                  <Link
                    href="/profile"
                    className="flex items-center gap-2.5 px-4 py-3 text-sm text-white/70
                               hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    <User className="w-4 h-4" />
                    My Profile & Trips
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-white/70
                               hover:text-rose-400 hover:bg-white/[0.06] transition-colors
                               border-t border-white/[0.07]"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="hidden sm:flex items-center px-4 py-2 rounded-full text-sm font-medium
                         text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              Sign In
            </Link>
          )}

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
                    ${menuOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'}`}
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
          {/* Mobile sign-in link */}
          {!user && (
            <Link
              href="/login"
              className="flex items-center px-4 py-3.5 rounded-xl text-sm font-medium
                         text-white/70 hover:text-white hover:bg-white/[0.06]
                         transition-colors touch-manipulation"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
