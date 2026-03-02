"""
FlexeTravels — Operator Agent
Standalone orchestrator for programmatic travel searches.
NOT called from main.py chat flow (Claude in main.py IS the operator).
Available for research pipeline, future use, or standalone scripts.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from agents.flight_agent import FlightAgent
from agents.hotel_agent import HotelAgent
from agents.experiences_agent import ExperiencesAgent


class OperatorAgent:
    """
    Standalone orchestrator for complete travel searches.
    Combines flights, hotels, and experiences with budget allocation.
    Uses FlightAgent + HotelAgent + ExperiencesAgent with Python-level coordination.
    """

    def __init__(self):
        self.flight_agent = FlightAgent()
        self.hotel_agent = HotelAgent()
        self.experiences_agent = ExperiencesAgent()

    def search(self, origin: str, destination: str, destination_city_name: str,
               departure_date: str, return_date: str = "",
               adults: int = 1, total_budget: Optional[float] = None) -> Dict[str, Any]:
        """
        Complete travel search: flights + hotels + experiences.

        Budget allocation (if provided):
        - Flights: 55% of total budget
        - Hotels: 35% of total budget
        - Experiences: 10% of total budget (per person)

        Args:
            origin: IATA origin airport code
            destination: IATA destination airport code
            destination_city_name: City name for hotel/experience searches (e.g., 'Las Vegas')
            departure_date: Departure date in YYYY-MM-DD format
            return_date: Return date (optional)
            adults: Number of adult travelers
            total_budget: Total budget in USD (optional)

        Returns:
            Dict with flights, hotels, experiences, and metadata
        """
        try:
            # Budget allocation (55-35-10 split)
            flight_budget = None
            hotel_budget = None
            experience_budget_pp = None

            if total_budget:
                flight_budget = total_budget * 0.55
                hotel_budget = total_budget * 0.35
                experience_budget_pp = (total_budget * 0.10) / adults if adults > 0 else 0

            # Calculate check-in/check-out dates from departure/return
            check_in_date = departure_date
            check_out_date = return_date if return_date else self._add_days(departure_date, 5)

            # Search flights
            flights = self._safe(lambda: self.flight_agent.search(
                origin=origin,
                destination=destination,
                departure_date=departure_date,
                return_date=return_date,
                adults=adults,
                budget_max=flight_budget,
                non_stop=False,
                travel_class="ECONOMY"
            ))

            # Search hotels
            hotels = self._safe(lambda: self.hotel_agent.search(
                city_code=destination[:3].upper(),  # Use first 3 chars of destination as city code
                check_in_date=check_in_date,
                check_out_date=check_out_date,
                adults=adults,
                rooms=max(1, adults // 2),  # Rough estimate: 1 room per 2 adults
                budget_total=hotel_budget,
                min_star_rating=0
            ))

            # Search experiences
            experiences = self._safe(lambda: self.experiences_agent.search(
                city_name=destination_city_name,
                budget_per_person=experience_budget_pp,
                radius_km=20
            ))

            return {
                "status": "success",
                "origin": origin,
                "destination": destination,
                "departure_date": departure_date,
                "return_date": return_date,
                "adults": adults,
                "total_budget": total_budget,
                "flights": flights,
                "hotels": hotels,
                "experiences": experiences,
                "budget_allocation": {
                    "flights": flight_budget,
                    "hotels": hotel_budget,
                    "experiences_per_person": experience_budget_pp,
                } if total_budget else None
            }

        except Exception as e:
            return {
                "status": "error",
                "message": f"Search failed: {str(e)}",
                "flights": {"status": "error", "flights": []},
                "hotels": {"status": "error", "hotels": []},
                "experiences": {"status": "error", "experiences": []}
            }

    def _safe(self, fn):
        """Execute function safely, catching exceptions."""
        try:
            return fn()
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def _add_days(self, date_str: str, days: int) -> str:
        """Add N days to a YYYY-MM-DD date string."""
        from datetime import timedelta
        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d")
            new_date = date_obj + timedelta(days=days)
            return new_date.strftime("%Y-%m-%d")
        except:
            return date_str
