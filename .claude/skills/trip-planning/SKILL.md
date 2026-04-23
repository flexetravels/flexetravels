---
name: trip-planning
description: Multi-constraint trip planning — parse every constraint, choose tools, estimate budget splits
when_to_use: Open-ended or multi-constraint trip queries (budget, traveler type, weather, destination unknown)
---

# Super-human trip planning

For any open-ended or multi-constraint query (unknown destination, toddlers/kids, weather/season, total budget, flight time, routing, airline avoids):

## 1. Parse EVERY constraint
- Origin (IATA or city → resolve)
- Max flight time
- Traveler type (toddlers → family-friendly beaches/pools/safety)
- Month/season → implied weather
- Total budget (flights + hotel + $20 fee + experiences)
- Routing preference
- Airlines to avoid
- Interests (beach, culture, wellness, food, adventure, nightlife)

## 2. Tool strategy
- Pure flight query → `searchFlights` only.
- Full trip planning: `getSimilarDestinations` + `getDestinationGuide` first (on 2–3 candidates) → pick best matches → then `searchFlights` + `searchHotels` (+ optionally `searchExperiences`) for the top 1–2 destinations.
- Vague destination → offer 3 curated picks before searching. Example: "Cancún for beaches, Lisbon for culture, or Bali for wellness?"

## 3. Confirmation questions (ask before searching)
- Origin (if not given).
- Dates or flexibility.
- Adults count.
- Kids count AND ages (children 2-11 need ages; 0-1 are infants).
- Any non-negotiables (airline, routing, direct-only, budget cap).
- "flexible" dates → pick the best 7-day window in the next 6-8 weeks and explain the choice.

## 4. Budget estimation (dynamic split by route length)
| Route | Flights % | Hotel % | Fees % |
|---|---|---|---|
| Short-haul (<4h) | ~25% | ~70% | ~5% |
| Medium-haul (4-8h) | ~40% | ~55% | ~5% |
| Long-haul (8h+) | ~50% | ~45% | ~5% |

Always multiply flight cost by passenger count.
Example: "$4000 budget, 2 adults, 7 nights to Cancún (medium-haul) → ~$1600 flights (2×$800) + ~$2200 hotel ($314/night) + $20 fee."

## 5. Present 2–3 curated options
Cross-check total estimated cost against user budget. Each option: clear cost breakdown + one sentence on why it fits their constraints.

## Few-shot example
User: "Find me places to travel that are 5 hours away from Vancouver, great with toddlers or kids and has great weather right May, Budget $5000"
→ Parse constraints → `getSimilarDestinations` + `getDestinationGuide` on 2-3 candidates → `searchFlights` + `searchHotels` for the best 1-2 → present curated budget-aware options with cost breakdowns.

---

## Test cases

| # | Query | Expected flow |
|---|---|---|
| T1 | "somewhere warm for our honeymoon, $6000, late April, from JFK" | `getSimilarDestinations('warm romantic April', fromAirport:'JFK')` → `getDestinationGuide` on top 2 → `searchFlights` + `searchHotels` on best 2 |
| T2 | "5 hour flight max from YVR, toddlers, May, $5k" | Candidates list → guide → search top 2 destinations; budget split per medium-haul rule |
| T3 | "beach vacation in March" | Ask origin first, then proceed with 3 candidate picks |
| T4 | "I want to go to Paris" (concrete dest + no other constraints) | Skip discovery; ask origin + dates; then `searchFlights` + `searchHotels` |
| T5 | "cultural trip to Japan, 10 days, 2 adults, $8k total from LAX" | medium-long-haul budget split: ~50% flights ($4000), ~45% hotel ($3600 over 10 nights = $360/night), ~5% fees |
| T6 | "$2000 all-in for a weekend from YYZ" | Short-haul (<4h) split → offer 3 short-haul candidates (NYC, Chicago, Montreal, Boston) |
| T7 | "family of 5, 2 adults and 3 kids aged 4, 7, 9, Bali in summer" | Clarify: "Bali summer means June-Aug — confirm dates?" then full trip planning |

**Failure patterns to watch for:**
- Model skips discovery phase for vague destinations and searches a random city.
- Model ignores party size when estimating flight cost (forgets to multiply).
- Model's budget estimate puts >60% on flights for a short-haul route.
- Model recommends a destination outside the stated max flight time.
