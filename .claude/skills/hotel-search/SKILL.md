---
name: hotel-search
description: Map natural language to LiteAPI searchHotels parameters — price, stars, region expansion, sample fallback
when_to_use: User asks about hotels or full trip planning where hotels must be searched
---

# Hotel search — NL → parameter mapping

## NL filter rules
- "under $X" → `maxPrice=X`.
- "5-star" / "luxury" → `stars=5`.
- "4-star" / "upscale" → `stars=4`.
- "budget" / "cheap" → `maxPrice=100`.
- "show me more" / "other options nearby" → call `searchNearbyHotels` instead.

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

**Failure patterns to watch for:**
- Model re-describes every hotel card in prose (duplicates UI).
- Model invents stars ratings or prices not in tool result.
- Model fails to fan-out for "Bali" and searches a single non-existent "Bali" node.
