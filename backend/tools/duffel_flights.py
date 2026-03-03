"""
FlexeTravels — Duffel Flights API Tool
Real-time flight search and booking via Duffel API.
Falls back to Amadeus if Duffel unavailable.
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, List

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

import requests
from config import DUFFEL_API_KEY, HAS_DUFFEL
from utils.cache import cached_api_call

logger = logging.getLogger(__name__)

# Duffel API base URL (Production)
DUFFEL_BASE_URL = "https://api.duffel.com"

# Test card numbers for sandbox testing
TEST_CARD_VISA = "4242424242424242"


class DuffelFlightsTool:
    """Search flights using Duffel API."""

    name = "duffel_flights_search"
    description = "Search real-time flight offers via Duffel API with global airline coverage."

    def __init__(self):
        self.api_key = DUFFEL_API_KEY
        self.base_url = DUFFEL_BASE_URL
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Duffel-Version": "v2",
            "Accept-Encoding": "gzip",
            "User-Agent": "FlexeTravels/1.0",
            "Content-Type": "application/json",
        }

    def _run(
        self,
        origin: str,
        destination: str,
        departure_date: str,
        adults: int = 1,
        return_date: str = "",
        max_price: int = 0,
        non_stop: bool = False,
        travel_class: str = "economy",
    ) -> str:
        """
        Search for flights on Duffel API.

        Args:
            origin: IATA airport code (e.g., YVR, JFK)
            destination: IATA airport code (e.g., LAS, NRT)
            departure_date: YYYY-MM-DD format
            adults: Number of adult passengers (1-9)
            return_date: YYYY-MM-DD format (optional for round-trip)
            max_price: Maximum total price in USD (0 = no limit)
            non_stop: True for direct flights only
            travel_class: economy, premium_economy, business, first

        Returns:
            JSON string with flights list or error status
        """

        if not HAS_DUFFEL:
            return json.dumps({
                "status": "no_api",
                "message": "Duffel API credentials not configured",
                "flights": [],
            })

        try:
            # Build slices (flight segments) - v2 API format
            slices = [
                {
                    "origin": origin.upper(),
                    "destination": destination.upper(),
                    "departure_date": departure_date,
                }
            ]

            # Add return flight if provided
            if return_date:
                slices.append({
                    "origin": destination.upper(),
                    "destination": origin.upper(),
                    "departure_date": return_date,
                })

            # Build passengers array (v2 API requires this)
            passengers = [{"type": "adult"} for _ in range(adults)]

            # Create offer request
            offer_request_payload = {
                "data": {
                    "slices": slices,
                    "passengers": passengers,
                }
            }

            # Add cabin class if specified (optional)
            if travel_class and travel_class.lower() != "economy":
                offer_request_payload["data"]["cabin_class"] = travel_class.lower()

            cache_params = {
                "origin": origin.upper(),
                "destination": destination.upper(),
                "departure_date": departure_date,
                "return_date": return_date,
                "adults": adults,
            }

            # Try cached result first
            cached = cached_api_call(
                prefix="duffel_flights",
                params=cache_params,
                fn=lambda: self._fetch_offers(offer_request_payload),
                ttl=3600,  # 1 hour cache
            )

            if cached and cached.get("status") == "success":
                return json.dumps(cached)

            # If no cache or failed, try fetch
            result = self._fetch_offers(offer_request_payload)
            return json.dumps(result)

        except Exception as e:
            logger.error(f"Duffel flight search error: {e}", exc_info=True)
            return json.dumps({
                "status": "error",
                "message": f"Error searching flights: {str(e)}",
                "flights": [],
            })

    def _fetch_offers(self, payload: dict) -> dict:
        """Fetch flight offers from Duffel API."""
        try:
            # Create offer request
            response = requests.post(
                f"{self.base_url}/air/offer_requests",
                json=payload,
                headers=self.headers,
                timeout=15,
            )

            if response.status_code != 201:
                logger.warning(
                    f"Duffel offer request failed: {response.status_code} - {response.text[:200]}"
                )
                return {
                    "status": "api_error",
                    "error_code": response.status_code,
                    "message": f"Duffel API error: {response.status_code}",
                    "flights": [],
                }

            offer_request_data = response.json().get("data", {})
            offer_request_id = offer_request_data.get("id")

            if not offer_request_id:
                return {
                    "status": "no_offers",
                    "message": "No flight offers available",
                    "flights": [],
                }

            # Fetch the actual offers (they're returned in the offer_request response)
            offers = offer_request_data.get("offers", [])

            if not offers:
                return {
                    "status": "no_offers",
                    "message": "No flight offers returned",
                    "flights": [],
                }

            # Parse offers
            flights = self._parse_offers(offers)

            return {
                "status": "success",
                "count": len(flights),
                "flights": flights,
                "source": "duffel",
            }

        except requests.exceptions.Timeout:
            return {
                "status": "timeout",
                "message": "Duffel API request timed out",
                "flights": [],
            }
        except Exception as e:
            logger.error(f"Duffel fetch offers error: {e}")
            return {
                "status": "error",
                "message": str(e),
                "flights": [],
            }

    def _parse_offers(self, offers: List[dict]) -> List[dict]:
        """Parse Duffel offer response to standard format."""
        flights = []

        for offer in offers[:10]:  # Limit to 10 results
            try:
                offer_id = offer.get("id", "")
                slices = offer.get("slices", [])
                price_data = offer.get("total_amount")
                price_currency = offer.get("total_currency", "USD")

                if not slices:
                    continue

                # For round-trip, we have 2 slices. For one-way, just 1.
                outbound_slice = slices[0] if len(slices) > 0 else None
                return_slice = slices[1] if len(slices) > 1 else None

                if not outbound_slice:
                    continue

                # Parse outbound flight
                outbound_segments = outbound_slice.get("segments", [])
                if not outbound_segments:
                    continue

                outbound_seg = outbound_segments[0]
                airline = outbound_seg.get("operating_airline", {})
                airline_name = airline.get("name", "Unknown")
                airline_code = airline.get("iata_code", "")

                # Build flight object
                flight = {
                    "offer_id": offer_id,
                    "airline": airline_code,
                    "airline_name": airline_name,
                    "origin": outbound_seg.get("origin", {}).get("iata_code", ""),
                    "destination": outbound_seg.get("destination", {}).get("iata_code", ""),
                    "departure_time": outbound_seg.get("departing_at", ""),
                    "arrival_time": outbound_seg.get("arriving_at", ""),
                    "stops_outbound": len(outbound_segments) - 1,
                    "duration_outbound": outbound_slice.get("duration", ""),
                    "price_total": float(price_data) if price_data else 0,
                    "price_per_person": float(price_data) / (offer.get("passengers_count", 1)) if price_data else 0,
                    "currency": price_currency,
                    "travel_class": offer.get("cabin_class", "economy").lower(),
                    "number_of_passengers": offer.get("passengers_count", 1),
                    "source": "duffel",
                }

                # Add return flight info if available
                if return_slice:
                    return_segments = return_slice.get("segments", [])
                    if return_segments:
                        return_seg = return_segments[0]
                        flight["departure_time_return"] = return_seg.get("departing_at", "")
                        flight["arrival_time_return"] = return_seg.get("arriving_at", "")
                        flight["stops_return"] = len(return_segments) - 1
                        flight["duration_return"] = return_slice.get("duration", "")

                flights.append(flight)

            except (KeyError, TypeError, ValueError) as e:
                logger.warning(f"Error parsing Duffel offer: {e}")
                continue

        return flights


# Factory function for easy integration
def get_duffel_flights_tool() -> DuffelFlightsTool:
    """Get Duffel flights tool instance."""
    return DuffelFlightsTool()
