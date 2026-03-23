// ─── FlexeTravels — How It Works Page ────────────────────────────────────────
// Detailed user-facing walkthrough. Server component.

import Link from 'next/link';
import {
  Plane, Sparkles, ArrowRight, CheckCircle2,
  MessageSquare, Search, MousePointer, CreditCard,
  Zap, Shield, Star, Clock, Users, Globe,
  ChevronDown, Waves, Mountain, Heart, Utensils,
} from 'lucide-react';
import { Nav } from '@/components/Nav';

export const metadata = {
  title: 'How FlexeTravels Works — From Dream to Booked in Minutes',
  description: 'See exactly how FlexeTravels goes from a natural language trip description to confirmed flight and hotel booking — all in one conversation.',
};

// ─── FAQ accordion (client-side interactive) ──────────────────────────────────
// Inlined as server-rendered with CSS details/summary (no JS needed)
function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <details className="group border border-white/[0.07] rounded-2xl overflow-hidden
                        bg-white/[0.02] hover:bg-white/[0.035] transition-colors duration-200">
      <summary className="flex items-center justify-between gap-4 px-6 py-5 cursor-pointer
                          list-none text-white font-semibold text-base select-none
                          [&::-webkit-details-marker]:hidden">
        {q}
        <ChevronDown className="w-5 h-5 text-white/40 flex-shrink-0
                                group-open:rotate-180 transition-transform duration-200" />
      </summary>
      <div className="px-6 pb-5">
        <p className="text-white/50 text-sm leading-relaxed border-t border-white/[0.07] pt-4">
          {a}
        </p>
      </div>
    </details>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-[#070b12] text-white overflow-x-hidden">
      <Nav />

      {/* ── Hero ── */}
      <section className="relative pt-32 pb-20 px-5 sm:px-8 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute -top-40 left-0 w-[600px] h-[600px] rounded-full bg-teal-700/10 blur-[130px]" />
          <div className="absolute top-1/2 right-0 w-[400px] h-[400px] rounded-full bg-cyan-600/8 blur-[100px]" />
        </div>
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,1) 1px,transparent 1px)',
          backgroundSize: '64px 64px',
        }} />

        <div className="relative max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-teal-500/10 border border-teal-500/25
                          rounded-full px-4 py-1.5 text-teal-300 text-xs font-semibold mb-8">
            <Clock className="w-3.5 h-3.5" />
            Dream to booked in under 5 minutes
          </div>

          <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl font-extrabold text-white
                         leading-[1.08] tracking-tight mb-6">
            How it works
            <br />
            <span className="bg-gradient-to-r from-teal-400 via-cyan-300 to-teal-500
                             bg-clip-text text-transparent">
              — really works.
            </span>
          </h1>

          <p className="text-white/50 text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed mb-10">
            No forms. No tabs. No OTA redirects. Just describe a trip and FlexeTravels handles
            everything — from finding the best flights to confirming your hotel booking.
          </p>

          <Link href="/chat"
            className="inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl font-bold text-base
                       bg-gradient-to-r from-teal-500 to-cyan-500 text-white
                       shadow-[0_8px_36px_rgba(13,148,136,0.4)]
                       hover:shadow-[0_16px_56px_rgba(13,148,136,0.55)]
                       transition-all duration-300 hover:-translate-y-0.5 touch-manipulation">
            <Sparkles className="w-5 h-5 flex-shrink-0" />
            Try it now — it&apos;s free
            <ArrowRight className="w-4 h-4 flex-shrink-0" />
          </Link>
        </div>
      </section>

      {/* ── Main steps ── */}
      <section className="relative py-20 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">The process</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
              Four steps. One window.
            </h2>
          </div>

          <div className="space-y-5">
            {[
              {
                n: '01', grad: 'from-teal-500 to-cyan-500',
                icon: <MessageSquare className="w-7 h-7 text-white" />,
                title: 'Tell the AI what you\'re dreaming of',
                detail: 'Start with a vibe, not a form. Say something like "I want a beach vacation with my partner somewhere warm in March, budget around $3,000 for both of us" — or pick one of the experience chips on the welcome screen.',
                extras: [
                  { icon: <Waves className="w-4 h-4" />, label: 'Beach & Sun', color: 'text-sky-400' },
                  { icon: <Mountain className="w-4 h-4" />, label: 'Adventure', color: 'text-emerald-400' },
                  { icon: <Heart className="w-4 h-4" />, label: 'Romance', color: 'text-rose-400' },
                  { icon: <Utensils className="w-4 h-4" />, label: 'Food & Wine', color: 'text-amber-400' },
                ],
                extrasLabel: 'Experience chips on the welcome screen:',
                tip: 'Pro tip: The AI speaks natural language. "Somewhere warm, I\'m flexible on exact dates" works just as well as specific dates.',
              },
              {
                n: '02', grad: 'from-violet-500 to-purple-500',
                icon: <Search className="w-7 h-7 text-white" />,
                title: 'Three AIs search everything in parallel',
                detail: 'Once the AI understands your trip, it fans out across all providers simultaneously — not sequentially. Results typically arrive in 3–8 seconds.',
                bullets: [
                  { icon: <Plane className="w-4 h-4" />, text: 'Duffel searches 200+ airlines for bookable flights from your origin city' },
                  { icon: <Globe className="w-4 h-4" />, text: 'LiteAPI searches 1M+ hotels with live real-time rates' },
                  { icon: <Zap className="w-4 h-4" />, text: 'Grok checks current market prices — "is this a good deal?" context' },
                  { icon: <Sparkles className="w-4 h-4" />, text: 'Gemini writes your destination guide with visa info, best time to visit, local tips' },
                ],
                tip: 'The AI tells you which flights are confirmed-bookable (Duffel ✅) vs. reference-only (Amadeus — for price comparison only).',
              },
              {
                n: '03', grad: 'from-amber-500 to-orange-500',
                icon: <MousePointer className="w-7 h-7 text-white" />,
                title: 'Pick your favourites from rich cards',
                detail: 'Flights appear as interactive cards you can scroll and compare — sorted by price by default, filterable by stops. Hotels show real photos, star ratings, amenities, and price per night.',
                bullets: [
                  { icon: <Star className="w-4 h-4" />, text: 'Filter flights by stops: non-stop, 1 stop, 2+ stops' },
                  { icon: <Star className="w-4 h-4" />, text: 'Filter hotels by star rating: 3★, 4★, 5★' },
                  { icon: <Star className="w-4 h-4" />, text: 'Sort by price, duration, rating' },
                  { icon: <Star className="w-4 h-4" />, text: 'The AI remembers your selection and confirms before proceeding' },
                ],
                tip: 'If you don\'t need a flight (e.g., hotel-only or you\'ve already booked flights), just say so — the AI will proceed to hotels directly.',
              },
              {
                n: '04', grad: 'from-rose-500 to-pink-500',
                icon: <CreditCard className="w-7 h-7 text-white" />,
                title: 'Book and pay — right here, in the chat',
                detail: 'Once you\'ve selected your flight and hotel, you\'re taken to a checkout page. Enter passenger details (names, DOBs, email) and pay via Stripe. Everything is confirmed before you leave the page.',
                bullets: [
                  { icon: <Shield className="w-4 h-4" />, text: 'Stripe Payment Element — PCI-compliant, card data never touches our servers' },
                  { icon: <CheckCircle2 className="w-4 h-4" />, text: 'Duffel booking reference returned and displayed immediately' },
                  { icon: <CheckCircle2 className="w-4 h-4" />, text: 'LiteAPI hotel voucher confirmed and displayed' },
                  { icon: <CheckCircle2 className="w-4 h-4" />, text: 'Flat $20 CAD service fee collected once per booking' },
                ],
                tip: 'You have 10 minutes from card selection to payment before rates may change. A timer warns you if you\'re getting close.',
              },
            ].map((step, idx) => (
              <div key={step.n}
                className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 lg:gap-10
                           bg-white/[0.025] border border-white/[0.07] rounded-3xl p-6 sm:p-8
                           hover:bg-white/[0.04] transition-all duration-300">
                {/* Step indicator */}
                <div className="flex lg:flex-col items-center lg:items-start gap-4 lg:gap-3 lg:w-24">
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${step.grad}
                                  flex items-center justify-center flex-shrink-0 shadow-lg`}>
                    {step.icon}
                  </div>
                  <div className="text-[3rem] font-extrabold text-white/[0.045] leading-none select-none hidden sm:block">
                    {step.n}
                  </div>
                </div>

                {/* Content */}
                <div>
                  <h3 className="text-white font-extrabold text-xl sm:text-2xl mb-3">{step.title}</h3>
                  <p className="text-white/50 text-base leading-relaxed mb-4">{step.detail}</p>

                  {step.bullets && (
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                      {step.bullets.map(b => (
                        <li key={b.text} className="flex items-start gap-2 text-white/45 text-sm">
                          <span className="text-teal-400 flex-shrink-0 mt-0.5">{b.icon}</span>
                          {b.text}
                        </li>
                      ))}
                    </ul>
                  )}

                  {step.extras && (
                    <div className="mb-4">
                      <p className="text-white/30 text-xs mb-2">{step.extrasLabel}</p>
                      <div className="flex flex-wrap gap-2">
                        {step.extras.map(e => (
                          <span key={e.label}
                            className={`flex items-center gap-1.5 ${e.color} bg-white/[0.05]
                                        border border-white/10 px-3 py-1.5 rounded-full text-xs font-medium`}>
                            {e.icon}{e.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {step.tip && (
                    <div className="inline-flex items-start gap-2 bg-teal-500/8 border border-teal-500/20
                                    rounded-xl px-4 py-3 text-teal-300/80 text-sm">
                      <span className="flex-shrink-0 font-bold">💡</span>
                      <span>{step.tip}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature highlights ── */}
      <section className="relative py-20 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">Features</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
              Everything you&apos;d expect. A few things you won&apos;t.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: '✈', title: 'Real confirmed bookings', desc: 'Not links. Not referrals. Actual Duffel flight orders and LiteAPI hotel reservations with real booking references.' },
              { icon: '🏨', title: 'Live hotel rates', desc: 'Hotel prices are fetched in real-time when you search — not cached. You see the actual rate available at that moment.' },
              { icon: '🗺', title: 'Destination guides', desc: 'Every search includes a Gemini-generated guide: best time to visit, visa info, currency tips, neighbourhood breakdown.' },
              { icon: '💡', title: 'Price intelligence', desc: 'Grok gives you market context — is this flight price high for the season? Will hotels be more expensive during the festival?' },
              { icon: '📱', title: 'Works great on mobile', desc: 'Fully responsive for iPhone and Android. Font sizes prevent iOS zoom, safe area insets handle notches. 44px tap targets everywhere.' },
              { icon: '🧳', title: 'Itinerary sidebar', desc: 'Drag-and-drop day planner builds as you chat. Add activities by category, see your flight and hotel tiles at a glance.' },
              { icon: '💳', title: 'Flat $20 service fee', desc: 'One flat fee per booking. No per-passenger charges, no OTA markup on prices. The flight and hotel cost exactly what Duffel and LiteAPI charge.' },
              { icon: '🔒', title: 'Payments via Stripe', desc: 'PCI-compliant Stripe Payment Element. Your card details never touch FlexeTravels servers — handled entirely by Stripe.' },
              { icon: '🌐', title: 'Multi-model AI', desc: 'Claude orchestrates, Grok adds price context, Gemini writes destination guides. Three specialized models in one conversation.' },
            ].map(f => (
              <div key={f.title}
                className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5
                           hover:bg-white/[0.05] hover:border-white/[0.12] transition-all duration-300">
                <div className="text-2xl mb-3">{f.icon}</div>
                <h3 className="text-white font-bold text-sm mb-1.5">{f.title}</h3>
                <p className="text-white/45 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="relative py-20 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">FAQ</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
              Common questions.
            </h2>
          </div>

          <div className="space-y-3">
            <FAQ
              q="Is FlexeTravels actually booking real flights and hotels?"
              a="Yes. Flights are booked through Duffel, an IATA-accredited airline distribution platform — the same infrastructure used by Kayak, Kiwi, and other major booking platforms. Hotels are booked through LiteAPI with live rates. You receive real booking references, not links to other sites."
            />
            <FAQ
              q="What destinations can I book?"
              a="Any destination served by Duffel's airline network (200+ airlines globally) and LiteAPI's hotel inventory (1M+ properties). The AI is especially well-optimised for departures from major Canadian airports (Toronto, Vancouver, Montreal) — where Duffel's inventory is confirmed deep."
            />
            <FAQ
              q="What does the $20 service fee cover?"
              a="It covers FlexeTravels' service — the AI searching, the integration work, and the booking processing. It's flat per booking (not per passenger), and covers both your flight and hotel if booked together. The flight and hotel themselves are charged at the rate Duffel and LiteAPI return — no markup."
            />
            <FAQ
              q="How secure is my payment information?"
              a="Payments are processed entirely by Stripe via their Payment Element — a PCI-compliant embedded form. Your card details are encrypted and handled by Stripe's servers; they never pass through FlexeTravels infrastructure. We receive a PaymentIntent confirmation but never your card number."
            />
            <FAQ
              q="What if I don't need a flight — just a hotel?"
              a="Just tell the AI. Say 'I've already booked my flights, I just need a hotel in Bali from March 5–12 for 2 adults.' The AI will skip the flight step and go straight to hotel search and booking."
            />
            <FAQ
              q="What if something goes wrong with the booking?"
              a="Our booking flow is built with multiple safeguards: placeholder ID detection, Stripe payment verification before any API call, and Duffel/LiteAPI token validation. If a booking fails after payment, we surface the error clearly and do not charge for failed bookings. For post-booking issues, contact support with your booking reference."
            />
            <FAQ
              q="Can I book for a family with children?"
              a="Yes. Just mention the ages of your children in the chat (e.g., 'we have two kids aged 6 and 9'). The AI captures this before searching so child fare eligibility is handled correctly at booking time."
            />
            <FAQ
              q="Do I need an account to book?"
              a="No account is required to search or book. Your booking confirmation is shown in the chat immediately after payment and booking. We recommend saving your booking references as they appear."
            />
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative py-24 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-3xl mx-auto text-center">
          <div className="relative rounded-3xl overflow-hidden border border-teal-500/20
                          bg-gradient-to-br from-teal-600/20 via-[#0d1f2e] to-[#070b12]
                          p-10 sm:p-14">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-60 h-60
                            rounded-full bg-teal-500/15 blur-[80px] pointer-events-none" />
            <div className="relative">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4">
                Seen enough? Let&apos;s go.
              </h2>
              <p className="text-white/45 mb-8 leading-relaxed">
                No account needed. Describe any trip. See real flights and hotels in seconds.
                Book with Stripe in minutes.
              </p>
              <Link href="/chat"
                className="inline-flex items-center gap-3 px-10 py-4 rounded-2xl font-bold text-lg
                           bg-gradient-to-r from-teal-500 to-cyan-500 text-white
                           shadow-[0_8px_40px_rgba(13,148,136,0.45)]
                           hover:shadow-[0_20px_64px_rgba(13,148,136,0.6)]
                           hover:from-teal-400 hover:to-cyan-400
                           transition-all duration-300 hover:-translate-y-1 touch-manipulation">
                <Sparkles className="w-5 h-5" />
                Start planning — it&apos;s free
                <ArrowRight className="w-5 h-5" />
              </Link>
              <p className="mt-5 text-white/22 text-xs">
                No account needed · Free to search · $20 flat fee when you book
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
            {[{href:'/about',label:'About'},{href:'/partners',label:'Partners'},{href:'/chat',label:'Start Planning'}].map(l => (
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
