"""
FlexeTravels — SerpAPI Google Flights Fallback
Searches Google Flights via SerpAPI when Amadeus returns 0 results.
Returns data in the same JSON format as AmadeusFlightsTool.
"""

import json
import logging
import re
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import SERPAPI_API_KEY, HAS_SERPAPI, AMADEUS_CURRENCY
from utils.cache import cached_api_call

logger = logging.getLogger(__name__)


def search_serpapi_flights(
    origin: str,
    destination: str,
    departure_date: str,
    adults: int = 1,
    return_date: str = "",
    max_price: int = 0,
    currency: str = "USD",
) -> str:
    """
    Search Google Flights via SerpAPI. Returns JSON string matching Amadeus format.

    Args:
        origin: IATA airport code (e.g., 'YVR')
        destination: IATA airport code (e.g., 'AUS')
        departure_date: YYYY-MM-DD
        adults: Number of passengers
        return_date: YYYY-MM-DD (optional, for round-trip)
        max_price: Max total price filter (0 = no limit)
        currency: Currency code (default USD)

    Returns:
        JSON string with flights list in Amadeus-compatible format
    """
    if not HAS_SERPAPI:
        return json.dumps({
            "status": "no_api",
            "message": "SerpAPI not configured (SERPAPI_API_KEY missing)",
            "flights": []
        })

    try:
        from serpapi import GoogleSearch

        params = {
            "engine": "google_flights",
            "departure_id": origin.upper(),
            "arrival_id": destination.upper(),
            "outbound_date": departure_date,
            "currency": currency,
            "hl": "en",
            "api_key": SERPAPI_API_KEY,
        }

        # Round-trip vs one-way
        if return_date:
            params["return_date"] = return_date
            params["type"] = "1"  # round-trip
        else:
            params["type"] = "2"  # one-way

        def fetch():
            search = GoogleSearch(params)
            return search.get_dict()

        # Cache with 1-hour TTL to save API quota
        cache_params = {
            "src": "serpapi_gf",
            "origin": origin.upper(),
            "dest": destination.upper(),
            "depart": departure_date,
            "return": return_date,
            "adults": adults,
        }

        raw = cached_api_call(
            prefix="serpapi_flights",
            params=cache_params,
            fn=fetch,
            ttl=3600,  # 1 hour
        )

        # Check for SerpAPI errors
        if raw.get("error"):
            return json.dumps({
                "status": "api_error",
                "message": f"SerpAPI error: {raw['error']}",
                "flights": []
            })

        # Transform SerpAPI response to Amadeus format
        flights = []
        all_flights = raw.get("best_flights", []) + raw.get("other_flights", [])

        for group in all_flights:
            try:
                segments = group.get("flights", [])
                if not segments:
                    continue

                first_seg = segments[0]
                last_seg = segments[-1]

                # Extract price
                price_total = group.get("price", 0)
                if not price_total:
                    continue
                price_total = float(price_total)

                # Budget filter
                if max_price > 0 and price_total > max_price:
                    continue

                # SerpAPI price is per-person already for Google Flights
                price_per_person = price_total
                price_total_all = round(price_total * adults, 2)

                # Build duration in ISO 8601 format (PT#H#M)
                total_duration = group.get("total_duration", 0)  # in minutes
                hours = total_duration // 60
                minutes = total_duration % 60
                duration_iso = f"PT{hours}H{minutes}M" if total_duration else ""

                # Build departure/arrival datetimes
                dep_airport = first_seg.get("departure_airport", {})
                arr_airport = last_seg.get("arrival_airport", {})

                dep_datetime = _build_datetime(departure_date, dep_airport.get("time", ""))
                arr_datetime = _build_datetime(departure_date, arr_airport.get("time", ""))

                flight = {
                    "offer_id": "",
                    "airline": first_seg.get("airline", ""),
                    "airline_name": first_seg.get("airline", ""),
                    "flight_number": first_seg.get("flight_number", ""),
                    "origin": dep_airport.get("id", origin.upper()),
                    "destination": arr_airport.get("id", destination.upper()),
                    "departure_time": dep_datetime,
                    "arrival_time": arr_datetime,
                    "duration_outbound": duration_iso,
                    "stops_outbound": len(segments) - 1,
                    "price_total": price_total_all,
                    "price_per_person": price_per_person,
                    "currency": currency,
                    "travel_class": "ECONOMY",
                    "number_of_passengers": adults,
                    "source": "google_flights",
                }

                # Add layover info if present
                layovers = group.get("layovers", [])
                if layovers:
                    flight["layover_info"] = ", ".join(
                        f"{l.get('name', '?')} ({l.get('duration', 0)}min)"
                        for l in layovers
                    )

                flights.append(flight)

            except (KeyError, TypeError, ValueError) as e:
                logger.warning(f"Error parsing SerpAPI flight: {e}")
                continue

        # Limit to 10 results
        flights = flights[:10]

        if not flights:
            return json.dumps({
                "status": "no_results",
                "message": f"No flights found on Google Flights for {origin}->{destination}",
                "flights": [],
                "source": "google_flights",
            })

        return json.dumps({
            "status": "success",
            "count": len(flights),
            "flights": flights,
            "source": "google_flights",
        })

    except Exception as e:
        logger.error(f"SerpAPI flights error: {e}", exc_info=True)
        return json.dumps({
            "status": "error",
            "message": f"Google Flights search error: {str(e)}",
            "flights": []
        })


def _build_datetime(date_str: str, time_str: str) -> str:
    """Combine date 'YYYY-MM-DD' and SerpAPI time into ISO datetime string."""
    if not time_str:
        return date_str
    time_str = time_str.strip()

    # SerpAPI typically returns 24h format like "10:00" or "14:30"
    match_24 = re.match(r"^(\d{1,2}):(\d{2})$", time_str)
    if match_24:
        return f"{date_str}T{int(match_24.group(1)):02d}:{match_24.group(2)}"

    # 12h format: "2:30 PM"
    match_12 = re.match(r"^(\d{1,2}):(\d{2})\s*(AM|PM)$", time_str, re.IGNORECASE)
    if match_12:
        hour = int(match_12.group(1))
        minute = match_12.group(2)
        period = match_12.group(3).upper()
        if period == "PM" and hour != 12:
            hour += 12
        elif period == "AM" and hour == 12:
            hour = 0
        return f"{date_str}T{hour:02d}:{minute}"

    # Fallback
    return f"{date_str}T{time_str}"
