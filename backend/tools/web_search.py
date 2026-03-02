"""
FlexeTravels — Web Search Fallback Tool
Uses SerpAPI to search Google for travel deals when Amadeus has limited data.
Falls back to mock results if SerpAPI not configured.
"""

import json
import re
from typing import List, Dict, Any

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import SERPER_API_KEY, HAS_SERPER
from utils.cache import cached_api_call


class WebSearchTool:
    name: str = "web_search"
    description: str = (
        "Search the web for travel deals (flights, hotels, packages) using Google Search. "
        "Use this as a fallback when Amadeus has limited results. "
        "Returns clickable links to booking sites like Google Flights, Kayak, Booking.com, etc."
    )

    def _run(self, query: str = "", search_type: str = "flights") -> str:
        """Search the web for travel info."""
        if not query:
            return json.dumps({"error": "Query required"})

        params = {"query": query, "search_type": search_type}

        if HAS_SERPER:
            try:
                result = cached_api_call(
                    prefix="web_search",
                    params=params,
                    fn=lambda: self._live_search(query),
                    ttl=3600,  # 1 hour cache
                )
                return json.dumps(result, indent=2)
            except Exception as e:
                return json.dumps({
                    "status": "error",
                    "message": f"Web search error: {str(e)}",
                    "results": self._mock_results(query, search_type)
                }, indent=2)
        else:
            return json.dumps({
                "status": "mock",
                "message": "SerpAPI not configured. Returning sample web results.",
                "results": self._mock_results(query, search_type)
            }, indent=2)

    def _live_search(self, query: str) -> Dict[str, Any]:
        """Execute a live Google Search via SerpAPI."""
        try:
            import requests
            url = "https://google.serper.dev/search"
            headers = {"X-API-KEY": SERPER_API_KEY}
            params = {"q": query, "num": 10}

            response = requests.get(url, params=params, headers=headers, timeout=10)
            response.raise_for_status()
            data = response.json()

            # Parse results
            results = []
            for item in data.get("organic", [])[:5]:
                results.append({
                    "title": item.get("title", ""),
                    "url": item.get("link", ""),
                    "snippet": item.get("snippet", ""),
                    "source": "google_search",
                })

            return {
                "status": "success",
                "query": query,
                "results": results
            }

        except Exception as e:
            raise Exception(f"SerpAPI call failed: {str(e)}")

    def _mock_results(self, query: str, search_type: str) -> List[Dict[str, str]]:
        """Return realistic mock search results."""
        lower_query = query.lower()

        if search_type == "flights":
            return [
                {
                    "title": "Google Flights — Find and Book Flights",
                    "url": "https://www.google.com/flights",
                    "snippet": "The fastest way to find and book flights. Compare prices from hundreds of airlines and book directly.",
                    "source": "google_flights"
                },
                {
                    "title": "Kayak: Flights, Hotels, and More",
                    "url": "https://www.kayak.com",
                    "snippet": "Compare flight prices and book directly. Get real-time price alerts.",
                    "source": "kayak"
                },
                {
                    "title": "Skyscanner — Flight Search Engine",
                    "url": "https://www.skyscanner.com",
                    "snippet": "Search 1000s of flights from 100s of airlines. Huge savings on flights.",
                    "source": "skyscanner"
                },
                {
                    "title": "Expedia — Flights, Hotels, Travel Deals",
                    "url": "https://www.expedia.com",
                    "snippet": "Book flights, hotels, and packages. Compare prices to save big.",
                    "source": "expedia"
                },
                {
                    "title": "Momondo — Flight Search & Price Comparison",
                    "url": "https://www.momondo.com",
                    "snippet": "Search and compare flights across multiple travel sites.",
                    "source": "momondo"
                }
            ]

        elif search_type == "hotels":
            return [
                {
                    "title": "Booking.com — Hotels, Flights, Holiday Rentals",
                    "url": "https://www.booking.com",
                    "snippet": "Book accommodations worldwide. Free cancellation on most rooms.",
                    "source": "booking"
                },
                {
                    "title": "Hotels.com — Find and Book Hotels",
                    "url": "https://www.hotels.com",
                    "snippet": "Search 900,000+ properties. Compare prices and read reviews.",
                    "source": "hotels_com"
                },
                {
                    "title": "Expedia Hotels — Search and Book",
                    "url": "https://www.expedia.com/Hotels",
                    "snippet": "Book hotels worldwide with the best prices guaranteed.",
                    "source": "expedia"
                },
                {
                    "title": "Airbnb — Find Stays and Book Unique Places",
                    "url": "https://www.airbnb.com",
                    "snippet": "Rent homes, apartments, and unique stays. Official Airbnb site.",
                    "source": "airbnb"
                },
                {
                    "title": "Tripadvisor Hotels — Read Reviews & Book",
                    "url": "https://www.tripadvisor.com/Hotels",
                    "snippet": "Find hotels with millions of reviews. Book directly with best rates.",
                    "source": "tripadvisor"
                }
            ]

        else:  # generic packages/deals
            return [
                {
                    "title": "GetYourGuide — Tours, Activities & Attractions",
                    "url": "https://www.getyourguide.com",
                    "snippet": "Book tours, activities, and attractions worldwide.",
                    "source": "getyourguide"
                },
                {
                    "title": "Viator — Things to Do & Attractions",
                    "url": "https://www.viator.com",
                    "snippet": "Expert-led tours and activities at the best prices.",
                    "source": "viator"
                },
                {
                    "title": "Klook — Tours & Attractions",
                    "url": "https://www.klook.com",
                    "snippet": "Book tours, attractions, and activities in Asia.",
                    "source": "klook"
                },
                {
                    "title": "TravelPerk — Corporate Travel Booking",
                    "url": "https://www.travelperk.com",
                    "snippet": "Book flights, hotels, and ground transport in one platform.",
                    "source": "travelperk"
                },
                {
                    "title": "Intrepid Travel — Small Group Tours",
                    "url": "https://www.intrepidtravel.com",
                    "snippet": "Authentic small group tours to 100+ countries.",
                    "source": "intrepid"
                }
            ]
