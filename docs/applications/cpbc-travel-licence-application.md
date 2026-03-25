# BC Travel Agent Licence — Application Package
## FlexeTravels Inc. | Consumer Protection BC

---

## OVERVIEW

**Licensing Authority:** Consumer Protection BC (CPBC)
**Website:** consumerprotectionbc.ca
**Phone:** 1-888-777-4393
**Licence Type Required:** Travel Agent
**Annual Fee:** ~$1,293 (travel agent) — confirm current fees with CPBC
**Trust Account:** Mandatory (BC savings institution)

---

## 1. COVER LETTER TO CONSUMER PROTECTION BC

**To:** Travel Department, Consumer Protection BC
**Re:** New Travel Agent Licence Application — FlexeTravels Inc.

---

Dear Consumer Protection BC Travel Licensing Team,

We are writing to apply for a Travel Agent licence under the BC Travel Agents Act.

**Applicant:** FlexeTravels Inc.
**Business Address:** [Your BC address]
**Mailing Address:** [If different]
**Website:** https://flexetravels.com
**Business Phone:** [phone]
**Primary Contact:** [Name, Title, Email]

**Nature of Our Business**

FlexeTravels is an online travel agency offering AI-assisted flight and hotel booking services to consumers primarily in British Columbia and across Canada. Our platform allows customers to search and book air travel and hotel accommodations directly through a conversational interface on our website.

**Suppliers We Use**
- Flights: Duffel Technologies Ltd. (IATA-accredited consolidator/GDS aggregator, UK-based)
- Hotels: LiteAPI (global hotel rate aggregator)
- Payments: Stripe (payment processing for our $20 service fee)

**How We Collect and Handle Customer Funds**

Customers pay the full cost of their booking (flight or hotel) plus a $20 service fee through our website via Stripe. All customer funds are held in a designated travel trust account (details below) until the booking is confirmed with the supplier. We maintain separate accounting records per customer booking.

We understand and will comply with all obligations under the Travel Agents Act, including:
- Maintaining the required trust account with a BC savings institution
- Depositing all customer funds into the trust account promptly upon receipt
- Maintaining records as required
- Submitting annual financial statements within 90 days of our fiscal year end
- Providing customers with written confirmation of bookings and refund policies
- Renewing our licence annually

**Trust Account**

