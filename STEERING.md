# FlexeTravels — Steering & Setup Guide

## Overview

FlexeTravels is an AI-powered travel agency platform that uses Claude AI and the Amadeus travel API to search for real-time flights, hotels, and experiences. The system is production-ready, scalable, and token-efficient with NO web search fallback—only Amadeus real data.

**Architecture (3-Tool Design):**
- **Frontend**: HTML/CSS/JS (responsive SPA) + Admin console
- **Backend**: FastAPI (Python) with Claude AI operator + 3 specialized Amadeus tools
- **AI Engine**: Claude via Anthropic API with tool-use for live searches (Claude IS the operator—no nested agents)
- **Tools**: `amadeus_flights_search`, `amadeus_hotels_search`, `amadeus_experiences_search`
- **Data Source**: Amadeus travel API only (real pricing, no mock data, no web fallback)

---

## 🆕 Recent Enhancements (March 2026)

### 1. **Dynamic Featured Tours System** ✅
- **Location-based personalization** using IP geolocation (ip-api.com)
- **Real-time tour generation** via Claude AI based on visitor origin
- **Unsplash integration** for high-quality destination images
- **Fallback curated photos** for 30+ destinations
- **Test mode support** via `?test_city=CityName` parameter for development
- **Endpoint**: `GET /api/featured-tours` with optional `?test_city` parameter

**Files Created**:
- `backend/tools/ip_geolocation.py` - IP detection + 80-city IATA mapping
- `backend/tools/unsplash_images.py` - Unsplash API with fallback photos
- `backend/tools/trending_destinations.py` - Amadeus analytics + Claude tour generation

### 2. **Weekly Marketing Automation** ✅
**OTA Marketing Workflow** - Generates professional marketing campaigns:
- **Tour Package**: AI-generated descriptions with pricing & highlights
- **4 Instagram Posts**: Clickbait-style captions with power words (min 100-220 chars)
- **Blog Draft**: SEO-optimized title + intro + CTA
- **Email Delivery**: HTML email with images, real destination photos
- **Image Integration**: Each post includes actual Unsplash destination photos
- **Analytics Tracking**: Records tour impressions to `impressions.jsonl`
- **Weekly Selection**: Picks most-featured destination for weekly campaign
- **Endpoint**: `POST /api/marketing/run-weekly`

**Files Created**:
- `backend/marketing/workflow.py` - 4-node workflow (generate → validate → log → send)
- `backend/marketing/email_sender.py` - SMTP email with HTML templates & images
- `backend/marketing/tour_analytics.py` - JSONL-based impression tracking

### 3. **Email Enhancement** ✅
**Rich HTML Email Templates with:**
- Hero destination image at top
- Package card with highlights
- 4 Instagram posts each with real images
- Blog draft with CTA
- Professional gradient headers & styling
- Image prompts for content creators (DALL-E/Midjourney)
- Clickable post cards with images
- Action checklist for marketing team

**SMTP Configuration**:
- Flexible SMTP support (Gmail, Neomail, any server)
- Configurable via environment variables
- TLS/SSL encryption support
- Neomail setup: `smtp0001.neo.space:587` with STARTTLS
- Successfully tested with Neomail SMTP

### 4. **Frontend Enhancements** ✅
**Console Logging**:
```javascript
🚀 Fetching featured tours
✅ Featured tours API response
📍 Updating location label
📦 Rendering dynamic tour cards
✅ Dynamic tours rendered successfully!
```

**Skeleton Loading**: 6 shimmer placeholder cards while loading tours

**Dynamic Rendering**: Tour cards replace skeletons with real data, images, and metadata

**Interactive Features**:
- Click tour → Opens chatbot with pre-filled tour message
- Save/favorite toggle (♡ ↔ ♥)
- Location label updates per visitor origin

### 5. **API Enhancements** ✅
**New Endpoints**:
- `GET /api/featured-tours` - Returns 6 personalized tours with images
- `GET /api/featured-tours?test_city=London` - Test different locations
- `POST /api/marketing/run-weekly` - Trigger weekly marketing workflow
- `GET /api/marketing/analytics` - View tour impressions (if implemented)

**CORS Configuration**:
- Configured for production domains
- Supports localhost development
- Allows multiple origins via environment variable

### 6. **Deployment Preparation** ✅
**Files Created**:
- `requirements.txt` - All Python dependencies
- `Procfile` - Heroku/Railway deployment config
- `railway.json` - Railway.app deployment spec
- `.gitignore` - Excludes .env, __pycache__, logs, etc.
- `DEPLOYMENT_GUIDE.md` - 8-step deployment guide
- `QUICK_DEPLOY.md` - 10-minute quick start
- `EMAIL_TROUBLESHOOTING.md` - Email debugging guide

**Deployment Stack**:
- **Backend**: Railway.app (Python/FastAPI)
- **Frontend**: Vercel (Static/HTML/JS)
- **Domain**: Namecheap (flexetravels.com)
- **Cost**: FREE for testing phase

---

### 7. **Live Deployment** ✅ *(March 2026)*

**Site is now live at https://flexetravels.com**

**Live URLs**:
- **Frontend**: https://flexetravels.com (Vercel)
- **Backend API**: https://flexetravels-production.up.railway.app (Railway)
- **GitHub**: https://github.com/flexetravels/flexetravels

