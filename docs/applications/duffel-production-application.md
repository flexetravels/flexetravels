# Duffel Production Access — Application Package
## FlexeTravels Inc. | British Columbia, Canada

---

## 1. EMAIL TO DUFFEL SUPPORT (Getting Production Access)

**To:** support@duffel.com
**Subject:** Production API Access Request — FlexeTravels (Online Travel Platform, BC, Canada)

---

Dear Duffel Team,

I'm writing to request activation of production (live) API access for **FlexeTravels**, an AI-powered travel booking platform based in British Columbia, Canada.

**About FlexeTravels**

FlexeTravels is an online travel agency that allows customers to search, compare, and book flights and hotels through a conversational AI interface. We are currently integrated with Duffel's API in test mode and have successfully completed end-to-end booking flows. We are ready to move to production.

**Technical Integration**

- We are using the Duffel Air API (REST v2) for flight search and booking
- Payment model: `type: "balance"` — we collect customer payments via Stripe and pre-fund our Duffel balance
- We have implemented offer expiry handling, passenger validation, and error recovery
- Our platform is built on Next.js (TypeScript), hosted on Vercel

**Regulatory Compliance (BC, Canada)**

We are in the process of obtaining our BC Travel Agent licence through Consumer Protection BC, which is required under the BC Travel Agents Act. As a Canadian entity selling travel services, we understand that:
- Duffel provides IATA accreditation coverage for platforms using their Content Services
- We maintain our own BC regulatory obligations independently

We would like to understand Duffel's KYC requirements for Canadian companies and whether there is a specific onboarding document checklist for our jurisdiction.

**Questions Before Activation**

1. What documents are required for KYC verification for a Canadian company?
2. Is there a minimum Duffel balance required to activate production access?
3. Do you recommend the Balance model or Duffel Payments API for our use case (Stripe as primary PSP)?
4. Is there a staging/review period before full production access is granted?

**Our Team**

[Your Name]
[Title]
FlexeTravels Inc.
[City, BC, Canada]
[Phone]
[Email]

Duffel Account: [your_account_email@flexetravels.com]

We look forward to your guidance and are happy to schedule a call to discuss our integration.

Warm regards,
[Your Name]

---

## 2. DUFFEL KYC DOCUMENTATION CHECKLIST

When Duffel requests documents for business verification (typical for Canadian companies):

### Corporate Identity
- [ ] Certificate of Incorporation (BC Registry or Corporations Canada)
- [ ] Articles of Incorporation
- [ ] Business Number (BN) from CRA
- [ ] BC company registration (if provincially incorporated)

### Directors / Beneficial Owners (>25% ownership)
- [ ] Full legal name, date of birth, nationality for each
- [ ] Government-issued photo ID (passport preferred)
- [ ] Residential address (utility bill or bank statement)

### Business Operations
- [ ] Business bank account details (Canadian bank)
- [ ] Website URL (flexetravels.com)
- [ ] Description of business model (how you sell travel)
- [ ] Estimated monthly booking volume (GMV)
- [ ] Primary markets served (Canada, USA)

### Regulatory
- [ ] Consumer Protection BC Travel Agent Licence (if issued)
  - If pending: include application confirmation / reference number
- [ ] Note that Duffel provides IATA coverage (no separate IATA cert needed)

---

## 3. DUFFEL PAYMENT FLOW (How Money Works)

### Current Setup (Balance Model)

```
Customer → [Stripe] → FlexeTravels Bank Account
                              ↓
                    FlexeTravels tops up Duffel Balance
                              ↓
                    Duffel debits Balance → pays Airline
                              ↓
                    FlexeTravels keeps $20 service fee + markup
```

**Key points:**
- Customer pays full flight cost + $20 service fee via Stripe
- FlexeTravels keeps $20 service fee
- Remaining flight cost is used to maintain Duffel balance
- Duffel reconciliation: your balance must always cover pending orders
- Recommended: maintain a buffer of at least 2× your expected daily booking volume

### Alternative: Duffel Payments API (Simpler for starting out)

```
Customer → [Duffel Payments API] → Airline (direct)
FlexeTravels collects $20 service fee separately via Stripe
```

**When to use:** If you don't want to manage cash flow / pre-funding.
**When to switch to Balance:** When booking volume is high enough to make pre-funding efficient.

### BC Intermediary Rules (You ARE allowed to do this)

Under BC law and CPBC licensing:
- You **can** collect customer funds and hold them briefly before payment to suppliers
- These funds must be deposited into a **designated travel trust account**
- Trust account must be with a BC savings institution
- Customer money cannot be commingled with operating funds
- You are acting as a licensed travel agent intermediary — this is legal

---

## 4. WHAT TO DO IMMEDIATELY (Test Balance Fix)

**Why Duffel bookings fail now (while hotel works):**

The current failure is almost certainly **insufficient Duffel test balance**.

LiteAPI hotel bookings use a hardcoded sandbox card — no balance needed.
Duffel uses `type: "balance"` which debits from your Duffel account balance.
If that balance is $0, every flight booking fails with `insufficient_balance`.

**Fix (takes 2 minutes):**
1. Go to [app.duffel.com](https://app.duffel.com)
2. Settings → Balance
3. Click **"Top up test balance"** → add $5,000 USD test balance (no real money)
4. Re-run your test booking

You can also verify via: `GET /api/admin/duffel-check` in the new admin panel.

---

## 5. DUFFEL TERMS TO REVIEW BEFORE GOING LIVE

- [Duffel Services Agreement](https://duffel.com/services-agreement)
- [Duffel Acceptable Use Policy](https://duffel.com/acceptable-use-policy)
- Key obligations:
  - Maintain accurate business information
  - No deceptive pricing or hidden fees
  - Clear refund and cancellation policies displayed to customers
  - Proper handling of passenger PII
  - You remain responsible for customer service
