"""
FlexeTravels — Flight Agent
Wrapper for standalone flight searches (not called from main.py chat flow).
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from tools.amadeus_flights import AmadeusFlightsTool
from utils.validators import safe_parse_json


class FlightAgent:
    """Standalone flight search agent. Direct tool call, no nested Claude."""

    def __init__(self):
        self._tool = AmadeusFlightsTool()

    def search(self, origin: str, destination: str, departure_date: str,
               return_date: str = "", adults: int = 1, budget_max: Optional[float] = None,
               non_stop: bool = False, travel_class: str = "ECONOMY") -> Dict[str, Any]:
        """
        Search for flights.

        Args:
            origin: IATA airport code (e.g., 'YVR')
            destination: IATA airport code (e.g., 'LAS')
            departure_date: Departure date in YYYY-MM-DD format
            return_date: Return date (optional)
            adults: Number of adult passengers
            budget_max: Maximum total budget in USD (optional)
            non_stop: True for direct flights only
            travel_class: ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST

        Returns:
            Dict with status and flights list
        """
        try:
            result_str = self._tool._run(
                origin=origin,
                destination=destination,
                departure_date=departure_date,
                return_date=return_date,
                adults=adults,
                max_price=int(budget_max) if budget_max else 0,
                non_stop=non_stop,
                travel_class=travel_class
            )

            return safe_parse_json(result_str, fallback={"status": "error", "flights": []})

        except Exception as e:
            return {
                "status": "error",
                "message": f"Flight search failed: {str(e)}",
                "flights": []
            }
