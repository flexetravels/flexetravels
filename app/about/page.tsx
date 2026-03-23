// ─── FlexeTravels — About Page ────────────────────────────────────────────────
// Server component — no client hooks needed. Nav is the only client component.

import Link from 'next/link';
import {
  Plane, Sparkles, ArrowRight, CheckCircle2,
  Zap, CreditCard, Globe, Users, Heart,
  Code2, Brain, Shield,
} from 'lucide-react';
import { Nav } from '@/components/Nav';

export const metadata = {
  title: 'About FlexeTravels — The AI That Actually Books',
  description: 'We built FlexeTravels because booking travel should feel like talking to an expert friend, not fighting with 12 browser tabs.',
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#070b12] text-white overflow-x-hidden">
      <Nav />

      {/* ── Hero ── */}
      <section className="relative pt-32 pb-20 px-5 sm:px-8 overflow-hidden">
        {/* Ambient glow */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute -top-40 left-1/4 w-[600px] h-[600px] rounded-full bg-teal-700/10 blur-[130px]" />
          <div className="absolute top-1/2 right-0 w-[400px] h-[400px] rounded-full bg-cyan-600/8 blur-[100px]" />
        </div>
        {/* Grid texture */}
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,1) 1px,transparent 1px)',
          backgroundSize: '64px 64px',
        }} />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-teal-500/10 border border-teal-500/25
                          rounded-full px-4 py-1.5 text-teal-300 text-xs font-semibold mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
            Our story
          </div>

          <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl font-extrabold text-white
                         leading-[1.08] tracking-tight mb-6">
            We built the travel agent
            <br />
            <span className="bg-gradient-to-r from-teal-400 via-cyan-300 to-teal-500
                             bg-clip-text text-transparent">
              that actually books.
            </span>
          </h1>

          <p className="text-white/50 text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed">
            FlexeTravels started from a simple frustration: why does booking a trip require 12 browser tabs,
            three different logins, and still ending up on a redirected OTA?
          </p>
        </div>
      </section>

      {/* ── Origin story ── */}
      <section className="relative py-20 px-5 sm:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">The problem</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-6 leading-tight">
                AI travel tools that
                <span className="text-white/35"> didn&apos;t actually book anything.</span>
              </h2>
              <div className="space-y-4 text-white/55 text-base leading-relaxed">
                <p>
                  The first wave of AI travel tools was impressive — until you tried to book. They&apos;d
                  generate beautiful itineraries, suggest hotels, surface flight options... and then hand
                  you a list of links to Skyscanner, Booking.com, and Expedia.
                </p>
                <p>
                  The AI did the dreaming. You still had to do all the work. And along the way, those OTA
                  referral links quietly inflated every price with commissions.
                </p>
                <p>
                  We wanted something different: an AI that didn&apos;t just inspire you — it completed
                  the transaction. Real flights. Real hotel rooms. Confirmed booking references. Done.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {[
                {
                  icon: <CheckCircle2 className="w-5 h-5" />, color: 'text-teal-400 bg-teal-400/10 border-teal-400/20',
                  title: 'Real confirmations, not referrals',
                  desc: 'We process flight bookings through Duffel (IATA-accredited) and hotel reservations through LiteAPI. You get actual booking references — not links to other sites.',
                },
                {
                  icon: <CreditCard className="w-5 h-5" />, color: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
                  title: 'Aligned incentives',
                  desc: 'We charge a flat $20 service fee per completed booking. We don\'t take OTA commissions — so we have no reason to push overpriced options. We win when you get a great deal.',
                },
                {
                  icon: <Brain className="w-5 h-5" />, color: 'text-violet-400 bg-violet-400/10 border-violet-400/20',
                  title: 'Three AIs, one answer',
                  desc: 'Claude orchestrates the conversation, Grok surfaces price intelligence, Gemini writes your destination guide. Three specialized models, seamlessly coordinated.',
                },
              ].map(item => (
                <div key={item.title}
                  className="flex gap-4 bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5
                             hover:bg-white/[0.05] transition-all duration-300">
                  <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${item.color}`}>
                    {item.icon}
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-sm mb-1">{item.title}</h3>
                    <p className="text-white/45 text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Mission ── */}
      <section className="relative py-20 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">Our mission</p>
          <blockquote className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white leading-tight mb-8">
            &ldquo;Make booking a trip as easy as
            <span className="bg-gradient-to-r from-teal-400 to-cyan-300 bg-clip-text text-transparent">
              {' '}texting a friend.&rdquo;
            </span>
          </blockquote>
          <p className="text-white/45 text-lg max-w-2xl mx-auto leading-relaxed">
            We believe the best travel agent isn&apos;t a website — it&apos;s a knowledgeable, enthusiastic
            person who knows your taste, searches everything at once, and handles the paperwork so you can
            focus on what matters: the trip itself.
          </p>
        </div>
      </section>

      {/* ── Tech stack ── */}
      <section className="relative py-20 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">Built on world-class infrastructure</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
              Production-grade, from day one.
            </h2>
            <p className="text-white/40 text-base mt-3 max-w-xl mx-auto">
              Every component of our stack is chosen for reliability, compliance, and scalability.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: <Plane className="w-6 h-6 text-white" />, grad: 'from-teal-500 to-cyan-600',
                name: 'Duffel',
                role: 'Flight booking',
                desc: 'IATA-accredited airline distribution. Full order lifecycle — search, create, confirm, cancel. Access to 200+ airlines worldwide.',
              },
              {
                icon: <Globe className="w-6 h-6 text-white" />, grad: 'from-blue-500 to-indigo-600',
                name: 'LiteAPI',
                role: 'Hotel inventory',
                desc: 'Global hotel inventory with live rates. Pre-book and confirm flow. 1M+ properties with real-time pricing.',
              },
              {
                icon: <CreditCard className="w-6 h-6 text-white" />, grad: 'from-violet-500 to-purple-600',
                name: 'Stripe',
                role: 'Payments',
                desc: 'PCI-compliant Stripe Payment Element embedded inline. No redirect, no popup. Webhook-verified charge confirmation.',
              },
              {
                icon: <Brain className="w-6 h-6 text-white" />, grad: 'from-orange-500 to-amber-500',
                name: 'Claude (Anthropic)',
                role: 'Orchestration AI',
                desc: 'Primary conversation AI. Manages trip qualification, tool dispatch, and booking state machine. Warm, Layla-inspired personality.',
              },
              {
                icon: <Zap className="w-6 h-6 text-white" />, grad: 'from-rose-500 to-pink-600',
                name: 'Grok (xAI)',
                role: 'Price intelligence',
                desc: 'Real-time market context — "is this a good deal?", seasonal price trends, festival and event impact on hotel rates.',
              },
              {
                icon: <Sparkles className="w-6 h-6 text-white" />, grad: 'from-emerald-500 to-teal-600',
                name: 'Gemini (Google)',
                role: 'Destination guides',
                desc: 'Best time to visit, neighbourhood breakdowns, visa info, currency tips, and AI-generated alternative destination suggestions.',
              },
            ].map(item => (
              <div key={item.name}
                className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6
                           hover:bg-white/[0.055] hover:border-white/[0.12] transition-all duration-300">
                <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${item.grad}
                                flex items-center justify-center mb-4 shadow-lg`}>
                  {item.icon}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-white font-bold text-base">{item.name}</h3>
                  <span className="text-[10px] text-white/35 bg-white/[0.06] px-2 py-0.5 rounded-full">
                    {item.role}
                  </span>
                </div>
                <p className="text-white/45 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Values ── */}
      <section className="relative py-20 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">What we believe</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
              Values that drive every decision.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { icon: <Heart className="w-5 h-5" />, color: 'text-rose-400', title: 'Traveller-first',
                desc: 'Every product decision starts with the traveller. Not SEO. Not ad revenue. Not affiliate commissions. Just a great booking experience.' },
              { icon: <Shield className="w-5 h-5" />, color: 'text-teal-400', title: 'Radical transparency',
                desc: 'We charge $20, flat. We tell you exactly what you\'re getting, what API is being used, and why we recommend one option over another.' },
              { icon: <Code2 className="w-5 h-5" />, color: 'text-violet-400', title: 'Technical depth over demos',
                desc: 'Anyone can show an AI chatbot with fake data. We built real API integrations, real booking flows, and real error handling for when things go wrong.' },
              { icon: <Users className="w-5 h-5" />, color: 'text-amber-400', title: 'Partnerships over extraction',
                desc: 'We work alongside Duffel, LiteAPI, and Stripe — not against them. We send qualified, high-intent traffic. Everybody wins when a booking completes.' },
            ].map(v => (
              <div key={v.title}
                className="flex gap-4 bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6
                           hover:bg-white/[0.05] transition-all duration-300">
                <div className={`mt-0.5 flex-shrink-0 ${v.color}`}>{v.icon}</div>
                <div>
                  <h3 className="text-white font-bold text-base mb-1.5">{v.title}</h3>
                  <p className="text-white/45 text-sm leading-relaxed">{v.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative py-24 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-2xl mx-auto text-center">
          <div className="relative rounded-3xl overflow-hidden border border-teal-500/20
                          bg-gradient-to-br from-teal-600/20 via-[#0d1f2e] to-[#070b12]
                          p-10 sm:p-14">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-60 h-60
                            rounded-full bg-teal-500/15 blur-[80px] pointer-events-none" />
            <div className="relative">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">
                Ready to experience it?
              </h2>
              <p className="text-white/45 mb-8 leading-relaxed">
                No account. No credit card up front. Just describe a trip and see what happens.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/chat"
                  className="inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-2xl
                             font-bold bg-gradient-to-r from-teal-500 to-cyan-500 text-white
                             shadow-[0_8px_36px_rgba(13,148,136,0.4)]
                             hover:shadow-[0_16px_56px_rgba(13,148,136,0.55)]
                             transition-all duration-300 hover:-translate-y-0.5 touch-manipulation">
                  <Sparkles className="w-5 h-5 flex-shrink-0" />
                  Start planning free
                </Link>
                <Link href="/partners"
                  className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl
                             font-semibold border border-white/15 text-white/65
                             hover:text-white hover:border-white/30 bg-white/[0.04]
                             hover:bg-white/[0.07] transition-all duration-200 touch-manipulation">
                  Partner with us <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.05] py-8 px-5 sm:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-500 to-teal-800 flex items-center justify-center">
              <Plane className="w-3.5 h-3.5 text-white" strokeWidth={1.8} />
            </div>
            <span className="font-bold text-white/75 text-sm">
              Flexe<span className="text-teal-400">Travels</span>
            </span>
          </Link>
          <div className="flex gap-6">
            {[{href:'/how-it-works',label:'How It Works'},{href:'/partners',label:'Partners'},{href:'/chat',label:'Start Planning'}].map(l => (
              <Link key={l.href} href={l.href} className="text-white/30 hover:text-white/70 text-xs transition-colors">
                {l.label}
              </Link>
            ))}
          </div>
          <p className="text-white/18 text-[10px]">© {new Date().getFullYear()} FlexeTravels</p>
        </div>
      </footer>
    </div>
  );
}
