"""
FlexeTravels — Amadeus Flight & Hotel Search Tool
Searches for flights and hotels via the Amadeus API.
Falls back to curated mock data when API keys are not configured.
"""

import json
from tenacity import retry, stop_after_attempt, wait_exponential

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import AMADEUS_API_KEY, AMADEUS_API_SECRET, AMADEUS_CURRENCY, HAS_AMADEUS, MAX_RETRIES, RETRY_DELAY, RETRY_MAX_DELAY
from utils.cache import cached_api_call


class AmadeusSearchTool:
    name: str = "amadeus_search"
    description: str = (
        "Search for flights and hotels using the Amadeus travel API. "
        "Arguments: search_type ('flights' or 'hotels'), origin (for flights), "
        "destination, departure_date, return_date, adults, budget_max, check_in_date, check_out_date."
    )

    def _run(self, search_type: str = "flights", origin: str = "", destination: str = "",
             departure_date: str = "", return_date: str = "", adults: int = 1,
             check_in_date: str = "", check_out_date: str = "") -> str:
        """Execute the search for flights or hotels."""
        params = {k: v for k, v in {
            "origin": origin, "destination": destination,
            "departure_date": departure_date, "return_date": return_date,
            "adults": adults, "check_in_date": check_in_date, "check_out_date": check_out_date
        }.items() if v}

        if HAS_AMADEUS:
            try:
                result = cached_api_call(
                    prefix=f"amadeus_{search_type}",
                    params=params,
                    fn=lambda: self._live_search(search_type, params),
                    ttl=1800,  # 30 min cache for travel searches
                )
                return json.dumps(result, indent=2)
            except Exception as e:
                return json.dumps({
                    "status": "error",
                    "message": f"Amadeus API error: {str(e)}. Using mock data.",
                    "results": self._mock_results(search_type, params)
                }, indent=2)
        else:
            return json.dumps({
                "status": "mock",
                "message": "Amadeus API not configured. Returning curated mock data.",
                "results": self._mock_results(search_type, params)
            }, indent=2)

    @retry(stop=stop_after_attempt(MAX_RETRIES), wait=wait_exponential(multiplier=RETRY_DELAY, max=RETRY_MAX_DELAY))
    def _live_search(self, search_type: str, params: dict) -> dict:
        """Execute a live Amadeus API search with retry."""
        from amadeus import Client, ResponseError

        amadeus = Client(
            client_id=AMADEUS_API_KEY,
            client_secret=AMADEUS_API_SECRET,
        )

        if search_type == "flights":
            response = amadeus.shopping.flight_offers_search.get(
                originLocationCode=params.get("origin", ""),
                destinationLocationCode=params.get("destination", ""),
                departureDate=params.get("departure_date", ""),
                returnDate=params.get("return_date", ""),
                adults=params.get("adults", 1),
                currencyCode=AMADEUS_CURRENCY,
                max=5,
            )
            flights = []
            for offer in response.data[:5]:
                segments = offer["itineraries"][0]["segments"]
                flights.append({
                    "airline": segments[0].get("carrierCode", ""),
                    "departure": segments[0].get("departure", {}).get("iataCode", ""),
                    "arrival": segments[-1].get("arrival", {}).get("iataCode", ""),
                    "departure_time": segments[0].get("departure", {}).get("at", ""),
                    "arrival_time": segments[-1].get("arrival", {}).get("at", ""),
                    "duration": offer["itineraries"][0].get("duration", ""),
                    "price": float(offer["price"]["total"]),
                    "currency": offer["price"]["currency"],
                    "stops": len(segments) - 1,
                    "offer_id": offer["id"],
                })
            return {"flights": flights}

        elif search_type == "hotels":
            response = amadeus.reference_data.locations.hotels.by_city.get(
                cityCode=params.get("destination", "")[:3].upper()
            )
            hotels = []
            for hotel in response.data[:5]:
                hotels.append({
                    "name": hotel.get("name", ""),
                    "hotel_id": hotel.get("hotelId", ""),
                    "location": f"{hotel.get('address', {}).get('cityName', '')}",
                    "rating": hotel.get("rating", 0),
                })
            return {"hotels": hotels}

        return {"error": f"Unknown search type: {search_type}"}

    def _mock_results(self, search_type: str, params: dict) -> dict:
        """Return realistic mock data for demo/testing."""
        dest = params.get("destination", "TYO")
        adults = params.get("adults", 1)

        if search_type == "flights":
            return {"flights": [
                {
                    "airline": "ANA (All Nippon Airways)",
                    "departure": params.get("origin", "JFK"),
                    "arrival": dest,
                    "departure_time": f"{params.get('departure_date', '2026-04-01')}T10:30:00",
                    "arrival_time": f"{params.get('departure_date', '2026-04-01')}T14:45:00+1",
                    "duration": "PT14H15M",
                    "price": 850.00 * adults,
                    "currency": "USD",
                    "stops": 0,
                    "booking_class": "Economy",
                    "offer_id": "MOCK-FL-001"
                },
                {
                    "airline": "Japan Airlines",
                    "departure": params.get("origin", "JFK"),
                    "arrival": dest,
                    "departure_time": f"{params.get('departure_date', '2026-04-01')}T13:00:00",
                    "arrival_time": f"{params.get('departure_date', '2026-04-01')}T16:30:00+1",
                    "duration": "PT13H30M",
                    "price": 920.00 * adults,
                    "currency": "USD",
                    "stops": 0,
                    "booking_class": "Economy",
                    "offer_id": "MOCK-FL-002"
                },
                {
                    "airline": "United Airlines",
                    "departure": params.get("origin", "JFK"),
                    "arrival": dest,
                    "departure_time": f"{params.get('departure_date', '2026-04-01')}T22:00:00",
                    "arrival_time": f"{params.get('departure_date', '2026-04-02')}T03:15:00+1",
                    "duration": "PT15H15M",
                    "price": 720.00 * adults,
                    "currency": "USD",
                    "stops": 1,
                    "booking_class": "Economy",
                    "offer_id": "MOCK-FL-003"
                },
            ]}
        else:
            return {"hotels": [
                {
                    "name": "Hotel Gracery Shinjuku",
                    "location": dest,
                    "rating": 4.5,
                    "price_per_night": 120.00,
                    "amenities": ["WiFi", "Restaurant", "Fitness Center", "City View"],
                    "offer_id": "MOCK-HT-001"
                },
                {
                    "name": "The Prince Park Tower",
                    "location": dest,
                    "rating": 4.7,
                    "price_per_night": 195.00,
                    "amenities": ["WiFi", "Pool", "Spa", "Restaurant", "Bar", "Concierge"],
                    "offer_id": "MOCK-HT-002"
                },
                {
                    "name": "Sakura Ryokan Traditional Inn",
                    "location": dest,
                    "rating": 4.8,
                    "price_per_night": 250.00,
                    "amenities": ["WiFi", "Onsen", "Traditional Breakfast", "Yukata", "Garden"],
                    "offer_id": "MOCK-HT-003"
                },
            ]}
