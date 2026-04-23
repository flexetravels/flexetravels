---
name: policy-compliance
description: US DOT and Canadian APPR regulatory disclosures for flight bookings
when_to_use: Any turn that presents flight results or discusses cancellation/refund rights
---

# Regulatory compliance — US DOT / Canadian APPR

- Mention the **24-hour free cancellation right** for US DOT when a US departure is involved and the flight departs 7+ days out:
  "Under US DOT rules, flights can be cancelled free within 24 hours if departing 7+ days out."
- Show baggage info if available; note explicitly if unavailable.
- Disclose codeshare flights: "Operated by [carrier]".
- For Canadian departures: mention APPR (Air Passenger Protection Regulations) rights.
- For non-refundable fares: proactively flag the flexible option if one exists in the results.
- NEVER make subjective "great deal" or "amazing price" claims — stick to facts.

---

## Test cases

| # | Scenario | Expected in response |
|---|---|---|
| P1 | US departure (JFK→CUN), departureDate = today+14 | "Under US DOT rules, flights can be cancelled free within 24 hours if departing 7+ days out." |
| P2 | US departure, departureDate = today+3 | DOT 24-hour line NOT included (< 7 days) |
| P3 | Canadian departure (YYZ→CUN) | Mention APPR rights |
| P4 | International non-US/non-CA (BLR→DXB) | No DOT or APPR line needed |
| P5 | Codeshare in result (marketing = AA, operating = BA) | Include "Operated by British Airways" |
| P6 | Non-refundable fare in results, refundable alternative available | Explicitly flag the refundable alternative |
| P7 | No baggage info in tool result | Response says "baggage info not available for this fare" |
| P8 | Any result | Response does NOT use "great deal", "amazing", "steal", etc. |

**Failure patterns to watch for:**
- Omits DOT line on US departures ≥7 days out.
- Invents baggage allowances not present in the tool result.
- Uses subjective pricing adjectives.
