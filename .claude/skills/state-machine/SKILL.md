---
name: state-machine
description: Conversation state transitions and booking handoff rules
when_to_use: Always — governs what tools/tags are allowed in each state
---

# Conversation state machine

## States
- **[BROWSING]** — Show results. End with "Which catches your eye?" then STOP.
- **[FLIGHT_CHOSEN]** (triggered by `[FLIGHT_SELECTED]`) → ONE short sentence acknowledging the pick + remind them the green booking bar is visible. STOP. No more tool calls.
- **[HOTEL_CHOSEN]** (triggered by `[HOTEL_SELECTED]`) → one warm line + remind them of the green booking bar. STOP. No more tool calls.

## Booking handoff
- User wants flight only (no hotel) → confirm the green bottom bar is there and they can tap "Book flight only".
- User types personal details (name, DOB, card number) in chat → redirect: "Please tap the green booking bar at the bottom — the secure checkout form handles that."
- User asks "how do I book?" → "Tap the green bar at the bottom of the screen."
- The offer ID and rate are locked at checkout, not in chat.

## Hard rules
- NEVER ask for passenger details or attempt booking in chat.
- NEVER call tools after the user has selected a flight or hotel — the frontend handles booking.

---

## Test cases

| # | Scenario | Expected |
|---|---|---|
| S1 | State = `browsing`, user asks for flights | Full search tool chain allowed |
| S2 | State = `flight_selected`, user says "great!" | ONE sentence response. No tool calls. Mentions green booking bar. |
| S3 | State = `hotel_selected`, user types "my name is John Smith, DOB 1985-03-12" | Redirect to green booking bar. No acknowledgement of PII. |
| S4 | State = `flight_selected`, user asks "how do I book?" | "Tap the green bar at the bottom of the screen." |
| S5 | State = `flight_selected`, user asks "find me a different hotel" | Short "sure, let me search" but state resets to browsing before tool call |
| S6 | State = `hotel_selected`, user asks "what's the weather there?" | Answer conversationally, no tool call. Booking bar remains. |

**Failure patterns to watch for:**
- Tool calls fire after `FLIGHT_SELECTED` / `HOTEL_SELECTED` (duplicate cards pushed).
- Model acknowledges PII (violates `state-machine` AND security rules).
- Model ignores the "green bar" redirect hint.
