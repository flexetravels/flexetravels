// ─── FlexeTravels — Privacy Policy Page ────────────────────────────────────
// Server component — follows the design system of the About page

import Link from 'next/link';
import { ArrowLeft, Plane } from 'lucide-react';
import { Nav } from '@/components/Nav';

export const metadata = {
  title: 'Privacy Policy — FlexeTravels',
  description: 'How FlexeTravels protects and uses your personal information.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#070b12] text-white overflow-x-hidden">
      <Nav />

      {/* ── Hero ── */}
      <section className="relative pt-20 pb-12 px-5 sm:px-8">
        {/* Ambient glow */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute -top-40 left-1/4 w-[600px] h-[600px] rounded-full bg-teal-700/10 blur-[130px]" />
          <div className="absolute top-1/2 right-0 w-[400px] h-[400px] rounded-full bg-cyan-600/8 blur-[100px]" />
        </div>

        <div className="relative max-w-4xl mx-auto">
          <Link href="/chat"
            className="inline-flex items-center gap-2 text-white/40 hover:text-white/70
                       transition-colors mb-8 text-sm">
            <ArrowLeft className="w-4 h-4" />
            Back to chat
          </Link>

          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            Privacy Policy
          </h1>
          <p className="text-white/50 text-lg">
            Last updated: April 2026
          </p>
        </div>
      </section>

      {/* ── Content ── */}
      <section className="relative py-16 px-5 sm:px-8">
        <div className="max-w-3xl mx-auto space-y-12">

          {/* Introduction */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Your Privacy Matters
            </h2>
            <p className="text-white/60 leading-relaxed mb-4">
              At FlexeTravels, we are committed to protecting your privacy. This privacy policy explains
              what personal information we collect, how we use it, and your rights regarding your data.
            </p>
            <p className="text-white/60 leading-relaxed">
              Please read this policy carefully. If you have any questions, contact us at{' '}
              <span className="text-teal-400">support@flexetravels.com</span>.
            </p>
          </div>

          {/* What We Collect */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              What Information We Collect
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <div>
                <h3 className="text-teal-400 font-semibold mb-2">Personal Information</h3>
                <p>
                  When you use FlexeTravels, we collect information necessary to complete your travel bookings:
                </p>
                <ul className="list-disc list-inside mt-2 space-y-1 ml-2">
                  <li>Full name and date of birth</li>
                  <li>Email address and phone number</li>
                  <li>Passport information (for international flights)</li>
                  <li>Travel preferences and destination interests</li>
                </ul>
              </div>

              <div>
                <h3 className="text-teal-400 font-semibold mb-2">Payment Information</h3>
                <p>
                  Payment information (credit card details) is collected and processed by Stripe, our
                  PCI-DSS compliant payment processor. We do not store full credit card numbers on our servers.
                </p>
              </div>

              <div>
                <h3 className="text-teal-400 font-semibold mb-2">Automatically Collected Information</h3>
                <p>
                  We automatically collect certain information when you use our service:
                </p>
                <ul className="list-disc list-inside mt-2 space-y-1 ml-2">
                  <li>Device type and browser information</li>
                  <li>IP address and location data</li>
                  <li>Search history and booking activity</li>
                  <li>Chat interactions and preferences</li>
                </ul>
              </div>
            </div>
          </div>

          {/* How We Use Your Information */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              How We Use Your Information
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                We use your information for the following purposes:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li><span className="text-white">Booking Processing:</span> Sending your details to Duffel (for flights) and LiteAPI (for hotels) to complete your reservations</li>
                <li><span className="text-white">Payment Processing:</span> Processing the $20 service fee through Stripe</li>
                <li><span className="text-white">Confirmation & Updates:</span> Sending booking confirmations, flight status updates, and hotel check-in information</li>
                <li><span className="text-white">Customer Support:</span> Responding to your inquiries and resolving issues</li>
                <li><span className="text-white">Service Improvement:</span> Analyzing search trends and booking patterns to improve our AI recommendations</li>
                <li><span className="text-white">Legal Compliance:</span> Meeting regulatory requirements and preventing fraud</li>
              </ul>
            </div>
          </div>

          {/* Who We Share Your Data With */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Who We Share Your Data With
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                To complete your bookings, we share your information with trusted third-party service providers:
              </p>

              <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6 space-y-4">
                <div>
                  <h3 className="text-teal-400 font-semibold mb-1">Duffel</h3>
                  <p className="text-sm">
                    Your name, date of birth, email, phone, and passport information for flight order creation.
                  </p>
                </div>
                <div className="border-t border-white/[0.07]" />
                <div>
                  <h3 className="text-teal-400 font-semibold mb-1">LiteAPI</h3>
                  <p className="text-sm">
                    Your name, email, and booking dates for hotel search and reservation.
                  </p>
                </div>
                <div className="border-t border-white/[0.07]" />
                <div>
                  <h3 className="text-teal-400 font-semibold mb-1">Stripe</h3>
                  <p className="text-sm">
                    Card details and billing address for payment processing. We do not handle these directly.
                  </p>
                </div>
                <div className="border-t border-white/[0.07]" />
                <div>
                  <h3 className="text-teal-400 font-semibold mb-1">Anthropic</h3>
                  <p className="text-sm">
                    The natural-language messages you send to our AI concierge are processed by
                    Anthropic to generate trip suggestions. Anthropic does not retain your messages
                    for model training. Avoid sharing sensitive identifiers (passport, card numbers)
                    in chat — use the secure checkout form for that.
                  </p>
                </div>
                <div className="border-t border-white/[0.07]" />
                <div>
                  <h3 className="text-teal-400 font-semibold mb-1">Supabase</h3>
                  <p className="text-sm">
                    Account credentials, session tokens, and your saved trip canvases (cities, dates,
                    chosen flights/hotels) are stored on Supabase&apos;s managed Postgres in a Canadian
                    or US region, encrypted in transit and at rest.
                  </p>
                </div>
              </div>

              <p className="text-sm">
                We do not sell or rent your personal information to any third parties for marketing purposes.
              </p>
            </div>
          </div>

          {/* Data Retention */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Data Retention
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                We retain your personal information for as long as necessary to provide our services and
                comply with legal obligations:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li><span className="text-white">Booking Records:</span> Retained for 7 years for legal and tax compliance</li>
                <li><span className="text-white">Payment Records:</span> Retained as required by financial regulations and your payment provider</li>
                <li><span className="text-white">Chat History:</span> Retained for 12 months unless you request deletion</li>
                <li><span className="text-white">Account Data:</span> Deleted within 30 days of account closure request</li>
              </ul>
            </div>
          </div>

          {/* Your Privacy Rights */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Your Privacy Rights
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                You have the following rights regarding your personal information:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li><span className="text-white">Right to Access:</span> Request a copy of all personal data we hold about you</li>
                <li><span className="text-white">Right to Correction:</span> Request that we correct any inaccurate information</li>
                <li><span className="text-white">Right to Deletion:</span> Request deletion of your personal data (subject to legal retention requirements)</li>
                <li><span className="text-white">Right to Portability:</span> Request your data in a machine-readable format</li>
                <li><span className="text-white">Right to Object:</span> Opt out of marketing communications</li>
                <li><span className="text-white">Right to Withdraw Consent:</span> Withdraw consent for data processing at any time</li>
              </ul>
              <p className="mt-6 pt-6 border-t border-white/[0.07]">
                To exercise any of these rights, contact us at{' '}
                <span className="text-teal-400">support@flexetravels.com</span> with "Privacy Request" in the subject line.
              </p>
            </div>
          </div>

          {/* Regional Compliance */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Regional Privacy Laws
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <div>
                <h3 className="text-teal-400 font-semibold mb-2">Canada (PIPEDA)</h3>
                <p>
                  If you are a Canadian resident, your data is protected under the Personal Information
                  Protection and Electronic Documents Act (PIPEDA). You have the right to access, correct,
                  and request deletion of your personal information.
                </p>
              </div>

              <div>
                <h3 className="text-teal-400 font-semibold mb-2">California (CCPA)</h3>
                <p>
                  If you are a California resident, you have additional rights under the California Consumer
                  Privacy Act (CCPA), including the right to know what data we collect, the right to delete
                  personal information, and the right to opt out of the sale or sharing of your data.
                  FlexeTravels does not sell your data.
                </p>
              </div>

              <div>
                <h3 className="text-teal-400 font-semibold mb-2">European Union (GDPR)</h3>
                <p>
                  If you are an EU resident, your data is protected under the General Data Protection
                  Regulation (GDPR). You have the same rights listed above, plus additional protections
                  regarding data transfers and processing.
                </p>
              </div>
            </div>
          </div>

          {/* Security */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Data Security
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                We implement industry-standard security measures to protect your personal information:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>Encryption of data in transit (TLS/SSL)</li>
                <li>Secure storage of sensitive information</li>
                <li>Regular security audits and vulnerability assessments</li>
                <li>Limited access to personal data (employee and contractor restriction)</li>
                <li>PCI-DSS compliance for payment processing</li>
              </ul>
              <p className="mt-4">
                While we take security seriously, no system is completely immune to breaches. If a security
                incident occurs, we will notify you promptly as required by law.
              </p>
            </div>
          </div>

          {/* Cookies & Tracking */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Cookies & Tracking
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                We use cookies and similar tracking technologies to:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>Keep you logged in and remember your preferences</li>
                <li>Analyze how you use FlexeTravels (via anonymized analytics)</li>
                <li>Prevent fraud and improve security</li>
              </ul>
              <p className="mt-4">
                You can control cookie settings in your browser. Disabling cookies may affect your ability
                to use certain features of the service.
              </p>
            </div>
          </div>

          {/* Changes to This Policy */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Changes to This Privacy Policy
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                We may update this privacy policy from time to time to reflect changes in our practices,
                technology, or legal requirements. We will notify you of material changes by posting the
                updated policy on this page and updating the "Last updated" date.
              </p>
              <p>
                Your continued use of FlexeTravels after such modifications constitutes your acceptance
                of the updated privacy policy.
              </p>
            </div>
          </div>

          {/* Contact */}
          <div className="bg-teal-500/10 border border-teal-500/25 rounded-2xl p-8">
            <h2 className="text-2xl font-bold text-white mb-4">
              Have Privacy Questions?
            </h2>
            <p className="text-white/60 leading-relaxed mb-4">
              If you have any questions about this privacy policy or how we handle your personal information,
              please contact us:
            </p>
            <div className="space-y-2 text-white/70">
              <p><span className="text-teal-400 font-semibold">Email:</span> support@flexetravels.com</p>
              <p><span className="text-teal-400 font-semibold">Subject Line:</span> Privacy Inquiry</p>
              <p className="text-sm mt-4">
                We aim to respond to all privacy requests within 10 business days.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.05] py-8 px-5 sm:px-8 mt-20">
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
              {href:'/privacy',label:'Privacy'},
              {href:'/terms',label:'Terms'},
              {href:'/contact',label:'Contact'},
              {href:'/chat',label:'Start Planning'}
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
