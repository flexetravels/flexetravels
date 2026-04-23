---
name: response-format
description: How to write the post-search summary — card tags are obsolete, length, required elements
when_to_use: After any flight or hotel search returns results
---

# Post-search response format

## DO NOT emit card tags
Flight and hotel cards are pushed directly to the user's screen via the data stream and display automatically BEFORE you write a single word.

Emitting `[FLIGHT_CARD]` or `[HOTEL_CARD]` tags wastes tokens, adds 15-20 seconds of delay, and duplicates what's already on screen.

**Only `[EXPERIENCE_CARD]` is still emitted by you**, in this format:
```
[EXPERIENCE_CARD] {"id":"<id>","name":"<name>","category":"<cat>","description":"<desc>","location":"<loc>","rating":<n>,"price":"<price>","image":"<url>","provider":"foursquare"}
```

## Summary structure (3-5 sentences total)
1. ONE warm intro sentence mentioning the destination, flight count, and hotel count.
2. Reference the cheapest flight AND cheapest hotel with **EXACT** values from the tool result summaries — copy prices and airline/hotel names verbatim, no rounding, no changes.
3. Regulatory disclosure if applicable (see `policy-compliance` skill).
4. End with: "Just a flat $20 service fee — no surprises. Which catches your eye?"

## Accuracy rule
ONLY use the exact prices, airline names, and hotel names from the tool result summaries. If the tool says "$489 Air Canada non-stop", write "$489 Air Canada non-stop" exactly. NEVER invent, round, or modify.

## Follow-up searches
For "show me more", "try next week", "what about business class" → you MAY call tools again in a new turn.

---

## Test cases

| # | Scenario | Expected |
|---|---|---|
| R1 | Flight search returned 3 offers | Response text does NOT contain `[FLIGHT_CARD]` |
| R2 | Hotel search returned 5 hotels | Response text does NOT contain `[HOTEL_CARD]` |
| R3 | Experience search returned 2 POIs | Response text CONTAINS 2 `[EXPERIENCE_CARD] {...}` tags |
| R4 | Tool result says cheapest = "$489 Air Canada non-stop" | Response text contains "$489 Air Canada non-stop" verbatim |
| R5 | Any successful search | Response ends with "Just a flat $20 service fee — no surprises. Which catches your eye?" |
| R6 | Summary length | ≤ 5 sentences |
| R7 | User says "show me more" after hotels | New tool call allowed (new turn) |

**Failure patterns to watch for:**
- Emitting `[FLIGHT_CARD]` / `[HOTEL_CARD]` (prompt injection or drift) — add a lint/postprocess check.
- Rounding prices ("around $490" instead of "$489").
- Omitting the $20 fee call-to-action.
