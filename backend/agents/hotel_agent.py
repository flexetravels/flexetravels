"""
FlexeTravels — Hotel Agent
Wrapper for standalone hotel searches (not called from main.py chat flow).
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from tools.amadeus_hotels import AmadeusHotelsTool
from utils.validators import safe_parse_json


class HotelAgent:
    """Standalone hotel search agent. Direct tool call, no nested Claude."""

    def __init__(self):
        self._tool = AmadeusHotelsTool()

    def search(self, city_code: str, check_in_date: str, check_out_date: str,
               adults: int = 1, rooms: int = 1, budget_total: Optional[float] = None,
               min_star_rating: int = 0) -> Dict[str, Any]:
        """
        Search for hotels.

        Args:
            city_code: IATA city code (e.g., 'LAS' for Las Vegas)
            check_in_date: Check-in date in YYYY-MM-DD format
            check_out_date: Check-out date in YYYY-MM-DD format
            adults: Number of adults per room
            rooms: Number of rooms needed
            budget_total: Total budget in USD (optional, converts to per-night)
            min_star_rating: Minimum star rating (0-5)

        Returns:
            Dict with status and hotels list
        """
        try:
            # Calculate nights to convert total budget to per-night
            check_in = datetime.strptime(check_in_date, "%Y-%m-%d")
            check_out = datetime.strptime(check_out_date, "%Y-%m-%d")
            nights = max((check_out - check_in).days, 1)

            # Convert total budget to per-night budget
            max_price_per_night = 0
            if budget_total:
                max_price_per_night = int(budget_total / nights)

            result_str = self._tool._run(
                city_code=city_code,
                check_in_date=check_in_date,
                check_out_date=check_out_date,
                adults=adults,
                rooms=rooms,
                max_price_per_night=max_price_per_night,
                min_star_rating=min_star_rating
            )

            return safe_parse_json(result_str, fallback={"status": "error", "hotels": []})

        except Exception as e:
            return {
                "status": "error",
                "message": f"Hotel search failed: {str(e)}",
                "hotels": []
            }
