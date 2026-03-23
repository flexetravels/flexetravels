// ─── FlexeTravels — Partners Page ────────────────────────────────────────────
// B2B pitch to API vendors, aggregators, and technology partners.
// Positioned for Duffel, LiteAPI, Stripe, Amadeus, new providers.

import Link from 'next/link';
import {
  Plane, Sparkles, ArrowRight, CheckCircle2,
  Zap, CreditCard, Globe, Users, TrendingUp,
  Code2, Shield, BarChart3, Handshake,
  ChevronRight, Building2, Layers,
} from 'lucide-react';
import { Nav } from '@/components/Nav';

export const metadata = {
  title: 'Partner with FlexeTravels — API & Distribution Partners',
  description: 'Join the infrastructure powering AI-native travel booking. FlexeTravels sends pre-qualified, high-intent bookings via Duffel, LiteAPI, and Stripe.',
};

export default function PartnersPage() {
  return (
    <div className="min-h-screen bg-[#070b12] text-white overflow-x-hidden">
      <Nav />

      {/* ── Hero ── */}
      <section className="relative pt-32 pb-24 px-5 sm:px-8 overflow-hidden">
        {/* Ambient */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute -top-60 left-0 w-[700px] h-[700px] rounded-full bg-teal-700/10 blur-[140px]" />
          <div className="absolute top-1/3 right-0 w-[500px] h-[500px] rounded-full bg-violet-600/8 blur-[120px]" />
        </div>
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,1) 1px,transparent 1px)',
          backgroundSize: '64px 64px',
        }} />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-teal-500/10 border border-teal-500/25
                          rounded-full px-4 py-1.5 text-teal-300 text-xs font-semibold mb-8">
            <Handshake className="w-3.5 h-3.5" />
            Technology &amp; distribution partnerships
          </div>

          <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl font-extrabold text-white
                         leading-[1.08] tracking-tight mb-6">
            Power the next era
            <br />
            <span className="bg-gradient-to-r from-teal-400 via-cyan-300 to-teal-500
                             bg-clip-text text-transparent">
              of AI travel booking.
            </span>
          </h1>

          <p className="text-white/50 text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed mb-10">
            FlexeTravels isn&apos;t a search engine that sends users to OTAs. We&apos;re a direct booking
            engine — flights confirmed via Duffel, hotels via LiteAPI, payments via Stripe.
            We send qualified, transactional traffic with high booking intent.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a href="mailto:partners@flexetravels.com"
              className="inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-2xl
                         font-bold bg-gradient-to-r from-teal-500 to-cyan-500 text-white
                         shadow-[0_8px_36px_rgba(13,148,136,0.4)]
                         hover:shadow-[0_16px_56px_rgba(13,148,136,0.55)]
                         transition-all duration-300 hover:-translate-y-0.5 touch-manipulation">
              <Sparkles className="w-5 h-5 flex-shrink-0" />
              Get in touch
            </a>
            <Link href="/how-it-works"
              className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl
                         font-semibold border border-white/15 text-white/65
                         hover:text-white hover:border-white/30 bg-white/[0.04]
                         hover:bg-white/[0.07] transition-all duration-200 touch-manipulation">
              See how it works <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Stats ribbon ── */}
      <div className="border-y border-white/[0.06] bg-white/[0.02]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8">
            {[
              { val: '200+',   lbl: 'Airlines via Duffel',      icon: <Plane className="w-5 h-5" /> },
              { val: '1M+',    lbl: 'Hotels via LiteAPI',        icon: <Globe className="w-5 h-5" /> },
              { val: '3',      lbl: 'AI models coordinated',     icon: <Sparkles className="w-5 h-5" /> },
              { val: '$20',    lbl: 'Flat fee — no commissions',  icon: <CreditCard className="w-5 h-5" /> },
            ].map(s => (
              <div key={s.lbl} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20
                                flex items-center justify-center text-teal-400 flex-shrink-0">
                  {s.icon}
                </div>
                <div>
                  <p className="text-white font-extrabold text-xl sm:text-2xl leading-none">{s.val}</p>
                  <p className="text-white/40 text-xs mt-0.5">{s.lbl}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Current integration partners ── */}
      <section className="relative py-20 px-5 sm:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">Current integrations</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">
              Already live with world-class partners.
            </h2>
            <p className="text-white/40 text-base max-w-xl mx-auto">
              Our infrastructure partners power billions in travel transactions globally.
              We&apos;ve built deep, production-grade integrations — not demos.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {[
              {
                name: 'Duffel', role: 'IATA-accredited flight booking',
                color: 'border-teal-500/30 bg-teal-500/5',
                icon: <Plane className="w-7 h-7 text-teal-400" />,
                badge: 'Live — Flights',
                badgeColor: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
                points: [
                  'Full order lifecycle: search → create order → confirm',
                  'Access to 200+ airline NDC and GDS inventory',
                  'Passenger PII collected in-app before booking',
                  'Webhook-ready for order status updates',
                  'Amadeus used as price-reference fallback (not bookable)',
                ],
                link: 'https://duffel.com',
              },
              {
                name: 'LiteAPI', role: 'Global hotel inventory',
                color: 'border-blue-500/30 bg-blue-500/5',
                icon: <Building2 className="w-7 h-7 text-blue-400" />,
                badge: 'Live — Hotels',
                badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
                points: [
                  'Search → prebook (rate lock) → confirm booking flow',
                  '1M+ properties with real-time live rates',
                  'Booking token validation before checkout',
                  'Sandbox (sand_) and production (prod_) environments',
                  'Unsplash images fill in where property photos unavailable',
                ],
                link: 'https://liteapi.travel',
              },
              {
                name: 'Stripe', role: 'Payments & disbursements',
                color: 'border-violet-500/30 bg-violet-500/5',
                icon: <CreditCard className="w-7 h-7 text-violet-400" />,
                badge: 'Live — Payments',
                badgeColor: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
                points: [
                  'Stripe Payment Element embedded in-chat (no redirect)',
                  'PaymentIntent created before booking attempt',
                  'Webhook verification of charge before API calls',
                  'Flat $20 CAD service fee collected per booking',
                  'PCI-compliant — card data never touches our servers',
                ],
                link: 'https://stripe.com',
              },
            ].map(p => (
              <div key={p.name}
                className={`rounded-2xl border p-6 ${p.color} transition-all duration-300
                            hover:bg-white/[0.04]`}>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-white/[0.06] flex items-center justify-center">
                      {p.icon}
                    </div>
                    <div>
                      <h3 className="text-white font-bold text-lg">{p.name}</h3>
                      <p className="text-white/40 text-xs">{p.role}</p>
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold border px-2.5 py-1 rounded-full flex-shrink-0 ml-2 ${p.badgeColor}`}>
                    {p.badge}
                  </span>
                </div>
                <ul className="space-y-2">
                  {p.points.map(pt => (
                    <li key={pt} className="flex items-start gap-2 text-white/50 text-sm">
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-500 flex-shrink-0 mt-0.5" />
                      {pt}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why partner with us ── */}
      <section className="relative py-20 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row gap-12 lg:gap-20 items-start mb-12">
            <div className="lg:w-2/5">
              <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">Why partner with us</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight mb-4">
                We send you
                <span className="bg-gradient-to-r from-teal-400 to-cyan-300 bg-clip-text text-transparent">
                  {' '}the best kind{' '}
                </span>
                of traffic.
              </h2>
              <p className="text-white/45 text-base leading-relaxed">
                Unlike OTA referral links that send browser-shopping users, FlexeTravels sends
                AI-pre-qualified travellers who have specified destination, dates, party size, and
                budget before a single search fires. The intent is confirmed, the details are clean.
              </p>
            </div>

            <div className="lg:w-3/5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { icon: <TrendingUp className="w-5 h-5" />, color: 'text-teal-400 bg-teal-400/10 border-teal-400/20',
                  title: 'Pre-qualified booking intent',
                  desc: 'Users arrive having already told our AI their destination, travel dates, number of adults & children, and approximate budget. Zero browse-and-abandon traffic.' },
                { icon: <Code2 className="w-5 h-5" />, color: 'text-violet-400 bg-violet-400/10 border-violet-400/20',
                  title: 'Clean, structured API calls',
                  desc: 'We handle validation, placeholder detection, and retry logic before your API sees a single request. PII is collected correctly, passenger ages are verified.' },
                { icon: <Shield className="w-5 h-5" />, color: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
                  title: 'Stripe-verified before booking',
                  desc: 'Payment is collected and verified via Stripe webhook before we call Duffel or LiteAPI. No booking attempts without confirmed payment — protecting both parties.' },
                { icon: <BarChart3 className="w-5 h-5" />, color: 'text-rose-400 bg-rose-400/10 border-rose-400/20',
                  title: 'New AI-native distribution',
                  desc: 'FlexeTravels represents a new distribution channel: AI conversation → direct booking. We reach travellers who prefer AI-assisted planning over traditional search.' },
              ].map(item => (
                <div key={item.title}
                  className="flex gap-4 bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5
                             hover:bg-white/[0.05] transition-all duration-300">
                  <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${item.color}`}>
                    {item.icon}
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-sm mb-1.5">{item.title}</h3>
                    <p className="text-white/45 text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Tech architecture ── */}
      <section className="relative py-20 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">Technical architecture</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
              Built for production from day one.
            </h2>
            <p className="text-white/40 text-base mt-3 max-w-xl mx-auto">
              Every booking flows through verified, production-hardened infrastructure.
            </p>
          </div>

          {/* Transaction flow diagram */}
          <div className="relative bg-white/[0.03] border border-white/[0.07] rounded-3xl p-6 sm:p-8 mb-10 overflow-hidden">
            <div className="absolute inset-0 opacity-[0.015] pointer-events-none" style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,1) 1px,transparent 1px)',
              backgroundSize: '32px 32px',
            }} />

            <p className="text-center text-white/30 text-xs font-bold uppercase tracking-[0.2em] mb-8">
              End-to-end booking flow
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              {[
                { step: '01', label: 'AI Conversation', sub: 'Claude + Grok + Gemini', color: 'from-teal-500 to-cyan-500' },
                { step: '02', label: 'Live Search',     sub: 'Duffel · LiteAPI · FSQ', color: 'from-violet-500 to-purple-500' },
                { step: '03', label: 'Card Selection',  sub: 'UI + booking state machine', color: 'from-amber-500 to-orange-500' },
                { step: '04', label: 'Stripe Payment',  sub: 'Webhook verification',   color: 'from-rose-500 to-pink-500' },
                { step: '05', label: 'Booking Confirmed', sub: 'Duffel order + LiteAPI', color: 'from-emerald-500 to-teal-500' },
              ].map((s, i, arr) => (
                <div key={s.step} className="flex sm:flex-col items-center gap-3 sm:gap-2 sm:text-center">
                  <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${s.color}
                                  flex items-center justify-center flex-shrink-0
                                  shadow-lg text-white font-extrabold text-sm`}>
                    {s.step}
                  </div>
                  <div>
                    <p className="text-white font-bold text-sm">{s.label}</p>
                    <p className="text-white/35 text-[10px] mt-0.5">{s.sub}</p>
                  </div>
                  {i < arr.length - 1 && (
                    <ChevronRight className="w-4 h-4 text-white/20 sm:hidden flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Key files */}
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Layers className="w-4 h-4 text-teal-400" />
              <p className="text-white/60 text-xs font-bold uppercase tracking-wider">Stack snapshot</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
              {[
                { file: 'Next.js 15',         role: 'App Router, React Server Components' },
                { file: 'Vercel AI SDK',       role: 'Streaming chat, tool calling' },
                { file: 'lib/search/duffel.ts',  role: 'Flight search + full order booking' },
                { file: 'lib/search/liteapi.ts', role: 'Hotel search + prebook + confirm' },
                { file: 'app/api/chat/route.ts', role: 'Claude orchestrator + tool dispatch' },
                { file: 'app/api/book-trip/route.ts', role: 'Booking orchestrator + Stripe verify' },
                { file: 'components/CheckoutCard.tsx', role: 'Passenger form + Payment Element' },
                { file: 'Railway',            role: 'Auto-deploy on push to main' },
              ].map(f => (
                <div key={f.file} className="flex items-start gap-2">
                  <span className="text-teal-400/70 flex-shrink-0">▸</span>
                  <div>
                    <span className="text-white/70">{f.file}</span>
                    <span className="text-white/30 ml-2">{f.role}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Partnership types ── */}
      <section className="relative py-20 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">How we partner</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
              Three ways to work with us.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                icon: <Code2 className="w-7 h-7 text-white" />, grad: 'from-teal-500 to-cyan-600',
                tier: 'API Integration Partner',
                sub: 'For flight, hotel, experience providers',
                desc: 'Integrate your inventory into FlexeTravels\' live search and booking flow. Your rates appear as AI-presented cards. High-intent users see your options first.',
                points: ['Your API integrated into search fan-out', 'Bookable cards presented in chat UI', 'Booking reference returned to user in-app', 'Revenue share or flat-rate model'],
                cta: 'Discuss API integration',
              },
              {
                icon: <Globe className="w-7 h-7 text-white" />, grad: 'from-violet-500 to-purple-600',
                tier: 'Distribution Partner',
                sub: 'For OTAs, aggregators, destination boards',
                desc: 'White-label or co-brand FlexeTravels for your audience. Embed our AI booking concierge in your platform. Your brand, our engine.',
                points: ['Embeddable AI chat widget', 'Custom system prompt & personality', 'Branded booking confirmation flow', 'Revenue split on completed bookings'],
                cta: 'Explore distribution',
              },
              {
                icon: <Sparkles className="w-7 h-7 text-white" />, grad: 'from-rose-500 to-pink-600',
                tier: 'Co-Marketing Partner',
                sub: 'For destinations, tourism boards, brands',
                desc: 'Feature your destination or experience in our AI-curated trending cards, events grid, or verified destination carousel — reaching high-intent North American travellers.',
                points: ['Featured placement in trending cards', 'Custom AI-generated travel guides', 'Promoted destination chip on welcome screen', 'Trackable booking referral attribution'],
                cta: 'Explore promotion',
              },
            ].map(t => (
              <div key={t.tier}
                className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6
                           hover:bg-white/[0.055] hover:border-white/[0.12] transition-all duration-300
                           flex flex-col">
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${t.grad}
                                flex items-center justify-center mb-5 shadow-lg flex-shrink-0`}>
                  {t.icon}
                </div>
                <h3 className="text-white font-bold text-lg mb-1">{t.tier}</h3>
                <p className="text-teal-400/80 text-xs font-medium mb-3">{t.sub}</p>
                <p className="text-white/45 text-sm leading-relaxed mb-5">{t.desc}</p>
                <ul className="space-y-2 mb-6 flex-1">
                  {t.points.map(pt => (
                    <li key={pt} className="flex items-start gap-2 text-white/45 text-sm">
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-500 flex-shrink-0 mt-0.5" />
                      {pt}
                    </li>
                  ))}
                </ul>
                <a href="mailto:partners@flexetravels.com"
                  className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold
                             border border-white/15 text-white/65 hover:text-white hover:border-white/30
                             bg-white/[0.04] hover:bg-white/[0.07] transition-all duration-200 touch-manipulation">
                  {t.cta} <ArrowRight className="w-3.5 h-3.5" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Business model transparency ── */}
      <section className="relative py-20 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">Business model</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">
              Transparent. Aligned. Simple.
            </h2>
            <p className="text-white/40 text-base max-w-2xl mx-auto leading-relaxed">
              We charge users a flat $20 CAD service fee per completed booking. We don&apos;t take
              commissions from API partners — which means we have no incentive to push overpriced inventory.
              The best option for the user is always the one we recommend.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { icon: <Users className="w-5 h-5" />, label: 'User pays', val: '$20 flat', desc: 'Per completed booking. No per-passenger fees, no hidden charges.' },
              { icon: <Plane className="w-5 h-5" />, label: 'Airline / Hotel pays', val: 'Standard rate', desc: 'Same commission/rate structure as any other Duffel or LiteAPI partner.' },
              { icon: <TrendingUp className="w-5 h-5" />, label: 'FlexeTravels earns', val: '$20 / booking', desc: 'No OTA markup on flight or hotel prices. Clean alignment.' },
            ].map(m => (
              <div key={m.label}
                className="text-center bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6
                           hover:bg-white/[0.05] transition-all duration-300">
                <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20
                                flex items-center justify-center text-teal-400 mx-auto mb-4">
                  {m.icon}
                </div>
                <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-1">{m.label}</p>
                <p className="text-white font-extrabold text-2xl mb-2">{m.val}</p>
                <p className="text-white/40 text-sm">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative py-24 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-3xl mx-auto text-center">
          <div className="relative rounded-3xl overflow-hidden border border-teal-500/20
                          bg-gradient-to-br from-teal-600/20 via-[#0d1f2e] to-[#070b12]
                          p-10 sm:p-16">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-72
                            rounded-full bg-teal-500/12 blur-[90px] pointer-events-none" />
            <div className="relative">
              <Handshake className="w-10 h-10 text-teal-400 mx-auto mb-4" />
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">
                Let&apos;s build something together.
              </h2>
              <p className="text-white/45 mb-8 max-w-xl mx-auto leading-relaxed">
                Whether you&apos;re an API provider, aggregator, destination board, or technology partner —
                we&apos;d love to explore what a partnership could look like.
              </p>
              <a href="mailto:partners@flexetravels.com"
                className="inline-flex items-center gap-3 px-10 py-4 rounded-2xl font-bold text-lg
                           bg-gradient-to-r from-teal-500 to-cyan-500 text-white
                           shadow-[0_8px_40px_rgba(13,148,136,0.45)]
                           hover:shadow-[0_20px_64px_rgba(13,148,136,0.6)]
                           hover:from-teal-400 hover:to-cyan-400
                           transition-all duration-300 hover:-translate-y-1 touch-manipulation">
                <Sparkles className="w-5 h-5" />
                partners@flexetravels.com
              </a>
              <p className="mt-5 text-white/22 text-xs">
                We respond within 1 business day.
              </p>
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
            {[{href:'/how-it-works',label:'How It Works'},{href:'/about',label:'About'},{href:'/chat',label:'Start Planning'}].map(l => (
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
