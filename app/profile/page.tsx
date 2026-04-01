'use client';

// ─── User Profile Page ──────────────────────────────────────────────────────
// Shows user info from Google + booking history.
// Redirects to /login if not authenticated.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Plane, MapPin, Calendar, ArrowLeft, LogOut } from 'lucide-react';
import type { User } from '@supabase/supabase-js';

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: { user: User } | null } }) => {
      if (!session) {
        router.replace('/login');
      } else {
        setUser(session.user);
      }
      setLoading(false);
    });
  }, [router]);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070b12] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const avatarUrl = user.user_metadata?.avatar_url;
  const fullName  = user.user_metadata?.full_name ?? 'Traveler';
  const email     = user.email ?? '';
  const createdAt = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="min-h-screen bg-[#070b12]">
      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-[#070b12]/95 backdrop-blur-lg border-b border-white/[0.07]">
        <div className="max-w-2xl mx-auto px-5 py-4 flex items-center gap-3">
          <Link href="/chat" className="text-white/50 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-base font-bold text-white">My Profile</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-8 space-y-8">
        {/* ── Profile card ── */}
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.07] p-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-teal-500/30 flex-shrink-0">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt={fullName}
                  width={64}
                  height={64}
                  className="object-cover w-full h-full"
                />
              ) : (
                <div className="w-full h-full bg-teal-600 flex items-center justify-center text-white text-2xl font-bold">
                  {fullName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-white truncate">{fullName}</h2>
              <p className="text-sm text-white/40 truncate">{email}</p>
              {createdAt && (
                <p className="text-xs text-white/25 mt-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Member since {createdAt}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Quick actions ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/chat"
            className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.07]
                       hover:bg-white/[0.06] hover:border-teal-500/30 transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-teal-500/10 flex items-center justify-center">
              <Plane className="w-5 h-5 text-teal-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Plan a New Trip</p>
              <p className="text-xs text-white/40">Chat with AI concierge</p>
            </div>
          </Link>

          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.07]
                       hover:bg-rose-500/5 hover:border-rose-500/20 transition-all text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-white/[0.05] flex items-center justify-center">
              <LogOut className="w-5 h-5 text-white/40" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Sign Out</p>
              <p className="text-xs text-white/40">See you next trip</p>
            </div>
          </button>
        </div>

        {/* ── Trips placeholder ── */}
        <div>
          <h3 className="text-sm font-semibold text-white/50 uppercase tracking-wider mb-4">
            Your Trips
          </h3>
          <div className="rounded-2xl bg-white/[0.03] border border-white/[0.07] p-8 text-center">
            <MapPin className="w-8 h-8 text-white/15 mx-auto mb-3" />
            <p className="text-sm text-white/40">
              Your booked trips will appear here.
            </p>
            <p className="text-xs text-white/25 mt-1">
              Start planning a trip to see it in your profile.
            </p>
            <Link
              href="/chat"
              className="inline-flex items-center gap-1.5 mt-4 px-5 py-2.5 rounded-full text-sm font-bold
                         bg-gradient-to-r from-teal-500 to-cyan-500 text-white
                         shadow-lg shadow-teal-900/30 hover:shadow-teal-900/50
                         transition-all duration-200 hover:-translate-y-px"
            >
              Plan a Trip
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