**Deployment Steps Completed**:
1. Initialized git repository with 69 files committed
2. Pushed to GitHub (`flexetravels/flexetravels`, public repo)
3. Deployed backend to Railway.app → Status: **Online** ✅
4. Generated public Railway domain (`flexetravels-production.up.railway.app`)
5. Added all environment variables in Railway (API keys, SMTP config)
6. Deployed frontend to Vercel → Auto-deploys on every `git push` ✅
7. Added `flexetravels.com` domain in Vercel
8. Fixed DNS in Namecheap (see DNS Fix below)
9. Site confirmed working end-to-end ✅

**Bugs Fixed During Deployment**:

**Bug 1 — Railway build failure (requirements.txt)**
- **Error**: `Could not install packages due to an OSError: /AppleInternal/Library/BuildRoots/...`
- **Root cause**: `pip freeze` on macOS captured 4 Apple-internal packages with `file://` paths pointing to Mac build directories that don't exist on Railway's Linux servers (`altgraph`, `future`, `macholib`, `six`)
- **Fix**: Rewrote `requirements.txt` from scratch with only the ~30 packages actually used by the backend. Removed all unused libraries (langchain, google-generativeai, streamlit, supabase, pandas, etc.)

**Bug 2 — API_BASE scope error (tour cards stuck on skeleton)**
- **Error**: Tour cards showed skeleton loading but never populated
- **Root cause**: `fetchFeaturedTours()` was defined at the top level of `app.js`, but `API_BASE` was a `const` declared inside the `DOMContentLoaded` callback — a different scope. The function fell back to a hardcoded `http://localhost:8000` URL which fails in production.
- **Fix**: Moved `API_BASE` to global scope at the very top of `app.js` (line 7), removed the local declaration inside the callback, and updated `fetchFeaturedTours()` to use the global constant.

**Bug 3 — Railway internal URL used instead of public URL**
- **Error**: `API_BASE` was set to `flexetravels.railway.internal` — Railway's private network hostname, not reachable from browsers
- **Fix**: In Railway → Settings → Networking → clicked **Generate Domain** to get the public URL (`flexetravels-production.up.railway.app`)

**DNS Fix (Namecheap)**
- **Problem**: "Invalid Configuration" in Vercel — 4 conflicting A records plus a wrong CNAME for `www`
- **Records deleted**:
  - A @ `107.23.157.161` (old)
  - A @ `34.206.170.199` (old)
  - A @ `44.197.32.160` (old)
  - A @ `44.219.244.211` (old)
  - CNAME www → `flexetravels.com.` (pointed to itself — wrong)
- **Records kept**:
  - A @ `216.198.79.1` ← Vercel's IP
  - CNAME www → `b747e5f49e358475.vercel-dns-017.com.` ← Vercel verification
  - TXT records for Neomail SPF/DKIM (untouched)

### 8. **Interactive Cards + Dynamic Travel Styles** ✅ *(March 2026)*

**Every card on the site is now clickable and opens the chatbot with rich context.**

**Tour Cards (Featured Tours section)**:
- Click → chatbot opens with pre-filled message: tour name, destination, duration, price
- Chatbot asks follow-up questions: origin city, travel dates, number of travelers, budget
- "Plan This Trip →" CTA overlay appears on hover
- Save/favorite toggle (♡ ↔ ♥) on each card

**Destination Cards (Popular Destinations section)**:
- Click → chatbot opens with: "I want to explore [destination]! I'll be traveling from [user's city]."
- User's detected location included automatically for better context

**Travel Your Way Cards (Travel Styles section)**:
- **Now dynamic** — fetched from `/api/travel-styles` endpoint
- **Location-relevant destinations** per style (e.g., from Vancouver: Adventure → Banff, Costa Rica, Patagonia; from London: Adventure → Swiss Alps, Iceland, Norwegian Fjords)
- 7 supported regions: North America, Europe, Asia, Oceania, Middle East, Latin America, Africa
- Click → chatbot opens with style + suggested destinations + user's city
- Skeleton loading while API loads, same pattern as Featured Tours
- "Explore [Style] →" CTA overlay on hover

**New Backend Endpoint**:
- `GET /api/travel-styles` — Returns 6 travel styles with 3 destination suggestions each
- Region detection from user IP (same as featured-tours)
- Cached 24h per country code

**Files Created**:
- `backend/tools/travel_styles.py` — Region-based destination mapping for 6 styles × 7 regions

**Files Modified**:
- `app.js` — `fetchTravelStyles()`, `renderStyleCard()`, `openChatWithMessage()` bridge, improved card click handlers
- `index.html` — Travel Your Way section now uses skeleton loading
- `styles.css` — Tour card CTA overlay, style card destinations/CTA, skeleton styles
- `backend/main.py` — `/api/travel-styles` endpoint

### 9. **Duffel API Integration** ✅ *(March 2026 - In Progress)*

**Problem Identified & Fixed**:
- **Issue**: Hotels never appeared in chatbot even though flights worked perfectly
- **Root Cause**: Amadeus Hotel API has extremely limited test coverage (~7 cities: LAS, MIA, ATL, LON, DPS, DXB, SIN)
- **Impact**: Major cities (NYC, LAX, Paris, Tokyo, Bangkok, Sydney) returned 0 hotel results
- **Solution**: Parallel Duffel API integration with configurable API switching

**Non-Destructive Implementation**:
- All Amadeus tools remain intact and functional (zero breaking changes)
- Duffel tools created as separate modules (`duffel_flights.py`, `duffel_stays.py`)
- API selection via single environment variable: `ACTIVE_TRAVEL_API="amadeus"` or `ACTIVE_TRAVEL_API="duffel"`
- Easy rollback: Change one env var to restore Amadeus

