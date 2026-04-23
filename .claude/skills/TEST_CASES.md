# Skills test catalog

Aggregated, runnable-by-hand regression suite for the v2 skills-based prompt. Every row traces back to the originating `SKILL.md` — fix a drift by updating the relevant skill file and re-running only that skill's cases.

To execute manually:
1. Deploy (or run locally) with `FLEXE_PROMPT_VERSION=skills`.
2. Open `/chat`.
3. Paste the query exactly.
4. Verify the expected tool call and response shape.
5. Log pass/fail in a running spreadsheet or a CI artifact.

Automating this via an eval harness is a future task (see "Known constraints" in `README.md`).

---

## flight-search (`.claude/skills/flight-search/SKILL.md`)

| # | Query | Expected |
|---|---|---|
| F1 | "direct flights from YYZ to CUN next Tuesday, 2 adults" | `searchFlights({origin:'YYZ', destination:'CUN', departureDate:'<next Tue>', adults:2, maxConnections:0})` |
| F2 | "show me non-stop Toronto to Tokyo" | `{origin:'YYZ', destination:'NRT', maxConnections:0}` |
| F3 | "max 1 stop LHR to JFK" | `{maxConnections:1}` |
| F4 | "flights YVR to DXB, 2 adults 1 infant" | `{origin:'YVR', destination:'DXB', adults:2, infants:1}` |
| F5 | "family of 4 to Bali, kids are 3 and 7" | Ask origin; then `{childrenAges:[3,7], adults:2}` |
| F6 | "business class round trip SFO to LHR, leaving March 5, back March 15" | `{origin:'SFO', destination:'LHR', departureDate:'2026-03-05', returnDate:'2026-03-15', cabinClass:'business'}` |
| F7 | "one way to Paris from Boston" | `{origin:'BOS', destination:'CDG', returnDate: undefined}` |
| F8 | "BLR to SFO avoiding Air India, via Pacific" | `searchFlights(...)` with no airline param; post-filter AI; prefer Pacific hubs |
| F9 | "5-year-old with me, flying from LAX to MIA" | `{origin:'LAX', destination:'MIA', adults:1, childrenAges:[5]}` |
| F10 | "15-year-old and me to Bangkok" | `{adults:2, childrenAges:[]}` (15 = adult fare) |
| F11 | "YYZ to CUN tomorrow" | DOT 24-hour line NOT triggered (<7 days) |
| F12 | "YYZ to CUN in 30 days" | DOT 24-hour line MUST appear |

## hotel-search (`.claude/skills/hotel-search/SKILL.md`)

| # | Query | Expected |
|---|---|---|
| H1 | "5-star hotels in Dubai Marina under $400" | `{destination:'Dubai Marina', stars:5, maxPrice:400}` |
| H2 | "cheap hotels in Bangkok" | `{destination:'BKK', maxPrice:100}` |
| H3 | "luxury resort in Bali" | Fan-out Seminyak/Nusa Dua/Ubud/Canggu; `stars:5` each |
| H4 | "hotels in Santorini" | Fan-out Fira + Oia |
| H5 | "4-star family-friendly hotel Cancun" | `{destination:'Cancun', stars:4}` |
| H6 | "budget hotel near Miami beach" | `{destination:'Miami', maxPrice:100}` |
| H7 | "show me more" (after previous hotel search) | Calls `searchNearbyHotels` |
| H8 | Result `count=0` | Response suggests alt dates/areas; no fabrication |
| H9 | Result `isSample=true` | Response includes "indicative pricing" |
| H10 | <4 hotels returned | Auto-calls `searchNearbyHotels` to widen |

## trip-planning (`.claude/skills/trip-planning/SKILL.md`)

| # | Query | Expected |
|---|---|---|
| T1 | "somewhere warm for our honeymoon, $6000, late April, from JFK" | `getSimilarDestinations` → `getDestinationGuide` x2 → search top 2 |
| T2 | "5 hour flight max from YVR, toddlers, May, $5k" | Candidate discovery → medium-haul budget split |
| T3 | "beach vacation in March" | Ask origin first; then 3 candidate picks |
| T4 | "I want to go to Paris" (concrete) | Skip discovery; ask dates; then search |
| T5 | "cultural trip to Japan, 10 days, 2 adults, $8k total from LAX" | ~50% flights, ~45% hotel for long-haul |
| T6 | "$2000 all-in for a weekend from YYZ" | Short-haul <4h split; NYC/Chicago/Montreal/Boston candidates |
| T7 | "family of 5, 2 adults + 3 kids aged 4/7/9, Bali in summer" | Clarify dates; then full planning |

## policy-compliance (`.claude/skills/policy-compliance/SKILL.md`)

| # | Scenario | Expected |
|---|---|---|
| P1 | US departure, +14 days | DOT 24-hour line present |
| P2 | US departure, +3 days | DOT 24-hour line absent |
| P3 | Canadian departure | Mention APPR |
| P4 | BLR→DXB (non-US/non-CA) | No DOT/APPR |
| P5 | Codeshare | "Operated by [carrier]" |
| P6 | Non-refundable + refundable alt | Flag the refundable alt |
| P7 | No baggage info | "Baggage info not available" |
| P8 | Any result | No subjective adjectives |

## persona-maya (`.claude/skills/persona-maya/SKILL.md`)

| # | Scenario | Expected |
|---|---|---|
| M1 | Post-search summary | 3-5 warm sentences |
| M2 | Vague question | 2-3 sentences, no walls of text |
| M3 | "we're a couple" | Romantic cues |
| M4 | "family with toddlers" | Pool/beach/safety cues |
| M5 | Business trip | CBD + WiFi mention |
| M6 | "who are you" | Friendly ack, no meta AI talk |

## response-format (`.claude/skills/response-format/SKILL.md`)

| # | Scenario | Expected |
|---|---|---|
| R1 | Flights returned | No `[FLIGHT_CARD]` in response text |
| R2 | Hotels returned | No `[HOTEL_CARD]` in response text |
| R3 | Experiences returned | `[EXPERIENCE_CARD]` tags present |
| R4 | Cheapest = "$489 Air Canada non-stop" | Exact string present |
| R5 | Any successful search | Ends with "…$20 service fee — no surprises. Which catches your eye?" |
| R6 | Response length | ≤ 5 sentences |
| R7 | "show me more" | New tool call allowed |

## state-machine (`.claude/skills/state-machine/SKILL.md`)

| # | Scenario | Expected |
|---|---|---|
| S1 | state=browsing, flight query | Full tool chain |
| S2 | state=flight_selected, "great!" | 1 sentence; no tools; mention green bar |
| S3 | state=hotel_selected, PII typed | Redirect to green bar; no PII ack |
| S4 | state=flight_selected, "how do I book?" | "Tap the green bar at the bottom" |
| S5 | state=flight_selected, "find me a different hotel" | Acknowledge + search |
| S6 | state=hotel_selected, "what's the weather" | Conversational; no tools |

---

## Running the suite manually

**Local dev:**
```bash
FLEXE_PROMPT_VERSION=skills npm run dev
# open http://localhost:3000/chat
```

**Railway dev env:**
Set `FLEXE_PROMPT_VERSION=skills` on the preview service → deploy → exercise `/chat`.

**Rollback on any failure:**
Unset `FLEXE_PROMPT_VERSION` in Railway. No code deploy needed.

## Adding a new test case

1. Append the row to the relevant skill's `## Test cases` table.
2. Mirror it in this catalog.
3. Commit with message `skill(<name>): add test case <short label>`.
