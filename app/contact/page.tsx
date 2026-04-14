// ─── FlexeTravels — Contact Page ─────────────────────────────────────────────
// Dedicated contact/support page. Phone, email, address, and business hours.

import Link from 'next/link';
import { Plane, Phone, Mail, MapPin, Clock, MessageSquare, ArrowRight } from 'lucide-react';
import { Nav } from '@/components/Nav';

export const metadata = {
  title: 'Contact Us — FlexeTravels',
  description: 'Get in touch with FlexeTravels. Phone, email, and office address for support and inquiries.',
};

export default function ContactPage() {
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
          backgroundSize: '40px 40px',
        }} />

        <div className="relative max-w-4xl mx-auto text-center">
          <p className="text-teal-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">
            Get in touch
          </p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white leading-tight mb-6">
            We&apos;re here to help.
          </h1>
          <p className="text-white/50 text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed">
            Questions about a booking, need support, or just want to say hi —
            reach out and we&apos;ll get back to you quickly.
          </p>
        </div>
      </section>

      {/* ── Contact cards ── */}
      <section className="relative py-12 px-5 sm:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

            {/* Phone */}
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-7
                            hover:bg-white/[0.05] hover:border-white/[0.12] transition-all duration-300">
              <div className="w-12 h-12 rounded-2xl bg-teal-500/15 border border-teal-500/25
                              flex items-center justify-center mb-5">
                <Phone className="w-5 h-5 text-teal-400" />
              </div>
              <h2 className="text-white font-bold text-lg mb-1">Phone</h2>
              <p className="text-white/40 text-sm mb-4">
                Call us during business hours for immediate help.
              </p>
              <a
                href="tel:+17789016639"
                className="text-teal-400 font-semibold text-lg hover:text-teal-300 transition-colors"
              >
                +1 778-901-6639
              </a>
            </div>

            {/* Email */}
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-7
                            hover:bg-white/[0.05] hover:border-white/[0.12] transition-all duration-300">
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/25
                              flex items-center justify-center mb-5">
                <Mail className="w-5 h-5 text-cyan-400" />
              </div>
              <h2 className="text-white font-bold text-lg mb-1">Email</h2>
              <p className="text-white/40 text-sm mb-4">
                For booking inquiries, we reply within 1 business day.
              </p>
              <a
                href="mailto:sumanthumboli@gmail.com"
                className="text-cyan-400 font-semibold hover:text-cyan-300 transition-colors break-all"
              >
                sumanthumboli@gmail.com
              </a>
            </div>

            {/* Address */}
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-7
                            hover:bg-white/[0.05] hover:border-white/[0.12] transition-all duration-300">
              <div className="w-12 h-12 rounded-2xl bg-violet-500/15 border border-violet-500/25
                              flex items-center justify-center mb-5">
                <MapPin className="w-5 h-5 text-violet-400" />
              </div>
              <h2 className="text-white font-bold text-lg mb-1">Office</h2>
              <p className="text-white/40 text-sm mb-4">
                Registered BC travel agency.
              </p>
              <address className="not-italic text-white/70 text-sm leading-relaxed">
                280 Ross Drive, Unit 1506<br />
                New Westminster, BC V3L 0C2<br />
                Canada
              </address>
            </div>

            {/* Business hours */}
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-7
                            hover:bg-white/[0.05] hover:border-white/[0.12] transition-all duration-300">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/25
                              flex items-center justify-center mb-5">
                <Clock className="w-5 h-5 text-amber-400" />
              </div>
              <h2 className="text-white font-bold text-lg mb-1">Business Hours</h2>
              <p className="text-white/40 text-sm mb-4">
                All times Pacific (PT).
              </p>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-white/50">Monday – Friday</dt>
                  <dd className="text-white/80 font-medium">9 am – 6 pm</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-white/50">Saturday</dt>
                  <dd className="text-white/80 font-medium">10 am – 4 pm</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-white/50">Sunday</dt>
                  <dd className="text-white/50">Closed</dd>
                </div>
              </dl>
            </div>

          </div>
        </div>
      </section>

      {/* ── Start planning CTA ── */}
      <section className="relative py-20 px-5 sm:px-8 border-t border-white/[0.05]">
        <div className="max-w-3xl mx-auto">
          <div className="bg-gradient-to-br from-teal-500/10 to-cyan-500/10 border border-teal-500/20
                          rounded-3xl p-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-500
                            flex items-center justify-center mx-auto mb-6 shadow-lg shadow-teal-900/40">
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-3">
              Ready to book your trip?
            </h2>
            <p className="text-white/50 text-base mb-8 max-w-xl mx-auto">
              Chat with our AI travel concierge — it searches flights and hotels in real time
              and books everything in one conversation.
            </p>
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full font-bold text-sm
                         bg-gradient-to-r from-teal-500 to-cyan-500 text-white
                         shadow-lg shadow-teal-900/30 hover:shadow-teal-900/50
                         hover:from-teal-400 hover:to-cyan-400
                         transition-all duration-200 hover:-translate-y-px"
            >
              Start Planning
              <ArrowRight className="w-4 h-4" />
            </Link>
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
            {[
              { href: '/how-it-works', label: 'How It Works' },
              { href: '/about',        label: 'About'        },
              { href: '/contact',      label: 'Contact'      },
              { href: '/chat',         label: 'Start Planning' },
            ].map(l => (
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
