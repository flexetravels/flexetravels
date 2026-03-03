"""
FlexeTravels — Amadeus Hotels Tool
Two-step hotel search: get IDs, then get pricing with real availability.
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


class AmadeusHotelsTool:
    """Search Amadeus hotel availability and live pricing (2-step process)."""

    name = "amadeus_hotels_search"
    description = "Search Amadeus hotel availability and live pricing. Two-step: get hotel IDs from city, then fetch offers with real prices."

    def _run(self, city_code: str, check_in_date: str, check_out_date: str,
             adults: int = 1, rooms: int = 1, max_price_per_night: int = 0,
             min_star_rating: int = 0) -> str:
        """
        Search for hotels on Amadeus API (two-step process).

        Args:
            city_code: IATA city code (e.g., 'LAS' for Las Vegas, 'PAR' for Paris)
            check_in_date: Check-in date in YYYY-MM-DD format
            check_out_date: Check-out date in YYYY-MM-DD format
            adults: Number of adults per room
            rooms: Number of rooms needed
            max_price_per_night: Maximum price per night in USD (0 = no limit)
            min_star_rating: Minimum star rating (0-5, default 0 = no filter)

        Returns:
            JSON string with hotels list or error status
        """

        # Guard: Check if Amadeus is configured
        if not HAS_AMADEUS:
            # Try SerpAPI fallback if Amadeus not available
            if HAS_SERPAPI:
                try:
                    from tools.serpapi_hotels import search_serpapi_hotels
                    return search_serpapi_hotels(
                        city_name=city_code, check_in_date=check_in_date,
                        check_out_date=check_out_date, adults=adults,
                        rooms=rooms, max_price_per_night=max_price_per_night,
                        currency=AMADEUS_CURRENCY,
                    )
                except Exception as e:
                    logger.warning(f"SerpAPI hotel fallback also failed: {e}")
            return json.dumps({
                "status": "no_api",
                "message": "Amadeus API credentials not configured",
                "hotels": []
            })

        try:
            # Import Amadeus client
            from amadeus import Client, ResponseError
            amadeus = Client(client_id=AMADEUS_API_KEY, client_secret=AMADEUS_API_SECRET)

            # Calculate number of nights
            check_in = datetime.strptime(check_in_date, "%Y-%m-%d")
            check_out = datetime.strptime(check_out_date, "%Y-%m-%d")
            nights = max((check_out - check_in).days, 1)

            # ===== STEP 1: Get hotel IDs by city (cached 1 hour) =====
            def fetch_hotel_ids():
                resp = amadeus.reference_data.locations.hotels.by_city.get(
                    cityCode=city_code.upper()
                )
                return resp.data if resp.data else []

            hotel_ids_data = cached_api_call(
                prefix="amadeus_hotel_ids",
                params={"city": city_code.lower()},
                fn=fetch_hotel_ids,
                ttl=3600  # 1 hour
            )

            hotel_ids = []
            if hotel_ids_data:
                hotel_ids = [h.get("hotelId") for h in (hotel_ids_data or [])[:20] if h.get("hotelId")]

            if not hotel_ids:
                # Try SerpAPI fallback
                if HAS_SERPAPI:
                    try:
                        from tools.serpapi_hotels import search_serpapi_hotels
                        fallback_result = search_serpapi_hotels(
                            city_name=city_code, check_in_date=check_in_date,
                            check_out_date=check_out_date, adults=adults,
                            rooms=rooms, max_price_per_night=max_price_per_night,
                            currency=AMADEUS_CURRENCY,
                        )
                        fallback_data = json.loads(fallback_result)
                        if fallback_data.get("status") == "success" and fallback_data.get("count", 0) > 0:
                            logger.info(f"SerpAPI fallback returned {fallback_data['count']} hotels for {city_code}")
                            return fallback_result
                    except Exception as fb_err:
                        logger.warning(f"SerpAPI hotel fallback failed: {fb_err}")
                return json.dumps({
                    "status": "no_hotels",
                    "message": f"No hotels found for city code: {city_code}",
                    "hotels": []
                })

            # ===== STEP 2: Get pricing for hotels (cached 30 minutes) =====
            hotel_search_params = {
                "hotelIds": hotel_ids,
                "checkInDate": check_in_date,
                "checkOutDate": check_out_date,
                "adults": adults,
                "roomQuantity": rooms,
                "currency": AMADEUS_CURRENCY,
                "bestRateOnly": True,  # Only best rate per hotel
            }

            # Add price range filter if specified
            if max_price_per_night > 0:
                # Format: "1-300" for prices between 1 and 300 per night
                hotel_search_params["priceRange"] = f"1-{max_price_per_night}"

            def fetch_hotel_offers():
                resp = amadeus.shopping.hotel_offers_search.get(**hotel_search_params)
                return resp.data if resp.data else []

            offers_data = cached_api_call(
                prefix="amadeus_hotel_offers",
                params={
                    "cities": [city_code],
                    "checkIn": check_in_date,
                    "checkOut": check_out_date,
                    "adults": adults,
                    "rooms": rooms,
                },
                fn=fetch_hotel_offers,
                ttl=1800  # 30 minutes
            )

            # Parse hotels from response
            hotels = []
            if offers_data:
                for item in (offers_data or [])[:20]:  # Limit to 20 results
                    try:
                        hotel_info = item.get("hotel", {})
                        offers_list = item.get("offers", [])

                        if not offers_list:
                            continue

                        # Get best offer (first one, since bestRateOnly=True)
                        offer = offers_list[0]
                        price_info = offer.get("price", {})
                        total_price = float(price_info.get("total", 0))
                        price_per_night = round(total_price / nights, 2) if nights > 0 else total_price

                        # Filter by min star rating if specified
                        rating = hotel_info.get("rating", 0)
                        if min_star_rating > 0 and rating < min_star_rating:
                            continue

                        hotel = {
                            "hotel_id": hotel_info.get("hotelId", ""),
                            "offer_id": offer.get("id", ""),
                            "name": hotel_info.get("name", ""),
                            "rating": rating,
                            "location": hotel_info.get("cityName", ""),
                            "check_in_date": offer.get("checkInDate", ""),
                            "check_out_date": offer.get("checkOutDate", ""),
                            "room_type": offer.get("room", {}).get("typeEstimated", {}).get("category", ""),
                            "bed_type": offer.get("room", {}).get("typeEstimated", {}).get("bedType", ""),
                            "price_per_night": price_per_night,
                            "price_total": total_price,
                            "currency": price_info.get("currency", "USD"),
                            "number_of_nights": nights,
                            "rooms_requested": rooms,
                            "adults": adults,
                            "source": "amadeus",
                        }

                        # Add cancellation policy if available
                        cancellation = offer.get("policies", {}).get("cancellation", {})
                        if cancellation:
                            hotel["cancellation_deadline"] = cancellation.get("deadline", "")
                            hotel["cancellation_policy"] = cancellation.get("instructions", "")

                        hotels.append(hotel)

                    except (KeyError, TypeError, ValueError) as e:
                        logger.warning(f"Error parsing hotel offer: {e}")
                        continue

            # ── SerpAPI Fallback when Amadeus returns 0 hotels ──
            if len(hotels) == 0 and HAS_SERPAPI:
                logger.info(f"Amadeus returned 0 hotel offers for {city_code}, trying SerpAPI fallback")
                try:
                    from tools.serpapi_hotels import search_serpapi_hotels
                    fallback_result = search_serpapi_hotels(
                        city_name=city_code, check_in_date=check_in_date,
                        check_out_date=check_out_date, adults=adults,
                        rooms=rooms, max_price_per_night=max_price_per_night,
                        currency=AMADEUS_CURRENCY,
                    )
                    fallback_data = json.loads(fallback_result)
                    if fallback_data.get("status") == "success" and fallback_data.get("count", 0) > 0:
                        logger.info(f"SerpAPI fallback returned {fallback_data['count']} hotels")
                        return fallback_result
                except Exception as fb_err:
                    logger.warning(f"SerpAPI hotel fallback failed: {fb_err}")

            return json.dumps({
                "status": "success",
                "count": len(hotels),
                "hotels": hotels,
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
                    "hotels": []
                })
            else:
                logger.error(f"Hotel search error: {e}", exc_info=True)
                return json.dumps({
                    "status": "error",
                    "message": f"Error searching hotels: {str(e)}",
                    "hotels": []
                })
