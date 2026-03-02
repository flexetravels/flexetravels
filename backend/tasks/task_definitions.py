"""
FlexeTravels — Task Definitions (Legacy Reference)
The pipeline now uses Claude AI agents directly via the TravelOrchestrator.
This file is kept as documentation of the task flow.

Pipeline Steps:
1. Parse & validate user travel request
2. Search flights (Amadeus API)
3. Search hotels (Amadeus API)
4. Find attractions (Serper/Google Maps)
5. Create 1-3 travel packages with itineraries
6. [CHECKPOINT] User approves a package
7. Process payment (Stripe)
8. Book flights & hotels (Amadeus)
9. Send confirmation email (Mailchimp)
10. Schedule social media post (Buffer)
"""