**Duffel Advantages**:
- **Global Coverage**: Hotels available for all 100+ supported cities (vs Amadeus 7)
- **Modern API**: 4-step booking flow (Search → Fetch Rates → Create Quote → Book)
- **Better Integration**: Millions of properties via unified API
- **Same Format**: Results parsed into same JSON format as Amadeus (seamless for Claude)

**Duffel Limitations (Test Mode)**:
- Test airline only: "Duffel Airways" (code ZZ) with synthetic schedules
- Non-realistic flight times/prices (trades realism for consistency)
- Designed for testing the booking flow, not production flight data
- Production Duffel connects to real airlines

**Files Created**:
- `backend/tools/duffel_flights.py` (185 lines)
  - `DuffelFlightsTool` class with full flight search + parsing
  - Caches results 1 hour
  - Parses Duffel offer format into standard flight JSON

- `backend/tools/duffel_stays.py` (430 lines)
  - `DuffelStaysTool` class with 4-step booking flow
  - 100+ city code → latitude/longitude mapping
  - Global accommodation search support
  - Caches results 30 minutes

**Files Modified**:
- `backend/config.py`
  - Added `DUFFEL_API_KEY` environment variable
  - Added `HAS_DUFFEL` feature flag
  - Added `ACTIVE_TRAVEL_API` selector (defaults to "amadeus")
  - Updated status reporting to show active API

- `backend/.env`
  - Added `DUFFEL_API_KEY=` placeholder (user must add test key)
  - Added `ACTIVE_TRAVEL_API=amadeus` configuration

- `backend/main.py`
  - Rewrote `_get_chat_tools()` to return Duffel OR Amadeus tools based on config
  - Extended `_execute_chat_tool()` to route calls to Duffel tools when active
  - Conditional imports: Only loads active API tools to avoid unnecessary dependencies

**How to Switch APIs**:
```bash
# Test with Duffel (requires test API key from https://duffel.com/dashboard)
DUFFEL_API_KEY=duffel_test_abc123...
ACTIVE_TRAVEL_API=duffel

# Quick rollback to Amadeus
ACTIVE_TRAVEL_API=amadeus
```

**Testing Status** *(March 3, 2026 - TESTED & WORKING)*:
- ✅ Code compiles and imports correctly
- ✅ Configuration system working
- ✅ Tool routing logic implemented
- ✅ **DUFFEL FLIGHTS API - TESTED & CONFIRMED WORKING**
  - Chatbot returns real flight options with prices
  - Admin panel returns identical results
  - API version v2 (v1 deprecated since 2025-01-23)
  - Both round-trip and one-way flights supported
- ⚠️ Duffel Stays API - Not available in test mode (may require production account)

**End-to-End Test Results** *(March 3, 2026)*:
```
📱 Chatbot Test: LHR→JFK March 12-26
   Status: ✅ PASS
   Flights Found: 5+ options
   Price Range: $533-$900 USD

🔧 Admin Panel Test: Same route
   Status: ✅ PASS
   Flights Found: 10 options
   First Flight: $539.63 USD, 1 stop

✅ Results Match: Chatbot and admin panel return consistent data
```

**Production Deployment**:
- ✅ Ready for Railway deployment with Duffel API key
- ✅ Configuration: `ACTIVE_TRAVEL_API=duffel` (flights)
- ⚠️ Hotels use Amadeus (limited to ~7 cities) until Stays API available
- ✅ Full fallback to Amadeus available with 1 env var change

---

## System Architecture (Updated)

```
┌─────────────────────────────────────────────────────────────┐
│                    flexetravels.com                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Frontend (Vercel)          Backend (Railway.app)             │
│  Frontend (Vercel)          Backend (Railway.app)             │
│  ├─ index.html              ├─ FastAPI main.py               │
│  ├─ app.js                  ├─ /api/chat                     │
│  ├─ styles.css              ├─ /api/featured-tours           │
│  └─ admin.html              ├─ /api/travel-styles ⭐NEW     │
│                             ├─ /api/marketing/run-weekly     │
│                             ├─ /api/plan-trip                │
│                             ├─ /api/book-trip                │
│                             └─ tools/                        │
│                                ├─ amadeus_*.py               │
│                                ├─ ip_geolocation.py          │
│                                ├─ unsplash_images.py         │
│                                ├─ trending_destinations.py   │
│                                ├─ travel_styles.py ⭐NEW    │
│                                └─ ...                        │
│                                                               │
│  External APIs                 Marketing System ⭐NEW        │
│  ├─ Anthropic Claude API       ├─ workflow.py                │
│  ├─ Amadeus Travel API ⭐OP1   ├─ email_sender.py            │
│  ├─ Duffel Travel API ⭐OP2    ├─ tour_analytics.py          │
│  ├─ Unsplash Images API        └─ Neomail SMTP               │
│  ├─ ip-api.com (Free)                                        │
│  └─ SerpAPI (Fallback)         ⭐OP1/OP2 = Configurable API  │
│                                   Selector via              │
│                                   ACTIVE_TRAVEL_API         │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔄 Caching Strategy

| Component | TTL | Cache Type | Purpose |
|-----------|-----|-----------|---------|
| IP Geolocation | 24h | File-based | Avoid repeated IP lookups |
| Unsplash Images | 24h | File-based | Cache destination photos |
| Amadeus Analytics | 6h | File-based | Cache trending destinations |
| Amadeus Flights | 1h | File-based | Cache flight search results |
| Amadeus Hotels | 30m | File-based | Cache hotel search results |
| Duffel Flights | 1h | File-based | Cache Duffel flight results |
| Duffel Stays | 30m | File-based | Cache Duffel accommodation results |
| Claude Tours | 6h | File-based | Cache generated packages |
| Travel Styles | 24h | File-based | Cache style suggestions per country |
| SerpAPI | 1h | File-based | Cache fallback searches |

---

## 📊 Testing Checklist

### Local Testing
```bash
# Test dynamic tours with different cities
curl "http://localhost:8000/api/featured-tours?test_city=Bangkok"
curl "http://localhost:8000/api/featured-tours?test_city=Paris"
curl "http://localhost:8000/api/featured-tours?test_city=Tokyo"

