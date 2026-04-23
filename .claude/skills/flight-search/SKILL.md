---
name: flight-search
description: Map natural language to Duffel searchFlights parameters — non-stop, cabin, routing, airline avoidance, children/infants
when_to_use: User asks about flights, or a full trip where flights must be searched
---

# Flight search — NL → parameter mapping

## IATA quick reference
YYZ=Toronto · YVR=Vancouver · YUL=Montreal · YYC=Calgary · JFK/EWR=NYC · LAX=LA · ORD=Chicago · MIA=Miami · SFO=SF · BOS=Boston · ATL=Atlanta · DFW=Dallas · DXB=Dubai · BCN=Barcelona · NRT=Tokyo · DPS=Bali · CDG=Paris · LHR=London · FCO=Rome · LIS=Lisbon · PUJ=PuntaCana · CUN=Cancun · SIN=Singapore · BKK=Bangkok · HKT=Phuket · AMS=Amsterdam.

## Default ordering
Results are returned ranked by a **composite of duration + price** (equal weighting). The cheapest flight isn't always first — the shortest-for-the-money option is. Do not second-guess the order; present results in the order the tool returned them.

## Stops / non-stop filter
- "non-stop", "direct", "no stops", "no layovers" → `maxConnections=0`.
- "max 1 stop" → `maxConnections=1`.
- Otherwise omit `maxConnections`.

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

## Routing / airline filters (all applied as real tool parameters — not post-prose)
- "via Pacific" → `viaRegions:['pacific']` (hubs: SIN, BKK, NRT, HND, HKG, ICN, PVG, TPE, KUL, MNL).
- "via Europe" → `viaRegions:['europe']` (hubs: LHR, CDG, AMS, FRA, IST, MAD, FCO, ZRH, MUC, BRU).
- "via Middle East" → `viaRegions:['middleeast']` (hubs: DXB, DOH, AUH, JED, RUH, KWI).
- "avoid [airline]" → `avoidAirlines:['<code or name>']` — pass code like `"AI"` OR display name like `"Air India"`; the filter matches both.
- Multiple: "via Europe OR Pacific" → `viaRegions:['europe','pacific']`.
- COK/Kochi → North America: typically Pacific via Asian hubs. Europe-origin: DXB/DOH/AUH or direct LHR. Let the user choose — never suppress options.

## Price / duration / time-window filters
- "under $X" / "less than $X" → `maxPrice:X`.
- "under 8 hours" / "max 12h flight" → `maxDurationMinutes:<minutes>` (8h=480, 12h=720, 15h=900). This is total trip duration (outbound + return for RT).
- "no red-eyes" / "morning flights only" → `departAfter:'06:00'` or `departBefore:'12:00'` (24h HH:MM).
- "after 9am" → `departAfter:'09:00'`.

## Follow-up queries hit the cache — don't hesitate to re-call the tool
All of the filters above (`maxConnections`, `avoidAirlines`, `viaRegions`, `maxPrice`, `maxDurationMinutes`, `departAfter`, `departBefore`) are **post-cache filters**. Re-calling `searchFlights` with *only filter changes* and the same (origin, destination, dates, pax, cabin) returns near-instantly from cache — no extra Duffel cost, no extra latency.

So when the user follows up with "actually show me direct only" / "without Air India" / "under $600" / "only morning flights":
- Re-call `searchFlights` with the same hard constraints + the new filter.
- Do NOT try to filter the previous results in prose.
- Do NOT ask the user to start a new search.

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
| F8 | "BLR to SFO avoiding Air India, via Pacific" | `searchFlights({origin:'BLR', destination:'SFO', ..., avoidAirlines:['Air India'], viaRegions:['pacific']})` |
| F9 | "5-year-old with me, flying from LAX to MIA" | `{origin:'LAX', destination:'MIA', adults:1, childrenAges:[5]}` |
| F10 | "15-year-old and me to Bangkok" | `{adults:2, childrenAges:[]}` (15 = adult fare) |
| F11 | "YYZ to CUN tomorrow" | `{departureDate:'<tomorrow ISO>'}` and regulatory warning NOT triggered (<7 days) |
| F12 | "YYZ to CUN in 30 days" | `{...}` and DOT 24-hour free-cancel line MUST appear |
| F13 | "YYZ to CUN under $500, morning only" | `{origin:'YYZ', destination:'CUN', ..., maxPrice:500, departBefore:'12:00'}` |
| F14 | "total flight time under 10 hours, LAX to NRT" | `{origin:'LAX', destination:'NRT', ..., maxDurationMinutes:600}` |
| F15 | "no red-eyes, BOS to LHR" | `{..., departAfter:'06:00'}` |
| F16 | Follow-up after F1: "actually show me 1-stop too" | Re-call `searchFlights` with same hard constraints + `maxConnections:1` (expect cache hit, ~0ms) |
| F17 | Follow-up after F8: "drop the airline filter" | Re-call `searchFlights` without `avoidAirlines` (expect cache hit) |
| F18 | Follow-up after F1: "same but next Tuesday +1 week" | Re-call with NEW `departureDate` (expect cache **miss**, fresh Duffel fetch) |
| F19 | Default sort on cache hit | First result has the lowest composite (duration + price) score, not necessarily lowest price |

**Failure patterns to watch for:**
- Model passes `maxConnections` when user didn't mention stops → false filter.
- Model infers `returnDate` from "for a week" without user saying "return" → wrong trip type.
- Model lumps infant into `adults` or `childrenAges` → LiteAPI/Duffel pricing breaks.
- Model fabricates IATA codes for smaller cities → Duffel returns 0 offers.
