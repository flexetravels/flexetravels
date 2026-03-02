"""
FlexeTravels — Google Maps / Location Tool
Gets location information, nearby attractions, and points of interest.
Uses Serper API for Google Maps queries with web search fallback.
"""

import json
from tenacity import retry, stop_after_attempt, wait_exponential

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import SERPER_API_KEY, HAS_SERPER, MAX_RETRIES, RETRY_DELAY, RETRY_MAX_DELAY
from utils.cache import cached_api_call


class GoogleMapsTool:
    name: str = "google_maps_search"
    description: str = (
        "Search for locations, attractions, restaurants, and points of interest using Google Maps data. "
        "Arguments: query (str), location (str), search_type (str: 'attractions', 'restaurants', 'hotels', 'activities')."
    )

    def _run(self, query: str, location: str = "", search_type: str = "attractions") -> str:
        """
        Execute the maps search.
        """
        full_query = f"{query} {location}".strip()
        params = {"query": full_query, "type": search_type}

        if HAS_SERPER:
            try:
                result = cached_api_call(
                    prefix="maps_search",
                    params=params,
                    fn=lambda: self._serper_maps_search(full_query),
                    ttl=3600,
                )
                return json.dumps(result, indent=2)
            except Exception as e:
                return json.dumps({
                    "status": "error",
                    "message": f"Maps search error: {str(e)}. Using curated data.",
                    "results": self._mock_places(location or query, search_type)
                }, indent=2)
        else:
            return json.dumps({
                "status": "mock",
                "message": "Serper API not configured. Returning curated location data.",
                "results": self._mock_places(location or query, search_type)
            }, indent=2)

    @retry(stop=stop_after_attempt(MAX_RETRIES), wait=wait_exponential(multiplier=RETRY_DELAY, max=RETRY_MAX_DELAY))
    def _serper_maps_search(self, query: str) -> dict:
        """Search using Serper's Maps API."""
        import requests

        response = requests.post(
            "https://google.serper.dev/maps",
            headers={"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"},
            json={"q": query, "num": 8},
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()

        places = []
        for place in data.get("places", [])[:8]:
            places.append({
                "name": place.get("title", ""),
                "address": place.get("address", ""),
                "rating": place.get("rating", 0),
                "reviews": place.get("reviews", 0),
                "type": place.get("type", ""),
                "description": place.get("description", ""),
                "website": place.get("website", ""),
            })

        return {"places": places, "total": len(places)}

    def _mock_places(self, location: str, search_type: str) -> dict:
        """Return curated mock location data."""
        location_lower = location.lower() if location else ""

        mock_data = {
            "tokyo": [
                {"name": "Senso-ji Temple", "rating": 4.7, "type": "Temple", "description": "Tokyo's oldest and most famous Buddhist temple in Asakusa"},
                {"name": "Shibuya Crossing", "rating": 4.6, "type": "Landmark", "description": "World-famous pedestrian crossing, busiest intersection on Earth"},
                {"name": "Meiji Jingu Shrine", "rating": 4.8, "type": "Shrine", "description": "Stunning Shinto shrine surrounded by 170-acre forest in central Tokyo"},
                {"name": "TeamLab Borderless", "rating": 4.8, "type": "Museum", "description": "Immersive digital art museum with stunning interactive installations"},
                {"name": "Tsukiji Outer Market", "rating": 4.5, "type": "Market", "description": "Famous food market with fresh sushi, street food, and cooking supplies"},
            ],
            "kyoto": [
                {"name": "Fushimi Inari Shrine", "rating": 4.8, "type": "Shrine", "description": "Iconic shrine with thousands of vermillion torii gates"},
                {"name": "Arashiyama Bamboo Grove", "rating": 4.6, "type": "Nature", "description": "Stunning bamboo forest path in western Kyoto"},
                {"name": "Kinkaku-ji (Golden Pavilion)", "rating": 4.7, "type": "Temple", "description": "Zen temple covered in gold leaf reflecting in a serene pond"},
            ],
            "default": [
                {"name": f"Top Attraction in {location}", "rating": 4.7, "type": "Landmark", "description": f"Must-visit landmark in {location or 'destination'}"},
                {"name": f"Cultural Experience in {location}", "rating": 4.6, "type": "Culture", "description": f"Authentic local cultural experience in {location or 'destination'}"},
                {"name": f"Local Food Market in {location}", "rating": 4.5, "type": "Food", "description": f"Best local cuisine and street food in {location or 'destination'}"},
                {"name": f"Nature Spot in {location}", "rating": 4.8, "type": "Nature", "description": f"Beautiful natural scenery near {location or 'destination'}"},
            ],
        }

        # Find matching location data
        for key in mock_data:
            if key in location_lower:
                return {"places": mock_data[key], "total": len(mock_data[key])}

        return {"places": mock_data["default"], "total": len(mock_data["default"])}