# Test marketing workflow
cd backend
python3 -m marketing.workflow --destination "Singapore"

# Check generated content
cat output/2026-03-02_*_Singapore_run.json | python3 -m json.tool

# View social posts log
tail -50 logs/social_posts.log
```

### Browser Testing
1. Open http://localhost:3000
2. Press F12 (Developer Tools)
3. Go to Console tab
4. Should see logs:
   - 🚀 Fetching featured tours
   - ✅ Featured tours API response
   - 📍 Updating location label
   - 📦 Rendering tour cards
   - ✅ Dynamic tours rendered successfully

5. Verify tour cards display with images
6. Click a tour → Chat opens with pre-filled message

---

## Quick Start

### Prerequisites
- Python 3.9+
- API Keys in `.env`:
  - `ANTHROPIC_API_KEY` — Claude AI (required)
  - `AMADEUS_API_KEY` + `AMADEUS_API_SECRET` — Amadeus flights/hotels (required, OR)
  - `DUFFEL_API_KEY` — Duffel flights/stays (optional, alternative to Amadeus)
  - `STRIPE_SECRET_KEY` — payments (optional, mock fallback)
  - `SERPER_API_KEY` — web search fallback (optional)
- Configuration in `.env`:
  - `ACTIVE_TRAVEL_API=amadeus` — Use Amadeus (default, limited hotel coverage)
  - `ACTIVE_TRAVEL_API=duffel` — Use Duffel (global hotel coverage, requires DUFFEL_API_KEY)

### Installation

```bash
cd "FlexeTravels website/backend"
pip3 install -r requirements.txt
```

### Run

**Terminal 1 — Backend API**:
```bash
cd "FlexeTravels website/backend"
python3 main.py
# Runs on http://localhost:8000
```

**Terminal 2 — Frontend**:
```bash
cd "FlexeTravels website"
python3 -m http.server 3000
# Runs on http://localhost:3000
```

### Access

- **Main Website**: `http://localhost:3000`
- **Chat Widget**: Bottom-right corner of website (click chat bubble)
- **Admin Console**: `http://localhost:3000/admin.html`
  - Direct Amadeus search interface
  - View raw API responses
  - Test flights, hotels, full itineraries
  - Clear cache to force fresh searches

---

## How It Works

### Chat Flow (3-Tool Amadeus Search)

1. User sends a message: *"Flights from Vancouver to Las Vegas Feb 27 - Mar 5, 2 adults, $3000 budget"*
2. Claude extracts parameters:
   - Origin (YVR), Destination (LAS)
   - Dates (2026-02-27 to 2026-03-05)
   - Adults (2), Budget ($3000)
3. Claude calls **ALL 3 TOOLS** in parallel:
   - `amadeus_flights_search` → Returns 10 flights with live prices
   - `amadeus_hotels_search` → Returns hotels with nightly rates + check-in/check-out
   - `amadeus_experiences_search` → Returns activities with pricing
4. Claude presents combined results with budget breakdown:
   - Flights: 55% of budget ($1650)
   - Hotels: 35% of budget ($1050)
   - Experiences: 10% of budget ($300)
5. User can refine, ask for alternatives, or modify budget

### System Prompt Rules

The chat system prompt enforces:
- ✅ **NEVER use web search**—Amadeus only
- ✅ **No mock data**—return error JSON if API unavailable
- ✅ **Collect all params before searching** (origin, destination, dates, travelers, optional budget)
- ✅ **Call all 3 tools at once** (flights + hotels + experiences)
- ✅ **Filter results by budget** if provided
- ✅ **Honest error reporting** (e.g., "No hotels for CMH" or "Limited activities in test sandbox")
- ✅ **Suggest alternatives** only if API fails (different dates, routes)

### Admin Console Features

**Flights Tab**:
- Search by origin, destination, departure/return dates, # of adults
- Shows: airline, origin→destination, departure/arrival times, duration, stops, price per person
- Direct flight badge for nonstop flights
- Raw JSON toggle for API debugging
- **Example**: YVR→LAS shows WestJet $274.83/person in USD

**Hotels Tab**:
- Search by city code (LAS, PAR, LON, etc.—IATA city code only)
- Shows: hotel name, rating, check-in/check-out dates, price per night, location
- Best rate only (no duplicate offers)
- **Example**: Las Vegas shows 3-5 hotels with rates and full date range

**Full Itinerary Tab**:
- Combined flights + hotels + experiences (if available)
- Auto-calculates trip total and nightly breakdown
- Shows check-in/check-out dates with booking links
- All data directly from Amadeus (no web search)

