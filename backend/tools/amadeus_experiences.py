"""
FlexeTravels — Amadeus Experiences Tool
Two-step experiences search: get city coordinates, then get activities.
"""

import json
import logging
from pathlib import Path
from typing import Optional

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import AMADEUS_API_KEY, AMADEUS_API_SECRET, HAS_AMADEUS
from utils.cache import cached_api_call

logger = logging.getLogger(__name__)


class AmadeusExperiencesTool:
    """Search Amadeus tours and activities at a destination (2-step process)."""

    name = "amadeus_experiences_search"
    description = "Search Amadeus tours and activities at a destination. Two-step: get city coordinates, then fetch activities with pricing."

    def _run(self, city_name: str, max_price_per_person: float = 0, radius_km: int = 20) -> str:
        """
        Search for tours and activities on Amadeus API (two-step process).

        Args:
            city_name: City name (e.g., 'Las Vegas', 'Paris', 'London')
            max_price_per_person: Maximum price per person in USD (0 = no limit)
            radius_km: Search radius in kilometers (1-50, default 20)

        Returns:
            JSON string with experiences list or error status
        """

        # Guard: Check if Amadeus is configured
        if not HAS_AMADEUS:
            return json.dumps({
                "status": "no_api",
                "message": "Amadeus API credentials not configured",
                "experiences": []
            })

        try:
            # Import Amadeus client
            from amadeus import Client, ResponseError
            amadeus = Client(client_id=AMADEUS_API_KEY, client_secret=AMADEUS_API_SECRET)

            # ===== STEP 1: Get city coordinates (cached 7 days) =====
            def fetch_city_location():
                return amadeus.reference_data.locations.get(
                    keyword=city_name,
                    subType='CITY'
                )

            city_response = cached_api_call(
                prefix="amadeus_city_geo",
                params={"city": city_name.lower()},
                fn=fetch_city_location,
                ttl=604800  # 7 days
            )

            if not hasattr(city_response, 'data') or not city_response.data:
                return json.dumps({
                    "status": "city_not_found",
                    "message": f"City not found: {city_name}",
                    "experiences": []
                })

            city_data = city_response.data[0]
            geo_code = city_data.get("geoCode", {})
            latitude = float(geo_code.get("latitude", 0))
            longitude = float(geo_code.get("longitude", 0))

            if not latitude or not longitude:
                return json.dumps({
                    "status": "invalid_coordinates",
                    "message": f"Could not extract coordinates for {city_name}",
                    "experiences": []
                })

            # ===== STEP 2: Get activities by coordinates (cached 1 hour) =====
            activities_params = {
                "latitude": latitude,
                "longitude": longitude,
                "radius": min(radius_km, 50),  # Cap at 50 km
            }

            def fetch_activities():
                return amadeus.shopping.activities.get(**activities_params)

            activities_response = cached_api_call(
                prefix="amadeus_activities",
                params={
                    "lat": latitude,
                    "lng": longitude,
                    "radius": radius_km,
                },
                fn=fetch_activities,
                ttl=3600  # 1 hour
            )

            # Parse activities from response
            experiences = []
            if hasattr(activities_response, 'data') and activities_response.data:
                for activity in activities_response.data[:30]:  # Limit to 30 results
                    try:
                        # Extract price if available
                        price_info = activity.get("price", {})
                        price_amount = price_info.get("amount")
                        price_per_person = None

                        if price_amount:
                            try:
                                price_per_person = float(price_amount)
                                # Filter by max price if specified
                                if max_price_per_person > 0 and price_per_person > max_price_per_person:
                                    continue
                            except (ValueError, TypeError):
                                pass

                        # Extract rating
                        rating = None
                        if activity.get("rating"):
                            try:
                                rating = float(activity.get("rating"))
                            except (ValueError, TypeError):
                                pass

                        experience = {
                            "id": activity.get("id", ""),
                            "name": activity.get("name", ""),
                            "description": activity.get("shortDescription", ""),
                            "rating": rating,
                            "price_per_person": price_per_person,
                            "currency": price_info.get("currencyCode", "USD"),
                            "duration": activity.get("minimumDuration", ""),
                            "booking_link": activity.get("bookingLink", ""),
                            "location": activity.get("location", city_name),
                            "starting_point": activity.get("startingPoint", ""),
                            "end_point": activity.get("endPoint", ""),
                        }

                        # Add full description if available
                        if activity.get("description"):
                            experience["full_description"] = activity.get("description")

                        experiences.append(experience)

                    except (KeyError, TypeError, ValueError) as e:
                        logger.warning(f"Error parsing activity: {e}")
                        continue

            # If no activities found (common in test sandbox)
            if not experiences:
                return json.dumps({
                    "status": "no_results",
                    "message": f"No activities found in {city_name} (test sandbox may have limited data)",
                    "experiences": []
                })

            return json.dumps({
                "status": "success",
                "count": len(experiences),
                "city": city_name,
                "coordinates": {
                    "latitude": latitude,
                    "longitude": longitude,
                },
                "experiences": experiences
            })

        except Exception as e:
            # Import here to avoid top-level import error if amadeus not installed
            from amadeus import ResponseError

            if isinstance(e, ResponseError):
                return json.dumps({
                    "status": "api_error",
                    "error_code": getattr(e.response, 'status_code', 'unknown'),
                    "message": f"Amadeus API error: {str(e)}",
                    "experiences": []
                })
            else:
                logger.error(f"Experiences search error: {e}", exc_info=True)
                return json.dumps({
                    "status": "error",
                    "message": f"Error searching experiences: {str(e)}",
                    "experiences": []
                })
