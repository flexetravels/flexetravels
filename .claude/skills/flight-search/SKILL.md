---
name: flight-search
description: Map natural language to Duffel searchFlights parameters — non-stop, cabin, routing, airline avoidance, children/infants
when_to_use: User asks about flights, or a full trip where flights must be searched
---

# Flight search — NL → parameter mapping

## IATA quick reference
YYZ=Toronto · YVR=Vancouver · YUL=Montreal · YYC=Calgary · JFK/EWR=NYC · LAX=LA · ORD=Chicago · MIA=Miami · SFO=SF · BOS=Boston · ATL=Atlanta · DFW=Dallas · DXB=Dubai · BCN=Barcelona · NRT=Tokyo · DPS=Bali · CDG=Paris · LHR=London · FCO=Rome · LIS=Lisbon · PUJ=PuntaCana · CUN=Cancun · SIN=Singapore · BKK=Bangkok · HKT=Phuket · AMS=Amsterdam.

## Stops / non-stop filter (apply at the API level, not UI)
- "non-stop", "direct", "no stops", "no layovers" → `maxConnections=0`.
- "max 1 stop" → `maxConnections=1`.
- Otherwise omit `maxConnections`.
- Do NOT rely on the UI filter alone.

## Round-trip detection
If the user mentions "return", "round trip", "back on [date]", "returning [date]", or gives both a departure and a return date → always pass `returnDate=` to `searchFlights`.
One-way only when the user explicitly says "one way" or gives only a departure date with no mention of returning.

## Passenger types
- 0-1 year old = lap infant → `infants=` (never counted as `adults` or `childrenAges`). Infants ≤ adults count.
- 2-11 = child → `childrenAges=[...]` (each gets own seat at child fare).
- 12-17 = adult fare → count in `adults`.
- 18+ = adult.
- "we" / "couple" / "us" → `adults=2`.
- "family" → ask how many kids and their ages.

## Cabin class
- "economy" / unspecified → `cabinClass='economy'`.
- "premium economy" → `cabinClass='premium_economy'`.
- "business" → `cabinClass='business'`.
- "first" / "first class" → `cabinClass='first'`.

## Routing intelligence
- "via Pacific" → prefer SIN, BKK, NRT, HKG, ICN, PVG, TPE, KUL.
- "via Europe" → prefer LHR, CDG, AMS, FRA, IST.
- "via Middle East" → prefer DXB, DOH, AUH.
- "avoid [airline]" → exclude that airline from the shown cards (post-search filter).
- COK/Kochi → North America: Pacific via Asian hubs. Europe: DXB/DOH/AUH or direct LHR. Let the user choose — never suppress options.

## Presenting results
- Always highlight non-stop and cheapest options.
- For round-trips, mention direct/non-stop options for BOTH outbound AND return legs if available — do not describe only one direction.
- Copy prices and airline names VERBATIM from tool result summaries. No rounding, no invention.

## Zero-result recovery
- 0 flights, hotels OK → show hotels, tell the user: "Flight search returned no results for these dates. Try adjusting dates, checking a nearby airport, or a different cabin class."
- 0 flights and 0 hotels → "No availability found. Let me suggest alternative dates or nearby destinations."

## Few-shot example
User: "Find me flights from BLR to YVR, sometime in end of May for 1 adult, only find me flights that pass fly over Europe or Pacific and avoid Air India"
→ `searchFlights({origin:'BLR', destination:'YVR', departureDate:'2026-05-28', adults:1})` then apply routing + exclude Air India in the summary.

---

## Test cases (use these to regression-test the skill)

Each row is a fixture: `[natural-language query]` → expected tool call signature.
Run via `npm run test:skills` (to be added) or eyeball in `/chat`.

| # | Query | Expected `searchFlights` args |
|---|---|---|
| F1 | "direct flights from YYZ to CUN next Tuesday, 2 adults" | `{origin:'YYZ', destination:'CUN', departureDate:'<next Tue>', adults:2, maxConnections:0}` |
| F2 | "show me non-stop Toronto to Tokyo" | `{origin:'YYZ', destination:'NRT', departureDate:..., maxConnections:0}` |
| F3 | "max 1 stop LHR to JFK" | `{..., maxConnections:1}` |
| F4 | "flights YVR to DXB, 2 adults 1 infant" | `{origin:'YVR', destination:'DXB', adults:2, infants:1}` |
| F5 | "family of 4 to Bali, kids are 3 and 7" | ask for origin first, then `{childrenAges:[3,7], adults:2}` |
| F6 | "business class round trip SFO to LHR, leaving March 5, back March 15" | `{origin:'SFO', destination:'LHR', departureDate:'2026-03-05', returnDate:'2026-03-15', cabinClass:'business'}` |
| F7 | "one way to Paris from Boston" | `{origin:'BOS', destination:'CDG', returnDate: undefined}` |
| F8 | "BLR to SFO avoiding Air India, via Pacific" | `searchFlights` (no airline param), then post-filter AI + prefer Pacific hub routings in summary |
| F9 | "5-year-old with me, flying from LAX to MIA" | `{origin:'LAX', destination:'MIA', adults:1, childrenAges:[5]}` |
| F10 | "15-year-old and me to Bangkok" | `{adults:2, childrenAges:[]}` (15 = adult fare) |
| F11 | "YYZ to CUN tomorrow" | `{departureDate:'<tomorrow ISO>'}` and regulatory warning NOT triggered (<7 days) |
| F12 | "YYZ to CUN in 30 days" | `{...}` and DOT 24-hour free-cancel line MUST appear |

**Failure patterns to watch for:**
- Model passes `maxConnections` when user didn't mention stops → false filter.
- Model infers `returnDate` from "for a week" without user saying "return" → wrong trip type.
- Model lumps infant into `adults` or `childrenAges` → LiteAPI/Duffel pricing breaks.
- Model fabricates IATA codes for smaller cities → Duffel returns 0 offers.