---

## Amadeus Integration

### Test Sandbox vs Production

Currently: **Test Sandbox** (sample data, limited but consistent)
- Useful for development & testing without charges
- Prices in USD (normalized by new tools)
- Limited availability for certain routes/dates (e.g., CMH in Feb has 0 hotels)
- Flights generally available for major cities within 30 days
- Hotel data varies by city—LAS/PAR/LON have good coverage

Upgrade to Production:
1. Contact Amadeus sales for prod account
2. Update `AMADEUS_API_KEY` + `AMADEUS_API_SECRET` in `.env`
3. System automatically detects and switches
4. Same code works — just real prices + full availability now

### Currency Handling

**Current behavior:**
- All tools use `AMADEUS_CURRENCY=USD` from config
- Amadeus API call includes `currencyCode=USD` parameter
- Both admin console and chat display consistent USD prices
- Both chat and API return same prices (no mismatch)

**Example**:
- Chat shows: "$274.83/person USD" ✅
- Admin shows: "$274.83 USD" ✅
- (Previously showed EUR/310 due to missing currencyCode param—now fixed)

### Limited Results Issue

When Amadeus returns few/zero results:
1. It's real availability data (not a bug)
2. **NO web search fallback** — system reports honestly
3. Claude suggests:
   - Try different dates (Amadeus test sandbox has limited data)
   - Try different city codes (CMH is airport code, not city code for hotels)
   - Check admin console JSON to see actual Amadeus response
4. **Example failure scenarios**:
   - `CMH` (Columbus) hotel search → "No hotels found for city code: CMH" (test sandbox limitation)
   - `YVR→LAS` March 26-30 → May show fewer flights (test sandbox limited data for that period)
   - Solutions: Use Feb 27-Mar 5 instead, or upgrade to production Amadeus account

---

## 3-Tool Architecture Overview

Claude (in main.py) acts as the **operator**—it orchestrates the 3 specialized Amadeus tools:

### Tool 1: `amadeus_flights_search`
- **Location**: `backend/tools/amadeus_flights.py`
- **Method**: `AmadeusFlightsTool._run(origin, destination, departure_date, adults=1, return_date="", max_price=0, non_stop=False, travel_class="ECONOMY")`
- **Returns**: JSON with flights list (10 max), each with: offer_id, airline, origin, destination, departure/arrival times, duration_outbound, stops_outbound, price_total, price_per_person, currency
- **Caching**: 30 minutes (TTL=1800)
- **Example**: `amadeus_flights_search(origin='YVR', destination='LAS', departure_date='2026-02-27', adults=2)`

### Tool 2: `amadeus_hotels_search`
- **Location**: `backend/tools/amadeus_hotels.py`
- **Method**: `AmadeusHotelsTool._run(city_code, check_in_date, check_out_date, adults=1, rooms=1, max_price_per_night=0, min_star_rating=0)`
- **Two-step process**:
  1. Get hotel IDs by city (cached 24h)
  2. Get pricing for hotels (cached 30min)
- **Returns**: JSON with hotels list (20 max), each with: hotel_id, name, rating, offer_id, check_in_date, check_out_date, room_type, price_per_night, price_total, currency, number_of_nights
- **Example**: `amadeus_hotels_search(city_code='LAS', check_in_date='2026-02-27', check_out_date='2026-03-05', adults=2, rooms=1)`

### Tool 3: `amadeus_experiences_search`
- **Location**: `backend/tools/amadeus_experiences.py`
- **Method**: `AmadeusExperiencesTool._run(city_name, max_price_per_person=0, radius_km=20)`
- **Two-step process**:
  1. Get city coordinates (cached 7 days)
  2. Get activities by coordinates (cached 1 hour)
- **Returns**: JSON with experiences list (30 max), each with: id, name, description, rating, price_per_person, currency, duration, booking_link, location
- **Example**: `amadeus_experiences_search(city_name='Las Vegas', max_price_per_person=100, radius_km=20)`

### Budget Allocation (Optional)
If user provides total budget, Claude allocates:
- **Flights**: 55% of budget
- **Hotels**: 35% of budget
- **Experiences**: 10% of budget (per person)

---

## File Structure

```
FlexeTravels website/
├── index.html                    # Main website
├── styles.css
├── app.js                        # Frontend (chat widget, navigation)
├── admin.html                    # Admin console (3-tool search UI)
├── steering.md                   # This file
│
├── backend/
│   ├── main.py                   # FastAPI server + Claude operator (tool-use loop)
│   ├── config.py                 # Environment config, feature flags
│   │
│   ├── docs/
│   │   └── amadeus_reference.md  # Amadeus Python SDK v9 reference guide
│   │
│   ├── tools/                    # 3 NEW Amadeus tools (NO mock data)
│   │   ├── amadeus_flights.py    # AmadeusFlightsTool._run() → flights with live prices
│   │   ├── amadeus_hotels.py     # AmadeusHotelsTool._run() → hotels with check-in/out dates
│   │   ├── amadeus_experiences.py # AmadeusExperiencesTool._run() → activities with pricing
│   │   └── amadeus_search.py     # OLD tool (still used by legacy endpoints—to be deprecated)
│   │
│   ├── agents/                   # 3 specialized agents + orchestrator (optional use)
│   │   ├── flight_agent.py       # FlightAgent wrapper around AmadeusFlightsTool
│   │   ├── hotel_agent.py        # HotelAgent wrapper around AmadeusHotelsTool
│   │   ├── experiences_agent.py  # ExperiencesAgent wrapper around AmadeusExperiencesTool
│   │   ├── operator_agent.py     # OperatorAgent (orchestrates all 3 for programmatic use)
│   │   ├── research_agent.py     # Legacy agent (not used in chat flow)
│   │   └── operations_agent.py   # Legacy agent (not used in chat flow)
│   │
│   ├── utils/
│   │   ├── cache.py              # File-based caching (TTLs: flights 30min, hotels 30min, etc)
│   │   ├── validators.py         # Input validation
│   │   └── (audit.py removed)    # Audit logging removed—no DB storage
│   │
│   ├── .env.example              # Template for env vars
│   ├── .env                       # User's actual env vars (REQUIRED: ANTHROPIC_API_KEY, AMADEUS_API_KEY/SECRET)
│   ├── requirements.txt           # Python dependencies
│   │
│   └── .cache/                   # Cache files only
│       └── [hash].json           # Cached API responses (flights, hotels, experiences)

```

