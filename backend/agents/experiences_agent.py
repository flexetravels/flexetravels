"""
FlexeTravels — Experiences Agent
Wrapper for standalone experience/activity searches (not called from main.py chat flow).
"""

import json
from pathlib import Path
from typing import Optional, Dict, Any

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from tools.amadeus_experiences import AmadeusExperiencesTool
from utils.validators import safe_parse_json


class ExperiencesAgent:
    """Standalone experiences/activities search agent. Direct tool call, no nested Claude."""

    def __init__(self):
        self._tool = AmadeusExperiencesTool()

    def search(self, city_name: str, budget_per_person: Optional[float] = None,
               radius_km: int = 20) -> Dict[str, Any]:
        """
        Search for tours and activities.

        Args:
            city_name: City name (e.g., 'Las Vegas', 'Paris')
            budget_per_person: Maximum price per person in USD (optional)
            radius_km: Search radius in kilometers (1-50)

        Returns:
            Dict with status and experiences list
        """
        try:
            result_str = self._tool._run(
                city_name=city_name,
                max_price_per_person=budget_per_person or 0,
                radius_km=radius_km
            )

            return safe_parse_json(result_str, fallback={"status": "error", "experiences": []})

        except Exception as e:
            return {
                "status": "error",
                "message": f"Experiences search failed: {str(e)}",
                "experiences": []
            }
