"""
FlexeTravels — SerpAPI Google Hotels Fallback
Searches Google Hotels via SerpAPI when Amadeus returns 0 results.
Returns data in the same JSON format as AmadeusHotelsTool.
"""

import json
import logging
import re
from datetime import datetime
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import SERPAPI_API_KEY, HAS_SERPAPI, AMADEUS_CURRENCY
from utils.cache import cached_api_call

logger = logging.getLogger(__name__)

# IATA city/airport code → city name mapping for Google Hotels search
# SerpAPI Google Hotels uses city names (q param), not IATA codes
CITY_CODE_MAP = {
    # US Cities
    "LAS": "Las Vegas", "AUS": "Austin", "SFO": "San Francisco",
    "NYC": "New York", "JFK": "New York", "EWR": "New York",
    "LAX": "Los Angeles", "MIA": "Miami", "ORD": "Chicago",
    "DFW": "Dallas", "SEA": "Seattle", "BOS": "Boston",
    "DEN": "Denver", "ATL": "Atlanta", "MSP": "Minneapolis",
    "PHL": "Philadelphia", "IAH": "Houston", "HOU": "Houston",
    "PHX": "Phoenix", "SAN": "San Diego", "TPA": "Tampa",
    "MCO": "Orlando", "DTW": "Detroit", "CLT": "Charlotte",
    "SLC": "Salt Lake City", "PDX": "Portland", "CMH": "Columbus",
    "IND": "Indianapolis", "BNA": "Nashville", "RDU": "Raleigh",
    "OAK": "Oakland", "HNL": "Honolulu",
    # Canada
    "YVR": "Vancouver", "YYZ": "Toronto", "YUL": "Montreal",
    "YYC": "Calgary", "YOW": "Ottawa",
    # Europe
    "PAR": "Paris", "CDG": "Paris", "ORY": "Paris",
    "LON": "London", "LHR": "London", "LGW": "London",
    "FCO": "Rome", "BCN": "Barcelona", "MAD": "Madrid",
    "AMS": "Amsterdam", "FRA": "Frankfurt", "MUC": "Munich",
    "ZRH": "Zurich", "VIE": "Vienna", "PRG": "Prague",
    "LIS": "Lisbon", "ATH": "Athens", "IST": "Istanbul",
    "CPH": "Copenhagen", "OSL": "Oslo", "HEL": "Helsinki",
    "DUB": "Dublin", "EDI": "Edinburgh",
    # Asia
    "NRT": "Tokyo", "HND": "Tokyo", "TYO": "Tokyo",
    "ICN": "Seoul", "PEK": "Beijing", "PVG": "Shanghai",
    "HKG": "Hong Kong", "SIN": "Singapore", "BKK": "Bangkok",
    "KUL": "Kuala Lumpur", "DEL": "New Delhi", "BOM": "Mumbai",
    "TPE": "Taipei", "MNL": "Manila",
    # Middle East
    "DXB": "Dubai", "DOH": "Doha", "AUH": "Abu Dhabi",
    # Oceania
    "SYD": "Sydney", "MEL": "Melbourne", "AKL": "Auckland",
    # Latin America
    "CUN": "Cancun", "MEX": "Mexico City", "GRU": "Sao Paulo",
    "EZE": "Buenos Aires", "BOG": "Bogota", "LIM": "Lima",
    "SCL": "Santiago",
    # Beach/Resort
    "DPS": "Bali", "MLE": "Maldives", "PUJ": "Punta Cana",
}