---

## API Endpoints

### Chat (Primary User Flow)
**POST** `/api/chat`
```json
{
  "message": "Flights from Vancouver to Las Vegas Feb 27 - Mar 5, 2 adults, $3000 budget",
  "session_id": "abc123"  // optional, auto-created if missing
}
```
Claude extracts parameters and calls 3 tools internally. Returns formatted response with flights, hotels, experiences.

### Direct Tool Endpoints (Used by Admin Console)
**POST** `/api/amadeus/flights` (calls AmadeusFlightsTool)
```json
{
  "origin": "YVR",
  "destination": "LAS",
  "departure_date": "2026-02-27",
  "return_date": "2026-03-05",
  "adults": 2
}
```
Returns: `{"status": "success", "count": 10, "flights": [...]}`

**POST** `/api/amadeus/hotels` (calls AmadeusHotelsTool)
```json
{
  "city_code": "LAS",
  "check_in_date": "2026-02-27",
  "check_out_date": "2026-03-05",
  "adults": 2,
  "rooms": 1
}
```
Returns: `{"status": "success", "count": 3, "hotels": [...]}`
**Note**: Returns check_in_date and check_out_date for each hotel

**POST** `/api/amadeus/itinerary` (calls both flights + hotels)
```json
{
  "origin": "YVR",
  "destination": "LAS",
  "departure_date": "2026-02-27",
  "return_date": "2026-03-05",
  "adults": 2
}
```
Returns: Combined flights + hotels with total cost breakdown

### Admin Utilities
**GET** `/api/amadeus/status` — Check Amadeus connection, sandbox/prod mode
**POST** `/api/amadeus/clear-cache` — Force fresh API calls next search

### Health & Session
**GET** `/api/health` — System status (Claude API, Amadeus connection)
**GET** `/api/session/{id}` — Get session info
**POST** `/api/reset` — Clear session & conversation history

---

## Environment Variables

```bash
# Required for Chat + 3-Tool Flow
ANTHROPIC_API_KEY=sk-ant-...              # Claude API key (required)
AMADEUS_API_KEY=your_key                  # Amadeus test/prod API key (required)
AMADEUS_API_SECRET=your_secret            # Amadeus API secret (required)
AMADEUS_CURRENCY=USD                      # Currency for all prices (default: USD)

# Optional (legacy endpoints, to be deprecated)
STRIPE_SECRET_KEY=sk_test_...
MAILCHIMP_API_KEY=...
MAILCHIMP_LIST_ID=...
BUFFER_ACCESS_TOKEN=...

# Optional (system config)
API_HOST=0.0.0.0
API_PORT=8000
FRONTEND_URL=http://localhost:3000
ALLOWED_ORIGINS=*
```

**Note**: `SERPER_API_KEY` no longer needed—NO web search fallback

---

## Debugging

### View Backend Logs
Backend logs show all tool calls and responses:
```
[INFO] Tool call: amadeus_flights_search(origin='YVR', destination='LAS', ...)
[INFO] Response: status=success, count=10, flights=[...]
```

### Direct Tool Testing via Admin Console
1. Open `http://localhost:3000/admin.html`
2. **Flights Tab**: Enter YVR→LAS, Feb 27, 2 adults → See 10 flights with USD prices
3. **Hotels Tab**: Enter LAS, Feb 27–Mar 5 → See 3-5 hotels with dates + prices
4. **Itinerary Tab**: Combined results with cost breakdown
5. **Raw JSON toggle**: See exact Amadeus API response for debugging

### Clear Cache
Clears all cached Amadeus responses (forces fresh API calls):
```bash
curl -X POST http://localhost:8000/api/amadeus/clear-cache
```

### Test Chat with 3-Tool Flow
```bash
curl -X POST http://localhost:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Flights YVR to LAS Feb 27 - Mar 5, 2 adults, $3000 budget"}'
```
Expected response includes flights (55% budget), hotels (35%), and experiences (10%).

### Check Backend Status
```bash
curl http://localhost:8000/api/health | python3 -m json.tool
```
Shows Claude API status, Amadeus API status (sandbox/prod), cache info

---

## Common Issues & Solutions

### "ANTHROPIC_API_KEY not set"
**Issue**: Backend can't access Claude API
**Solution**:
- Verify `.env` has correct key: `ANTHROPIC_API_KEY=sk-ant-...`
- Restart backend: `python3 main.py`
- Check: `python3 -c "import os; print(os.getenv('ANTHROPIC_API_KEY'))"`

