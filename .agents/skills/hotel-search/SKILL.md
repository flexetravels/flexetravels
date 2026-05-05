---
name: hotel-search
description: Map natural language to LiteAPI searchHotels parameters — price, stars, region expansion, sample fallback
when_to_use: User asks about hotels or full trip planning where hotels must be searched
---

# Hotel search — NL → parameter mapping

## Default ordering
Hotels are returned ranked by a **composite of guest rating + price** (equal weighting). Great rating at a fair price floats to the top, not just the cheapest. Don't re-sort in prose.

## Price / stars
- "under $X" / "less than $X" → `maxPrice:X`.
- "budget" / "cheap" → `maxPrice:100`.
- "5-star" / "luxury" → `stars:5`.
- "4-star or above" / "upscale" → `stars:4`.

## Reviews / ratings
- "well-reviewed" / "good reviews" → `minRating:8`.
- "highly rated" / "top reviewed" → `minRating:8.5`.
- "excellent" / "best in class" → `minRating:9`.
- "established" / "avoid obscure" → `minReviewCount:100`.

## Amenities (pass literal strings, matched case-insensitive)
- "with a pool" / "pool" → `amenities:['Pool']`.
- "gym" / "fitness" → `amenities:['Gym']`.
- "spa" → `amenities:['Spa']`.
- "breakfast included" → `amenities:['Breakfast']`.
- "WiFi" / "wifi" → `amenities:['WiFi']`.
- "parking" → `amenities:['Parking']`.
- Multiple: "pool and gym" → `amenities:['Pool','Gym']` (all required).

## Board type
- "all-inclusive" → `boardType:'AI'`.
- "with breakfast" → `boardType:'BB'`.
- "half board" → `boardType:'HB'`.
- "full board" → `boardType:'FB'`.
- "room only" / "no meals" → `boardType:'RO'`.

## Cancellation
- "refundable" / "free cancellation" / "cancellable" → `freeCancellation:true`.

## Special behaviors
- "show me more" / "other options nearby" → call `searchNearbyHotels` instead of `searchHotels`.
- `isSample=true` in a result → response MUST say "indicative pricing".
- `count=0` → suggest alternative dates/areas; NEVER fabricate hotels.

## Follow-up queries hit the cache
All of the filters above (`stars`, `maxPrice`, `minRating`, `minReviewCount`, `amenities`, `boardType`, `freeCancellation`) are **post-cache filters**. Re-calling `searchHotels` with only filter changes and the same (destination, checkIn, checkOut, adults, childrenAges) returns near-instantly from cache — no extra LiteAPI cost.

So when the user follows up with "only 5-star", "with a pool", "minimum 200 reviews", "all-inclusive only":
- Re-call `searchHotels` with the same hard constraints + the new filter.
- Do NOT filter previous results in prose.
- Do NOT ask the user to start a new search.

## Region auto-expansion (large regions → specific districts)
If the destination is a region name, auto-search the listed districts in parallel:
- Bali → Seminyak, Ubud, Nusa Dua, Canggu
- Phuket → Patong, Karon, Kata
- Dubai → Dubai Marina, Deira, Downtown Dubai, Jumeirah
- Santorini → Fira, Oia
- Goa → Panjim, Calangute

Dubai neighbourhoods (use when the user states intent):
- Marina → waterfront + nightlife
- Downtown → Burj Khalifa + Mall
- Deira → old Dubai + budget
- Jumeirah → beach + luxury + families

## Low-inventory fallback
- Fewer than 4 hotels returned → call `searchNearbyHotels` to widen.
- `isSample=true` in a hotel result → note "indicative pricing" in the response text.
- `count=0` → suggest alternative dates or nearby areas; do NOT fabricate hotels.

## Presentation rule
Hotel cards are pushed to the UI via the data stream automatically. Do NOT re-describe each card in prose — write a short summary referencing the cheapest option (name + price VERBATIM from the tool result).

---

## Test cases

| # | Query | Expected `searchHotels` args / behaviour |
|---|---|---|
| H1 | "5-star hotels in Dubai Marina under $400" | `{destination:'Dubai Marina', stars:5, maxPrice:400}` |
| H2 | "cheap hotels in Bangkok" | `{destination:'BKK', maxPrice:100}` |
| H3 | "luxury resort in Bali" | Fan-out: `{destination:'Seminyak'}`, `{destination:'Nusa Dua'}`, `{destination:'Ubud'}`, `{destination:'Canggu'}`; each `stars:5` |
| H4 | "hotels in Santorini" | Fan-out: `{destination:'Fira'}`, `{destination:'Oia'}` |
| H5 | "4-star family-friendly hotel Cancun" | `{destination:'Cancun', stars:4}` |
| H6 | "budget hotel near Miami beach" | `{destination:'Miami', maxPrice:100}` |
| H7 | "show me more" (after previous hotel search) | call `searchNearbyHotels`, not `searchHotels` |
| H8 | Result has `count=0` | Response MUST NOT fabricate; suggests alt dates/areas |
| H9 | Result has `isSample=true` | Response MUST include "indicative pricing" |
| H10 | Less than 4 hotels returned for a city | Agent MUST call `searchNearbyHotels` to widen |
| H11 | "well-reviewed hotels in Tokyo" | `{destination:'Tokyo', minRating:8}` |
| H12 | "5-star Cancun with a pool and gym" | `{destination:'Cancun', stars:5, amenities:['Pool','Gym']}` |
| H13 | "all-inclusive resort in Punta Cana under $400" | `{destination:'Punta Cana', maxPrice:400, boardType:'AI'}` |
| H14 | "refundable hotels in Paris" | `{destination:'Paris', freeCancellation:true}` |
| H15 | "highly rated, at least 200 reviews, in Rome" | `{destination:'Rome', minRating:8.5, minReviewCount:200}` |
| H16 | Follow-up after H5: "actually show me 5-star" | Re-call with `stars:5` same other params (expect cache hit) |
| H17 | Follow-up after H5: "add a pool requirement" | Re-call with `amenities:['Pool']` (expect cache hit) |
| H18 | Follow-up: "same but different dates" | New `checkIn`/`checkOut` (expect cache **miss**) |
| H19 | Default sort on hit | Top result has best composite rating+price score |

**Failure patterns to watch for:**
- Model re-describes every hotel card in prose (duplicates UI).
- Model invents stars ratings or prices not in tool result.
- Model fails to fan-out for "Bali" and searches a single non-existent "Bali" node.
