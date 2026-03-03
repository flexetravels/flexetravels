"""
FlexeTravels — Duffel Stays API Tool
Hotel/accommodation search and booking via Duffel API.
Supports millions of properties worldwide via Duffel's unified API.
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Tuple

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

import requests
from config import DUFFEL_API_KEY, HAS_DUFFEL
from utils.cache import cached_api_call

logger = logging.getLogger(__name__)

# Duffel API base URL
DUFFEL_BASE_URL = "https://api.duffel.com"

# City → (Latitude, Longitude) mapping for Duffel stays search
CITY_TO_COORDS = {
    # North America
    "NYC": (40.7128, -74.0060), "JFK": (40.7128, -74.0060),  # New York
    "LAX": (34.0522, -118.2437),  # Los Angeles
    "CHI": (41.8781, -87.6298),  # Chicago
    "ORD": (41.8781, -87.6298),
    "LAS": (36.1699, -115.1398),  # Las Vegas
    "MIA": (25.7617, -80.1918),  # Miami
    "SFO": (37.7749, -122.4194),  # San Francisco
    "BOS": (42.3601, -71.0589),  # Boston
    "DEN": (39.7392, -104.9903),  # Denver
    "ATL": (33.7490, -84.3880),  # Atlanta
    "SEA": (47.6062, -122.3321),  # Seattle
    "PHX": (33.4484, -112.0742),  # Phoenix
    "DFW": (32.8975, -97.0382),  # Dallas
    "HOU": (29.7604, -95.3698),  # Houston
    "AUS": (30.2672, -97.7431),  # Austin
    "TPA": (27.9760, -82.5277),  # Tampa
    # Canada
    "YVR": (49.1900, -123.1724),  # Vancouver
    "YYZ": (43.6777, -79.6104),  # Toronto
    "YUL": (45.5017, -73.5673),  # Montreal
    "YYC": (51.1694, -114.0181),  # Calgary
    # Europe
    "LON": (51.5074, -0.1278),  # London
    "LHR": (51.5074, -0.1278),
    "PAR": (48.8566, 2.3522),  # Paris
    "CDG": (48.8566, 2.3522),
    "FCO": (41.9028, 12.4964),  # Rome
    "BCN": (41.3851, 2.1734),  # Barcelona
    "MAD": (40.4168, -3.7038),  # Madrid
    "AMS": (52.3676, 4.9041),  # Amsterdam
    "FRA": (50.1109, 8.6821),  # Frankfurt
    "MUC": (48.1351, 11.5820),  # Munich
    "ZRH": (47.3769, 8.5472),  # Zurich
    "VIE": (48.2082, 16.3738),  # Vienna
    "PRG": (50.0755, 14.4378),  # Prague
    "LIS": (38.7223, -9.1393),  # Lisbon
    "ATH": (37.9838, 23.7275),  # Athens
    "IST": (41.0082, 28.9784),  # Istanbul
    "DUB": (53.3498, -6.2603),  # Dublin
    # Asia
    "TYO": (35.6762, 139.6503),  # Tokyo
    "NRT": (35.6762, 139.6503),
    "HND": (35.6762, 139.6503),
    "BKK": (13.7563, 100.5018),  # Bangkok
    "SGN": (10.8231, 106.6297),  # Ho Chi Minh City / Saigon
    "HCM": (10.8231, 106.6297),
    "DEL": (28.7041, 77.1025),  # Delhi
    "BOM": (19.0760, 72.8777),  # Mumbai
    "BKG": (13.7563, 100.5018),  # Bangkok (alternative)
    "SIN": (1.3521, 103.8198),  # Singapore
    "HKG": (22.3193, 114.1694),  # Hong Kong
    "PEK": (39.9042, 116.4074),  # Beijing
    "PVG": (31.2304, 121.4724),  # Shanghai
    "KUL": (3.1390, 101.6869),  # Kuala Lumpur
    "TPE": (25.0330, 121.5654),  # Taipei
    "MNL": (14.5995, 120.9842),  # Manila
    "ICN": (37.4419, 126.4469),  # Seoul
    "KIX": (34.7285, 135.4384),  # Osaka/Kobe
    # Middle East
    "DXB": (25.2048, 55.2708),  # Dubai
    "DOH": (25.2854, 51.5310),  # Doha
    "AUH": (24.4539, 54.3773),  # Abu Dhabi
    # Oceania
    "SYD": (-33.8688, 151.2093),  # Sydney
    "MEL": (-37.8136, 144.9631),  # Melbourne
    "AKL": (-37.0082, 174.7850),  # Auckland
    # Latin America
    "MEX": (19.2864, -99.1332),  # Mexico City
    "CUN": (21.1619, -87.3421),  # Cancun
    "GRU": (-23.5505, -46.6333),  # Sao Paulo
    "EZE": (-34.8222, -58.5358),  # Buenos Aires
    "BOG": (4.7110, -74.0721),  # Bogota
    "LIM": (-12.0464, -77.0428),  # Lima
    # Beach Destinations
    "DPS": (-8.7480, 115.2276),  # Bali/Denpasar
    "MLE": (4.1755, 73.5093),  # Maldives
}

# Default search radius in km
DEFAULT_RADIUS_KM = 15


class DuffelStaysTool:
    """Search accommodations using Duffel Stays API."""

    name = "duffel_stays_search"
    description = "Search hotel and accommodation availability via Duffel API with global coverage."

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
        city_code: str,
        check_in_date: str,
        check_out_date: str,
        adults: int = 1,
        rooms: int = 1,
        max_price_per_night: int = 0,
        min_star_rating: int = 0,
    ) -> str:
        """
        Search for accommodations on Duffel API.

        Args:
            city_code: City code or IATA airport code (e.g., NYC, JFK, LON)
            check_in_date: YYYY-MM-DD format
            check_out_date: YYYY-MM-DD format
            adults: Number of adults
            rooms: Number of rooms
            max_price_per_night: Maximum price per night (0 = no limit)
            min_star_rating: Minimum star rating (0-5, 0 = no filter)

        Returns:
            JSON string with stays list or error status
        """

        if not HAS_DUFFEL:
            return json.dumps({
                "status": "no_api",
                "message": "Duffel API credentials not configured",
                "hotels": [],
            })

        try:
            # Get coordinates for city
            coords = CITY_TO_COORDS.get(city_code.upper())
            if not coords:
                logger.warning(f"Unknown city code: {city_code}")
                return json.dumps({
                    "status": "unknown_city",
                    "message": f"City code not found: {city_code}",
                    "hotels": [],
                })

            cache_params = {
                "city": city_code.upper(),
                "check_in": check_in_date,
                "check_out": check_out_date,
                "adults": adults,
                "rooms": rooms,
            }

            # Try cached result first
            cached = cached_api_call(
                prefix="duffel_stays",
                params=cache_params,
                fn=lambda: self._fetch_stays(
                    coords, check_in_date, check_out_date, adults, rooms, max_price_per_night
                ),
                ttl=1800,  # 30 minutes cache
            )

            return json.dumps(cached)

        except Exception as e:
            logger.error(f"Duffel stays search error: {e}", exc_info=True)
            return json.dumps({
                "status": "error",
                "message": f"Error searching accommodations: {str(e)}",
                "hotels": [],
            })

    def _fetch_stays(
        self,
        coords: Tuple[float, float],
        check_in_date: str,
        check_out_date: str,
        adults: int,
        rooms: int,
        max_price_per_night: int,
    ) -> dict:
        """Fetch accommodation search results from Duffel."""
        try:
            lat, lon = coords

            # Search request payload
            search_payload = {
                "data": {
                    "location": {
                        "latitude": lat,
                        "longitude": lon,
                        "radius": {
                            "value": DEFAULT_RADIUS_KM,
                            "unit": "km",
                        },
                    },
                    "check_in_date": check_in_date,
                    "check_out_date": check_out_date,
                    "rooms": [
                        {
                            "adults": adults,
                            "children_ages": [],
                        }
                        for _ in range(rooms)
                    ],
                }
            }

            # Create search request
            response = requests.post(
                f"{self.base_url}/stays/search-results",
                json=search_payload,
                headers=self.headers,
                timeout=15,
            )

            if response.status_code != 201:
                logger.warning(
                    f"Duffel search request failed: {response.status_code} - {response.text[:200]}"
                )
                return {
                    "status": "api_error",
                    "error_code": response.status_code,
                    "message": f"Duffel API error: {response.status_code}",
                    "hotels": [],
                }

            search_result = response.json().get("data", {})
            search_id = search_result.get("id")

            if not search_id:
                return {
                    "status": "no_results",
                    "message": "No accommodations found",
                    "hotels": [],
                }

            # Fetch rates for the search
            stays = self._fetch_rates(search_id, check_in_date, check_out_date, max_price_per_night)
            return {
                "status": "success",
                "count": len(stays),
                "hotels": stays,
                "source": "duffel",
            }

        except requests.exceptions.Timeout:
            return {
                "status": "timeout",
                "message": "Duffel API request timed out",
                "hotels": [],
            }
        except Exception as e:
            logger.error(f"Duffel fetch stays error: {e}")
            return {
                "status": "error",
                "message": str(e),
                "hotels": [],
            }

    def _fetch_rates(
        self,
        search_id: str,
        check_in_date: str,
        check_out_date: str,
        max_price_per_night: int,
    ) -> List[dict]:
        """Fetch rates for search results."""
        try:
            # Get available rates
            response = requests.get(
                f"{self.base_url}/stays/search-results/{search_id}/rates",
                headers=self.headers,
                timeout=15,
            )

            if response.status_code != 200:
                logger.warning(f"Failed to fetch rates: {response.status_code}")
                return []

            rates_data = response.json().get("data", [])

            # Calculate nights for price per night
            check_in = datetime.strptime(check_in_date, "%Y-%m-%d")
            check_out = datetime.strptime(check_out_date, "%Y-%m-%d")
            nights = max((check_out - check_in).days, 1)

            # Parse rates into hotels
            stays = []
            for rate in rates_data[:20]:  # Limit to 20 results
                try:
                    total_price = float(rate.get("total_amount", {}).get("amount", 0))
                    price_per_night = round(total_price / nights, 2) if nights > 0 else total_price

                    # Filter by max price if specified
                    if max_price_per_night > 0 and price_per_night > max_price_per_night:
                        continue

                    accommodation = rate.get("accommodation", {})
                    room = rate.get("room_type", {})

                    stay = {
                        "hotel_id": accommodation.get("id", ""),
                        "offer_id": rate.get("id", ""),
                        "name": accommodation.get("name", ""),
                        "rating": accommodation.get("rating", 0),
                        "location": accommodation.get("address", {}).get("city", ""),
                        "check_in_date": check_in_date,
                        "check_out_date": check_out_date,
                        "room_type": room.get("name", ""),
                        "bed_type": room.get("bed_configuration", {}).get("type", ""),
                        "price_per_night": price_per_night,
                        "price_total": total_price,
                        "currency": rate.get("total_amount", {}).get("currency_code", "USD"),
                        "number_of_nights": nights,
                        "rooms_requested": 1,
                        "adults": 1,
                        "source": "duffel",
                    }

                    # Add cancellation info if available
                    cancellation = rate.get("cancellation_type")
                    if cancellation:
                        stay["cancellation_policy"] = cancellation

                    stays.append(stay)

                except (KeyError, TypeError, ValueError) as e:
                    logger.warning(f"Error parsing Duffel rate: {e}")
                    continue

            return stays

        except Exception as e:
            logger.error(f"Error fetching rates: {e}")
            return []


# Factory function for easy integration
def get_duffel_stays_tool() -> DuffelStaysTool:
    """Get Duffel stays tool instance."""
    return DuffelStaysTool()
