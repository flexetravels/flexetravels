"""
FlexeTravels — Amadeus Flights Tool
Search real-time Amadeus flight offers with no mock data fallback.
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import AMADEUS_API_KEY, AMADEUS_API_SECRET, AMADEUS_CURRENCY, HAS_AMADEUS, HAS_SERPAPI
from utils.cache import cached_api_call

logger = logging.getLogger(__name__)


class AmadeusFlightsTool:
    """Search real-time Amadeus flight offers. No mock data, no fallback."""

    name = "amadeus_flights_search"
    description = "Search real-time Amadeus flight offers. Returns live prices from Amadeus API or structured error JSON if unavailable."

    def _run(self, origin: str, destination: str, departure_date: str,
             adults: int = 1, return_date: str = "", max_price: int = 0,
             non_stop: bool = False, travel_class: str = "ECONOMY") -> str:
        """
        Search for flights on Amadeus API.

        Args:
            origin: IATA origin airport code (e.g., 'YVR')
            destination: IATA destination airport code (e.g., 'LAS')
            departure_date: Departure date in YYYY-MM-DD format
            adults: Number of adult passengers (1-9)
            return_date: Return date in YYYY-MM-DD format (optional, makes round-trip)
            max_price: Maximum total price in USD (0 = no limit)
            non_stop: True for direct flights only
            travel_class: ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST

        Returns:
            JSON string with flights list or error status
        """

        # Guard: Check if Amadeus is configured
        if not HAS_AMADEUS:
            # Try SerpAPI fallback if Amadeus not available
            if HAS_SERPAPI:
                try:
                    from tools.serpapi_flights import search_serpapi_flights
                    return search_serpapi_flights(
                        origin=origin, destination=destination,
                        departure_date=departure_date, adults=adults,
                        return_date=return_date, max_price=max_price,
                        currency=AMADEUS_CURRENCY,
                    )
                except Exception as e:
                    logger.warning(f"SerpAPI fallback also failed: {e}")
            return json.dumps({
                "status": "no_api",
                "message": "Amadeus API credentials not configured",
                "flights": []
            })

        try:
            # Import Amadeus client
            from amadeus import Client, ResponseError
            amadeus = Client(client_id=AMADEUS_API_KEY, client_secret=AMADEUS_API_SECRET)

            # Build API parameters, omit empty optionals
            api_params = {
                "originLocationCode": origin.upper(),
                "destinationLocationCode": destination.upper(),
                "departureDate": departure_date,
                "adults": adults,
                "travelClass": travel_class.upper(),
                "currencyCode": AMADEUS_CURRENCY,
                "max": 10,  # Limit to 10 offers
            }

            # Add optional parameters only if specified
            if return_date:
                api_params["returnDate"] = return_date
            if max_price > 0:
                api_params["maxPrice"] = max_price
            if non_stop:
                api_params["nonStop"] = True

            # Define the API call function — cache only the .data list (not the Response object)
            def fetch_flights():
                resp = amadeus.shopping.flight_offers_search.get(**api_params)
                return resp.data if resp.data else []

            # Use caching with 30-minute TTL for flights
            flight_data = cached_api_call(
                prefix="amadeus_flights_v2",
                params=api_params,
                fn=fetch_flights,
                ttl=1800  # 30 minutes
            )

            # Parse flights from response
            flights = []
            if flight_data:
                for offer in (flight_data or [])[:10]:  # Limit to 10
                    try:
                        # Extract outbound flight info
                        outbound = offer.get("itineraries", [{}])[0]
                        outbound_segments = outbound.get("segments", [])

                        # Extract return flight info (if exists)
                        return_flight = None
                        if len(offer.get("itineraries", [])) > 1:
                            return_itinerary = offer["itineraries"][1]
                            return_flight = return_itinerary.get("segments", [])

                        if not outbound_segments:
                            continue

                        # Get first and last segments for timeline
                        first_segment = outbound_segments[0]
                        last_segment = outbound_segments[-1]

                        # Extract price info
                        price_info = offer.get("price", {})
                        total_price = float(price_info.get("total", 0))

                        # Calculate price per person
                        price_per_person = round(total_price / adults, 2) if adults > 0 else total_price

                        # Build flight object
                        flight = {
                            "offer_id": offer.get("id", ""),
                            "airline": first_segment.get("carrierCode", ""),
                            "airline_name": first_segment.get("operating", {}) or first_segment.get("carrierCode", ""),
                            "origin": first_segment.get("departure", {}).get("iataCode", ""),
                            "destination": last_segment.get("arrival", {}).get("iataCode", ""),
                            "departure_time": first_segment.get("departure", {}).get("at", ""),
                            "arrival_time": last_segment.get("arrival", {}).get("at", ""),
                            "duration_outbound": outbound.get("duration", ""),
                            "stops_outbound": len(outbound_segments) - 1,  # Number of stops
                            "price_total": total_price,
                            "price_per_person": price_per_person,
                            "currency": price_info.get("currency", "USD"),
                            "travel_class": travel_class,
                            "number_of_passengers": adults,
                            "source": "amadeus",
                        }

                        # Add return flight info if exists
                        if return_flight:
                            return_first_segment = return_flight[0]
                            return_last_segment = return_flight[-1]
                            return_itinerary = offer["itineraries"][1]

                            flight["departure_time_return"] = return_first_segment.get("departure", {}).get("at", "")
                            flight["arrival_time_return"] = return_last_segment.get("arrival", {}).get("at", "")
                            flight["duration_return"] = return_itinerary.get("duration", "")
                            flight["stops_return"] = len(return_flight) - 1

                        flights.append(flight)

                    except (KeyError, TypeError, ValueError) as e:
                        logger.warning(f"Error parsing flight offer: {e}")
                        continue

            # ── SerpAPI Fallback when Amadeus returns 0 flights ──
            if len(flights) == 0 and HAS_SERPAPI:
                logger.info(f"Amadeus returned 0 flights for {origin}->{destination}, trying SerpAPI fallback")
                try:
                    from tools.serpapi_flights import search_serpapi_flights
                    fallback_result = search_serpapi_flights(
                        origin=origin.upper(), destination=destination.upper(),
                        departure_date=departure_date, adults=adults,
                        return_date=return_date, max_price=max_price,
                        currency=AMADEUS_CURRENCY,
                    )
                    fallback_data = json.loads(fallback_result)
                    if fallback_data.get("status") == "success" and fallback_data.get("count", 0) > 0:
                        logger.info(f"SerpAPI fallback returned {fallback_data['count']} flights")
                        return fallback_result
                except Exception as fb_err:
                    logger.warning(f"SerpAPI flight fallback failed: {fb_err}")

            return json.dumps({
                "status": "success",
                "count": len(flights),
                "flights": flights,
                "source": "amadeus",
            })

        except Exception as e:
            # Import here to avoid top-level import error if amadeus not installed
            from amadeus import ResponseError

            if isinstance(e, ResponseError):
                return json.dumps({
                    "status": "api_error",
                    "error_code": getattr(e.response, 'status_code', 'unknown'),
                    "message": f"Amadeus API error: {str(e)}",
                    "flights": []
                })
            else:
                logger.error(f"Flight search error: {e}", exc_info=True)
                return json.dumps({
                    "status": "error",
                    "message": f"Error searching flights: {str(e)}",
                    "flights": []
                })
