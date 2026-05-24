// ─── FlexeTravels — Terms of Service Page ──────────────────────────────────
// Server component — follows the design system of the About page

import Link from 'next/link';
import { ArrowLeft, Plane } from 'lucide-react';
import { Nav } from '@/components/Nav';

export const metadata = {
  title: 'Terms of Service — FlexeTravels',
  description: 'Terms and conditions for using FlexeTravels travel booking platform.',
};

export default function TermsPage() {
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
          <Link href="/#search"
            className="inline-flex items-center gap-2 text-white/40 hover:text-white/70
                       transition-colors mb-8 text-sm">
            <ArrowLeft className="w-4 h-4" />
            Back to search
          </Link>

          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            Terms of Service
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
              Terms & Conditions
            </h2>
            <p className="text-white/60 leading-relaxed mb-4">
              By using FlexeTravels, you agree to these terms and conditions. If you do not agree, please
              do not use our service. FlexeTravels reserves the right to modify these terms at any time.
            </p>
            <p className="text-white/60 leading-relaxed">
              Questions? Contact{' '}
              <span className="text-teal-400">support@flexetravels.com</span>.
            </p>
          </div>

          {/* Service Description */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              What FlexeTravels Is
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                FlexeTravels is a technology platform that facilitates the booking of flights and hotel
                accommodations through API connections with third-party providers (Duffel for flights,
                LiteAPI for hotels). We are not a licensed travel agent, airline, or hotel operator.
              </p>
              <p>
                We provide a conversational interface powered by AI to help you discover and book travel
                arrangements. The actual bookings are made through our partner providers, and the specific
                terms and conditions of those providers apply to your bookings.
              </p>
            </div>
          </div>

          {/* Service Fee */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Service Fee
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                FlexeTravels charges a flat service fee of <span className="text-white font-semibold">$20 USD</span> per completed
                booking (flight + hotel combination). This fee is:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li><span className="text-white">Non-refundable</span> regardless of whether you complete the booking</li>
                <li>Charged only after you authorize payment via Stripe</li>
                <li>Separate from airline and hotel charges</li>
                <li>Due before the booking is confirmed with the provider</li>
              </ul>
              <p className="mt-4 pt-4 border-t border-white/[0.07]">
                The service fee covers access to the AI chat, booking coordination, and customer support.
              </p>
            </div>
          </div>

          {/* Flight Bookings */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Flight Bookings
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                All flight bookings are processed through <span className="text-white font-semibold">Duffel</span>, an IATA-accredited
                airline distribution system. By booking a flight, you agree that:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>Your booking is subject to the airline&apos;s terms and conditions</li>
                <li>Cancellation, refund, and change policies are set by the airline, not FlexeTravels</li>
                <li>You are responsible for meeting all passport and visa requirements</li>
                <li>Check-in deadlines, baggage allowances, and seat selection are governed by the airline</li>
                <li>Disputes regarding flights must be directed to the airline first, not FlexeTravels</li>
              </ul>
              <div className="mt-6 pt-6 border-t border-white/[0.07]">
                <h3 className="text-teal-400 font-semibold mb-2">24-Hour Cancellation Rights</h3>
                <p>
                  Under US DOT Rule 14 CFR 259.5, if you book a flight departing from or arriving at a US
                  airport, you have the right to cancel your flight booking and receive a refund within
                  24 hours of purchase, provided the flight departs more than 7 days away.
                </p>
              </div>
            </div>
          </div>

          {/* Hotel Bookings */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Hotel Bookings
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                All hotel bookings are processed through <span className="text-white font-semibold">LiteAPI</span>, a global hotel
                distribution platform. By booking a hotel, you agree that:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>Your booking is subject to the hotel&apos;s cancellation policy as shown at checkout</li>
                <li>Rates displayed are accurate at the time of search but may change without notice</li>
                <li>Occupancy restrictions and minimum stay requirements apply</li>
                <li>Any special requests (late arrival, high floor, etc.) are noted but not guaranteed</li>
                <li>Hotel policies regarding check-in times, ID verification, and incidentals are binding</li>
              </ul>
              <p className="mt-4 pt-4 border-t border-white/[0.07]">
                You will receive a confirmation email with the hotel&apos;s direct contact information and cancellation
                policy details. Changes and cancellations must be requested directly from the hotel or through
                the confirmation email provided.
              </p>
            </div>
          </div>

          {/* Limitation of Liability */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Limitation of Liability
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                To the fullest extent permitted by law, FlexeTravels is not liable for:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>Airline cancellations, delays, or missed flights</li>
                <li>Hotel availability or accuracy of property information</li>
                <li>Pricing errors or rate changes made by providers</li>
                <li>Consequences of incorrect passenger information provided by you</li>
                <li>Loss of luggage, personal injury, or property damage</li>
                <li>Visa denials or immigration issues</li>
                <li>Service interruptions or data loss due to technical failures</li>
              </ul>
              <p className="mt-4 pt-4 border-t border-white/[0.07]">
                FlexeTravels&apos; maximum liability is limited to the $20 service fee paid, except where prohibited
                by law. We are not responsible for any indirect, incidental, or consequential damages.
              </p>
            </div>
          </div>

          {/* Dispute Resolution */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Dispute Resolution
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                If you have a dispute with FlexeTravels:
              </p>
              <ol className="list-decimal list-inside space-y-2 ml-2">
                <li>Contact <span className="text-white font-semibold">support@flexetravels.com</span> with a detailed description</li>
                <li>We will investigate and respond within 5 business days</li>
                <li>If unresolved, disputes may be escalated to arbitration (see below)</li>
              </ol>

              <div className="mt-6 pt-6 border-t border-white/[0.07]">
                <h3 className="text-teal-400 font-semibold mb-2">Binding Arbitration</h3>
                <p>
                  Any dispute arising out of or relating to these terms shall be resolved by binding arbitration
                  rather than in court. You and FlexeTravels agree to submit to the rules of American Arbitration
                  Association (AAA) for resolution.
                </p>
              </div>
            </div>
          </div>

          {/* Government Complaints */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Government Complaint Channels
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                If you are unable to resolve a dispute with FlexeTravels and wish to file a formal complaint:
              </p>

              <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6 space-y-4">
                <div>
                  <h3 className="text-teal-400 font-semibold mb-1">US DOT Complaints (Flight Issues)</h3>
                  <p className="text-sm">
                    For issues related to air transportation, you may file a complaint with the US Department of
                    Transportation:
                  </p>
                  <p className="text-teal-300 font-mono text-sm mt-2">
                    Phone: 1-202-366-2220
                  </p>
                  <p className="text-sm mt-2">
                    Or online at: <span className="text-teal-400">safetravel.transportation.gov</span>
                  </p>
                </div>

                <div className="border-t border-white/[0.07]" />

                <div>
                  <h3 className="text-teal-400 font-semibold mb-1">Canada (APPR)</h3>
                  <p className="text-sm">
                    If your flight departs from or arrives at a Canadian airport, you may have rights under
                    the Air Passenger Protection Regulations (APPR). Contact the Canadian Transportation Agency
                    for more information.
                  </p>
                </div>

                <div className="border-t border-white/[0.07]" />

                <div>
                  <h3 className="text-teal-400 font-semibold mb-1">General Consumer Protection</h3>
                  <p className="text-sm">
                    Contact your local consumer protection agency or attorney general for other consumer disputes.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* User Responsibilities */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Your Responsibilities
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                You agree to:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>Provide accurate, complete, and truthful information for all bookings</li>
                <li>Verify all booking details before authorizing payment</li>
                <li>Review airline and hotel policies before confirming your booking</li>
                <li>Ensure you meet all travel requirements (passport validity, visas, vaccinations)</li>
                <li>Comply with all laws and regulations of countries you visit</li>
                <li>Not use FlexeTravels for illegal bookings or fraudulent activity</li>
                <li>Respect intellectual property rights of FlexeTravels and our partners</li>
              </ul>
            </div>
          </div>

          {/* Prohibited Use */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Prohibited Use
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                You may not:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>Use FlexeTravels to book on behalf of others without authorization</li>
                <li>Attempt to scrape, automate, or reverse-engineer our platform</li>
                <li>Interfere with the normal operation of FlexeTravels or its systems</li>
                <li>Use false or misleading information to obtain bookings</li>
                <li>Violate any applicable laws or third-party rights</li>
                <li>Harass or abuse our customer support team</li>
              </ul>
              <p className="mt-4 pt-4 border-t border-white/[0.07]">
                Violation of these terms may result in account suspension or termination without refund.
              </p>
            </div>
          </div>

          {/* Payment Terms */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Payment Terms
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <ul className="list-disc list-inside space-y-2 ml-2">
                <li>Payment is processed via Stripe, our PCI-compliant payment processor</li>
                <li>The $20 service fee is charged in USD and will be converted to your local currency if applicable</li>
                <li>Payment is non-refundable once authorization is given</li>
                <li>You authorize FlexeTravels to charge the payment method you provide</li>
                <li>If payment fails, your booking will not be confirmed</li>
                <li>We reserve the right to cancel bookings for fraudulent or suspicious transactions</li>
              </ul>
            </div>
          </div>

          {/* Governing Law */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Governing Law
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                These terms are governed by the laws of the Province of British Columbia, Canada, without regard
                to its conflict of law provisions. You consent to the exclusive jurisdiction of the courts located
                in British Columbia for the resolution of disputes, except as otherwise required by law.
              </p>
            </div>
          </div>

          {/* Changes to Terms */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Changes to These Terms
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                FlexeTravels reserves the right to modify these terms at any time. Changes will be effective
                immediately upon posting to this page. Your continued use of the service after such modifications
                constitutes your acceptance of the updated terms. We encourage you to review these terms periodically.
              </p>
            </div>
          </div>

          {/* Severability */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Severability
            </h2>
            <div className="space-y-4 text-white/60 leading-relaxed">
              <p>
                If any provision of these terms is found to be invalid or unenforceable, that provision will be
                severed, and the remaining provisions will continue in full force and effect.
              </p>
            </div>
          </div>

          {/* Contact */}
          <div className="bg-teal-500/10 border border-teal-500/25 rounded-2xl p-8">
            <h2 className="text-2xl font-bold text-white mb-4">
              Questions About These Terms?
            </h2>
            <p className="text-white/60 leading-relaxed mb-4">
              If you have any questions about these terms of service, please contact us:
            </p>
            <div className="space-y-2 text-white/70">
              <p><span className="text-teal-400 font-semibold">Email:</span> support@flexetravels.com</p>
              <p><span className="text-teal-400 font-semibold">Subject Line:</span> Terms Inquiry</p>
              <p className="text-sm mt-4">
                We aim to respond to all inquiries within 2 business days.
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