### "No hotels found for city code: CMH"
**Issue**: Hotel search returns 0 results for Columbus
**Root cause**: CMH is airport code, hotels need IATA city code. Test sandbox has no data for CMH.
**Solution**:
- Use proper city code: CLE (Cleveland, nearby)
- Or use LAS/PAR/LON which have good test data
- Or check `/api/amadeus/hotels` admin endpoint raw JSON to verify

### "YVR→LAS March 26-30 shows 0 flights, but Feb 27 shows 10"
**Issue**: Inconsistent results for same route
**Root cause**: Test sandbox has limited data for March in some routes
**Solution**:
- Use dates within 30 days for better coverage (test API has cutoff)
- Feb 27 – Mar 5 works reliably for YVR→LAS
- Check admin console JSON to see what Amadeus actually returned

### Prices shown in chat vs admin don't match
**Issue**: Chat shows USD, admin shows EUR (or vice versa)
**Root cause** (now fixed): Old tool lacked `currencyCode=USD` parameter
**Current state**: Both tools use `AMADEUS_CURRENCY=USD` in config → consistent pricing
**Verification**:
- Chat: "WestJet $274.83 USD" ✅
- Admin: "274.83 USD" ✅
- (Should match now)

### "Hotel check-in/check-out dates not showing in admin"
**Issue**: Admin console shows price but no dates
**Root cause**: admin.html was not displaying date fields (they ARE in API response)
**Solution** (implemented): Updated admin.html hotel display to show check_in_date and check_out_date
**Status**: ✅ FIXED

### Chat takes 30+ seconds for 3-tool search
**Issue**: Slow response (expected: 5-10 seconds)
**Causes**:
- Claude thinking about 3 tools (flights, hotels, experiences in parallel) takes 2-3s
- Each Amadeus API call takes 1-2s
- Network latency
**Normal behavior**: 5-10s total (not 30+) unless:
- Amadeus API is slow (check status)
- Poor network connection
- Claude API overloaded

---

## Production Deployment

### Docker
```bash
docker-compose up
# Runs on nginx:80 with frontend + API proxy
```

### Cloud (Heroku, AWS, etc.)
1. Set environment variables (`.env` → platform secrets)
2. Install dependencies: `pip install -r requirements.txt`
3. Run: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Frontend: Serve from CDN or same server

---

## Architecture Decisions (Why We Built It This Way)

### Why 3 Tools Instead of 1?
- **Specialization**: Each tool has one job (flights, hotels, experiences)
- **Claude insight**: Claude can reason about budget allocation across categories
- **Parallel calls**: Claude can call all 3 tools at once (faster than sequential)
- **Error handling**: If hotels fail, flights+experiences still succeed

### Why No Web Search Fallback?
- **Honest data**: Amadeus returns real API data or structured errors
- **No hallucination**: No invented flights/prices from web search
- **Clear fallback**: Claude suggests "try different dates" or "upgrade to production"
- **Caching**: 30min cache prevents duplicate API calls in same session

### Why No Audit Database?
- **Simplified stack**: SQLite removed, fewer dependencies to manage
- **Real-time debugging**: Admin console shows raw JSON directly
- **No storage overhead**: Cache files only (auto-cleaned by TTL)

### Why Claude as Operator (Not OperatorAgent)?
- **Token efficiency**: Main.py directly calls tools (no nested Claude calls)
- **Simpler orchestration**: Claude naturally extracts params → calls tools
- **Better UX**: User talks to Claude, not a "research agent" abstraction
- **OperatorAgent** available for programmatic use (future APIs, scripts)

---

## ✅ Completed Features Summary (March 2026)

### Core Travel Platform ✅
- [x] Claude AI chatbot with Amadeus tool integration
- [x] Real-time flight search & pricing
- [x] Real-time hotel search & pricing
- [x] Real-time experiences search
- [x] Budget-aware trip planning
- [x] Multi-day itinerary generation
- [x] Admin console for API testing
- [x] Session management & conversation history
- [x] Cache management for performance

### Dynamic Tours System ✅
- [x] IP-based geolocation detection
- [x] 80-city IATA airport code mapping
- [x] Location-based tour personalization
- [x] Claude AI tour package generation
- [x] Unsplash API image integration
- [x] 30+ curated fallback destination photos
- [x] Test mode for development (`?test_city` parameter)
- [x] Skeleton loading UI
- [x] Dynamic card rendering
- [x] Frontend integration with console logging

### Interactive Cards & Travel Styles ✅
- [x] All cards clickable → chatbot with rich context
- [x] Tour cards: "Plan This Trip →" CTA, pre-filled chat message
- [x] Destination cards: click includes user's detected city
- [x] Travel Your Way: dynamic, location-relevant destination suggestions
- [x] 6 travel styles × 7 world regions = 42 curated destination sets
- [x] `/api/travel-styles` endpoint with IP-based region detection
- [x] Chatbot asks follow-up questions (origin, dates, travelers, budget)
- [x] Skeleton loading for Travel Your Way section
- [x] Hover CTAs on all card types

### Marketing Automation ✅
- [x] Weekly marketing workflow (4-node process)
- [x] Claude AI content generation
  - [x] Tour package descriptions with pricing
  - [x] 4 Instagram posts with captions
  - [x] Blog draft with SEO titles