We have established (or will establish prior to licence activation) a designated travel trust account with [Bank Name], Branch [#]:
- Account Name: FlexeTravels Travel Trust Account
- Account Number: [to be completed]
- Institution: [Bank name, BC]

**Financial Security**

We will provide the required financial security in the form of [surety bond / letter of credit / GIC — choose one] in the amount specified by Consumer Protection BC.

We respectfully request guidance on the required security amount based on our projected first-year volume.

**Projected Volume (Year 1)**
- Estimated monthly transactions: [XX]
- Estimated average booking value: $[XXX]
- Projected annual gross booking value: $[XXX,XXX]

We are committed to full compliance with BC travel agent regulations and look forward to operating as a licensed travel agent in British Columbia.

Please do not hesitate to contact us with any questions or requests for additional documentation.

Sincerely,

[Your Full Name]
[Title] — FlexeTravels Inc.
[Email] | [Phone]
[BC Address]

---

## 2. REQUIRED DOCUMENTS CHECKLIST

### Business Entity
- [ ] Certificate of Incorporation (BC Registry Services or Corporations Canada)
- [ ] Articles of Incorporation or Memorandum of Incorporation
- [ ] BC Business Number (from BC Registry)
- [ ] Federal Business Number (CRA)
- [ ] GST/HST registration number

### Identity (Directors & Owners)
- [ ] Government-issued photo ID for each director
- [ ] List of all directors with full legal names and addresses
- [ ] Declaration of beneficial ownership (if applicable)
- [ ] Criminal record check for principal officers (CPBC may require this)

### Financial
- [ ] Opening balance sheet or financial projections for Year 1
- [ ] Bank confirmation of trust account opening
- [ ] Financial security instrument (surety bond, LC, or GIC) — amount set by CPBC
- [ ] Most recent financial statements (if existing business)

### Operations
- [ ] Website URL and description of booking flow
- [ ] Sample booking confirmation template (what customers receive)
- [ ] Refund/cancellation policy (must be visible to customers)
- [ ] Terms of Service / Privacy Policy URLs

### Supplier Relationships
- [ ] Confirmation of Duffel API access (screenshot or letter)
- [ ] Confirmation of LiteAPI access
- [ ] Copy of any reseller or agency agreements with suppliers

---

## 3. TRUST ACCOUNT — WHAT YOU NEED TO KNOW

**Why it's required:** All customer funds for travel purchases are deemed held in trust for the customer under BC law. The trust account prevents commingling with operating funds.

**Setup steps:**
1. Open a separate bank account labelled "FlexeTravels Travel Trust Account"
2. Use any BC-chartered bank or credit union
3. This account receives ALL customer payments for travel bookings
4. Only transfer from trust to operating when booking is fully confirmed and ticket/booking issued
5. Maintain a ledger showing each customer's funds held

**Practical implementation with Stripe:**
- Stripe collects customer payments to your regular business account
- You must immediately transfer the supplier cost portion to the trust account
- Keep the $20 service fee in your operating account (this is earned on booking)
- Only release trust funds when booking is confirmed

**Accounting required:**
- Separate bookkeeping for trust account
- Monthly reconciliation of trust balance to individual customer records
- Annual financial statements (prepared by CA/CPA) submitted to CPBC within 90 days of fiscal year-end

---

## 4. HOTEL BOOKINGS VIA LITEAPI — REGULATORY NOTE

**Question:** Do you need a separate licence for hotel bookings?

**Answer:** Hotel bookings made as part of a licensed travel agent's business are covered under your travel agent licence. Since you are also booking flights (requiring the licence), your hotel sales are an extension of the same travel agent function.

**Practical guidance:**
- No separate licence needed for hotel-only intermediary if you hold a travel agent licence
- Ensure hotel booking confirmation notices include cancellation policy (required for consumer protection)
- LiteAPI bookings: the cancellationPolicies field (RFN vs NRFN) must be disclosed to customers before purchase

---

## 5. LITEAPI PRODUCTION LICENCE EMAIL

**To:** support@liteapi.travel (or your account manager)
**Subject:** Production API Access Request — FlexeTravels (Canadian Online Travel Agency)

---

Dear LiteAPI Team,

I am writing to request activation of our LiteAPI account to production (live) mode.

**About FlexeTravels**

FlexeTravels is an AI-powered online travel agency based in British Columbia, Canada. We are integrated with LiteAPI v3.0 for hotel search and booking. We have successfully tested the full flow (search → prebook → book) using sandbox credentials and are ready for production.

**Integration Details**
- API Version: v3.0
- Endpoints used: `/data/hotels`, `/hotels/rates`, `/rates/prebook`, `/rates/book`
- Payment: In production, we will replace the sandbox test card with real cardholder data collected via our Stripe integration, or use your recommended payment method
- Platform: Next.js (TypeScript), hosted on Vercel
- Expected volume: [XX] hotel bookings/month to start, scaling to [XXX]/month

**Questions**
1. What is the recommended payment method for production hotel bookings? (Stripe tokenization, or do you have your own payment gateway integration?)
2. Are there any content or geographic restrictions on the production sandbox key vs. live key?
3. What is the SLA for production API availability?
4. Do you require a minimum monthly booking commitment?
5. What customer-facing branding/disclosure requirements apply (e.g., "Powered by LiteAPI")?

**Regulatory Status**
We are in the process of obtaining our BC Consumer Protection travel agent licence. We are happy to provide documentation of our regulatory status.

We look forward to completing the activation and are available for a call if helpful.

Best regards,
[Your Name]
[Title] — FlexeTravels Inc.
[Email] | [Phone]

---

## 6. IMPORTANT PAYMENT NOTE — BC SPECIFIC

Under BC regulations, you **can legally** operate as an intermediary that:
1. Collects full payment from customer via Stripe
2. Pays the hotel cost through LiteAPI's payment system
3. Retains your $20 service fee

**What you CANNOT do without a licence:** Collect customer travel funds without the CPBC licence and travel trust account. This is the non-negotiable compliance step.

**Timeline estimate:**
- CPBC licence processing: 4-8 weeks typically
- During this time: You can continue sandbox testing but should not process live customer payments for travel
- Once licensed: Full operations can begin

---

## 7. SUMMARY OF WHAT'S NEEDED TO GO LIVE

| Item | Owner | Status | Est. Time |
|------|-------|--------|-----------|
| Duffel test balance top-up | Dev | Do today | 5 min |
| Duffel KYC / production activation | Business | Apply now | 1-2 weeks |
| LiteAPI production key | Business | Apply now | 1-3 days |
| BC Travel Agent Licence (CPBC) | Business | Apply ASAP | 4-8 weeks |
| Travel Trust Account | Business | Open now | 1-3 days |
| Financial Security (bond/LC/GIC) | Business | With licence app | 1-2 weeks |
| Stripe production setup | Dev | Ready | Done |
| Admin panel logging | Dev | Done | Done |
| End-to-end smoke test (production) | Dev | After above | 1 day |
