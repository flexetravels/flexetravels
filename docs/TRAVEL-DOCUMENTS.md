# Travel Documents And Transit Filtering

FlexeTravels collects only non-sensitive travel eligibility data on the Trip Canvas:

- passport country, such as `IN` for India
- countries/areas where the traveller already has valid visa, transit, residency, or entry status

Passport numbers, dates of birth, and document images are not collected in chat or on the canvas. They remain in secure checkout only.

## Current Filtering Behavior

Flight search accepts `transitProfile` and filters known blocked transit routings before options are shown.

Examples:

- `passportCountry=IN` with no `US` status filters out routings that transit through U.S. airports such as `SEA`, `JFK`, `ORD`, `SFO`, and `LAX`.
- `passportCountry=IN` with no `CA` status filters out routings that transit through Canadian airports such as `YVR`, `YYZ`, `YUL`, and `YYC`.
- UK and Schengen transit situations are treated as review-risk rather than hard blocks because exemptions depend on border-control handling, airline, destination permission, and other visas/residence permits.

## Source Policy

Rules are intentionally conservative and point to official government sources:

- United States Transit Visa: https://travel.state.gov/content/travel/en/us-visas/other-visa-categories/transit.html
- Canada Transit Visa: https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/transit.html
- UK Transit Visa: https://www.gov.uk/transit-visa
- EU Schengen Visa Policy: https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa/visa-policy/applying-schengen-visa_en

## Production Upgrade

For OTA-grade go-live, replace or augment the conservative rule file with a licensed travel-document provider such as Timatic, Sherpa, or TravelDoc. Government rules change often; a live document provider should be the final source of truth before booking.