- [x] Clickbait-style captions with power words
- [x] Image prompts for content creators
- [x] Email HTML templates with images
- [x] Real Unsplash destination photos in emails
- [x] Neomail SMTP integration
- [x] Tour impression analytics (JSONL)
- [x] Weekly destination selection
- [x] Email send with error handling

### Email System ✅
- [x] SMTP configuration (Neomail, Gmail, any server)
- [x] TLS/SSL encryption support
- [x] HTML email templates
- [x] Destination hero images
- [x] Post images from Unsplash
- [x] Professional styling & branding
- [x] CTA links to chatbot
- [x] Image prompts for external tools
- [x] Plain text fallback

### Deployment Infrastructure ✅
- [x] GitHub repository setup
- [x] requirements.txt generation
- [x] Procfile for Railway
- [x] railway.json config
- [x] .gitignore for security
- [x] CORS configuration
- [x] Environment variable setup
- [x] Deployment guides (8-step & quick 10-min)
- [x] Production API URLs
- [x] Domain configuration (Namecheap)

### Testing & Documentation ✅
- [x] Browser console logging
- [x] API endpoint testing
- [x] Email workflow testing
- [x] Location testing with `?test_city`
- [x] STEERING.md documentation
- [x] DEPLOYMENT_GUIDE.md
- [x] QUICK_DEPLOY.md
- [x] EMAIL_TROUBLESHOOTING.md
- [x] DEBUGGING_GUIDE.md

### Technical Implementation ✅
- [x] Python 3.9+ compatibility (removed Python 3.10+ type hints)
- [x] FastAPI backend
- [x] Static frontend (HTML/JS/CSS)
- [x] Caching layer (24h IP, 24h images, 6h tours, 6h analytics)
- [x] Error handling & fallbacks
- [x] Logging system (file-based)
- [x] Environment variable management
- [x] API rate limiting awareness
- [x] Token-efficient prompts for Claude

---

## 📋 System Status

| Component | Status | Notes |
|-----------|--------|-------|
| **Travel Chatbot** | ✅ Live | Real Amadeus pricing at flexetravels.com |
| **Dynamic Tours** | ✅ Live | IP geolocation + Unsplash images loading |
| **Marketing Workflow** | ✅ Live | Weekly campaigns via Railway endpoint |
| **Email System** | ✅ Live | Neomail SMTP confirmed working |
| **Frontend** | ✅ Live | https://flexetravels.com (Vercel) |
| **Backend** | ✅ Live | https://flexetravels-production.up.railway.app |
| **Domain** | ✅ Live | flexetravels.com → Vercel (DNS propagated) |
| **GitHub** | ✅ Live | https://github.com/flexetravels/flexetravels |
| **Documentation** | ✅ Complete | All guides created |

---

## 🚀 Next Steps

### Immediate (Done ✅)
- [x] Push code to GitHub
- [x] Deploy backend to Railway.app
- [x] Deploy frontend to Vercel
- [x] Configure domain (flexetravels.com → Vercel)
- [x] Test live on https://flexetravels.com

### Short-term (This Week)
1. Monitor production logs
2. Test all user workflows
3. Fine-tune marketing content
4. Gather user feedback
5. Iterate on UX/copy

### Medium-term (This Month)
1. Upgrade Amadeus to production account
2. Implement Stripe payments
3. Add Mailchimp email confirmations
4. Set up Buffer for social posting
5. Add price tracking & analytics

### Long-term (Roadmap)
1. User authentication & accounts
2. Saved trips & favorites
3. Mobile app (React Native)
4. ChatGPT plugin
5. AI-powered recommendations

---

## 📞 Support & Debugging

### Common Issues

**Q: Dynamic tours not loading?**
- Check browser console (F12)
- Verify API_BASE URL in app.js
- Check Railway backend logs
- Test API directly: curl `https://railway-url/api/featured-tours`

**Q: Email not sending?**
- Verify NEOMAIL SMTP enabled in account
- Check SMTP credentials in Railway env
- Verify `ALLOWED_ORIGINS` includes your domain
- Check backend logs for SMTP errors

**Q: Domain not resolving?**
- Wait 24h for DNS propagation
- Verify DNS records in Namecheap
- Check Vercel domain settings
- Test with: https://www.whatsmydns.net/

**Q: CORS errors?**
- Update `ALLOWED_ORIGINS` in Railway
- Restart Railway deployment
- Clear browser cache
- Check network tab in DevTools

### Debug Commands

```bash
# Test featured tours API (production)
curl https://flexetravels-production.up.railway.app/api/featured-tours
curl "https://flexetravels-production.up.railway.app/api/featured-tours?test_city=London"

# Test marketing workflow (production)
curl -X POST https://flexetravels-production.up.railway.app/api/marketing/run-weekly

# View recent logs
tail -50 backend/logs/flexetravels.log

# Check email logs
tail -50 backend/logs/social_posts.log
```

---

## Roadmap (Future Enhancements)

- [ ] Upgrade to Amadeus production account (real prices, all routes)
- [ ] Build payment flow (Stripe integration)
- [ ] Email confirmations (Mailchimp)
- [ ] Social sharing (Buffer)
- [ ] Price tracking + historical trends
- [ ] User accounts & saved trips
- [ ] Mobile app (React Native)
- [ ] ChatGPT plugin for travel search

---

**Questions?** Check backend logs, admin console raw JSON, and this steering.md for answers.
**Bug reports?** Check admin console to verify Amadeus API response, then debug in backend logs.