def search_serpapi_hotels(
    city_name: str,
    check_in_date: str,
    check_out_date: str,
    adults: int = 1,
    rooms: int = 1,
    max_price_per_night: int = 0,
    currency: str = "USD",
) -> str:
    """
    Search Google Hotels via SerpAPI. Returns JSON string matching Amadeus format.

    Args:
        city_name: City name or IATA code (e.g., 'Austin' or 'AUS')
        check_in_date: YYYY-MM-DD
        check_out_date: YYYY-MM-DD
        adults: Number of adults
        rooms: Number of rooms
        max_price_per_night: Max price per night filter (0 = no limit)
        currency: Currency code (default USD)

    Returns:
        JSON string with hotels list in Amadeus-compatible format
    """
    if not HAS_SERPAPI:
        return json.dumps({
            "status": "no_api",
            "message": "SerpAPI not configured (SERPAPI_API_KEY missing)",
            "hotels": []
        })

    try:
        from serpapi import GoogleSearch

        # Resolve IATA code to city name
        query = city_name
        if len(city_name) <= 3 and city_name.upper() in CITY_CODE_MAP:
            query = CITY_CODE_MAP[city_name.upper()]

        # Calculate nights
        check_in = datetime.strptime(check_in_date, "%Y-%m-%d")
        check_out = datetime.strptime(check_out_date, "%Y-%m-%d")
        nights = max((check_out - check_in).days, 1)

        params = {
            "engine": "google_hotels",
            "q": f"{query} hotels",
            "check_in_date": check_in_date,
            "check_out_date": check_out_date,
            "currency": currency,
            "hl": "en",
            "adults": adults,
            "api_key": SERPAPI_API_KEY,
        }

        def fetch():
            search = GoogleSearch(params)
            return search.get_dict()

        cache_params = {
            "src": "serpapi_gh",
            "city": query.lower(),
            "checkin": check_in_date,
            "checkout": check_out_date,
            "adults": adults,
        }

        raw = cached_api_call(
            prefix="serpapi_hotels",
            params=cache_params,
            fn=fetch,
            ttl=3600,  # 1 hour
        )

        # Check for SerpAPI errors
        if raw.get("error"):
            return json.dumps({
                "status": "api_error",
                "message": f"SerpAPI error: {raw['error']}",
                "hotels": []
            })

        # Transform SerpAPI response to Amadeus format
        hotels = []
        properties = raw.get("properties", [])

        for prop in properties[:20]:  # Limit to 20
            try:
                # Extract price per night
                rate = prop.get("rate_per_night", {})
                price_per_night = 0

                # Try extracted_lowest first (numeric field)
                extracted = rate.get("extracted_lowest")
                if extracted:
                    price_per_night = float(extracted)
                else:
                    # Parse string like "$125" or "125"
                    lowest_str = rate.get("lowest", "")
                    if isinstance(lowest_str, (int, float)):
                        price_per_night = float(lowest_str)
                    elif isinstance(lowest_str, str):
                        nums = re.findall(r"[\d,.]+", lowest_str)
                        if nums:
                            price_per_night = float(nums[0].replace(",", ""))

                if not price_per_night:
                    # Try total_rate as fallback
                    total_rate = prop.get("total_rate", {})
                    extracted_total = total_rate.get("extracted_lowest")
                    if extracted_total:
                        price_per_night = round(float(extracted_total) / nights, 2)

                if not price_per_night:
                    continue  # Skip hotels without price

                # Budget filter
                if max_price_per_night > 0 and price_per_night > max_price_per_night:
                    continue

                price_total = round(price_per_night * nights, 2)

                # Extract rating
                rating = 0
                if prop.get("overall_rating"):
                    try:
                        rating = float(prop["overall_rating"])
                    except (ValueError, TypeError):
                        pass

                hotel = {
                    "hotel_id": "",
                    "offer_id": "",
                    "name": prop.get("name", ""),
                    "rating": rating,
                    "location": query,
                    "check_in_date": check_in_date,
                    "check_out_date": check_out_date,
                    "room_type": prop.get("type", ""),
                    "bed_type": "",
                    "price_per_night": price_per_night,
                    "price_total": price_total,
                    "currency": currency,
                    "number_of_nights": nights,
                    "rooms_requested": rooms,
                    "adults": adults,
                    "source": "google_hotels",
                }

                # Optional enrichment from Google
                if prop.get("amenities"):
                    hotel["amenities"] = prop["amenities"][:8]
                if prop.get("link"):
                    hotel["booking_link"] = prop["link"]
                if prop.get("reviews"):
                    hotel["review_count"] = prop["reviews"]
                if prop.get("description"):
                    hotel["description"] = prop["description"][:200]

                hotels.append(hotel)

            except (KeyError, TypeError, ValueError) as e:
                logger.warning(f"Error parsing SerpAPI hotel: {e}")
                continue

        if not hotels:
            return json.dumps({
                "status": "no_results",
                "message": f"No hotels found on Google Hotels for {query}",
                "hotels": [],
                "source": "google_hotels",
            })

        return json.dumps({
            "status": "success",
            "count": len(hotels),
            "hotels": hotels,
            "source": "google_hotels",
        })

    except Exception as e:
        logger.error(f"SerpAPI hotels error: {e}", exc_info=True)
        return json.dumps({
            "status": "error",
            "message": f"Google Hotels search error: {str(e)}",
            "hotels": []
        })
