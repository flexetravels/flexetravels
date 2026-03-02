"""
FlexeTravels — Pydantic Validators
Data models for trip requests, packages, bookings, and JSON helpers.
"""

from __future__ import annotations
from typing import Optional, List
from datetime import date
from pydantic import BaseModel, Field, field_validator
import json


# ── Trip Request ────────────────────────────────────────────

class TripRequest(BaseModel):
    """Validated user trip request."""
    destination: str = Field(..., min_length=2, description="Destination city or country")
    num_days: int = Field(..., ge=1, le=90, description="Trip duration in days")
    num_travelers: int = Field(default=1, ge=1, le=20, description="Number of travelers")
    budget_per_person: Optional[float] = Field(default=None, ge=0, description="Budget per person in USD")
    start_date: Optional[str] = Field(default=None, description="Trip start date (YYYY-MM-DD)")
    travel_style: Optional[str] = Field(default="balanced", description="Style: adventure, cultural, luxury, family, solo, wellness, balanced")
    interests: Optional[List[str]] = Field(default_factory=list, description="User interests: food, history, nature, nightlife, etc.")
    special_requirements: Optional[str] = Field(default=None, description="Dietary, accessibility, or other requirements")

    @field_validator("destination")
    @classmethod
    def clean_destination(cls, v: str) -> str:
        return v.strip().title()

    @field_validator("travel_style")
    @classmethod
    def validate_style(cls, v: str) -> str:
        valid = {"adventure", "cultural", "luxury", "family", "solo", "wellness", "balanced"}
        v_lower = v.lower().strip()
        return v_lower if v_lower in valid else "balanced"


# ── Flight / Hotel Search Results ───────────────────────────

class FlightOption(BaseModel):
    airline: str = ""
    departure: str = ""
    arrival: str = ""
    departure_time: str = ""
    arrival_time: str = ""
    duration: str = ""
    price: float = 0.0
    currency: str = "USD"
    stops: int = 0
    booking_class: str = "Economy"
    offer_id: Optional[str] = None

class HotelOption(BaseModel):
    name: str = ""
    location: str = ""
    rating: float = 0.0
    price_per_night: float = 0.0
    total_price: float = 0.0
    currency: str = "USD"
    amenities: List[str] = Field(default_factory=list)
    offer_id: Optional[str] = None


# ── Travel Package ──────────────────────────────────────────

class DayItinerary(BaseModel):
    day: int
    title: str = ""
    description: str = ""
    activities: List[str] = Field(default_factory=list)
    meals: Optional[str] = None
    accommodation: Optional[str] = None

class TravelPackage(BaseModel):
    """A complete travel package created by the research agent."""
    package_id: str = ""
    package_name: str = ""
    destination: str = ""
    duration_days: int = 0
    num_travelers: int = 1
    travel_style: str = "balanced"

    # Flights
    outbound_flight: Optional[FlightOption] = None
    return_flight: Optional[FlightOption] = None

    # Hotel
    hotel: Optional[HotelOption] = None

    # Itinerary
    itinerary: List[DayItinerary] = Field(default_factory=list)

    # Costs
    flight_cost: float = 0.0
    hotel_cost: float = 0.0
    activities_cost: float = 0.0
    total_cost: float = 0.0
    cost_per_person: float = 0.0

    # Meta
    highlights: List[str] = Field(default_factory=list)
    included: List[str] = Field(default_factory=list)
    not_included: List[str] = Field(default_factory=list)


# ── Booking Confirmation ────────────────────────────────────

class BookingConfirmation(BaseModel):
    booking_id: str = ""
    package_name: str = ""
    status: str = "confirmed"
    flight_reference: Optional[str] = None
    hotel_reference: Optional[str] = None
    total_amount: float = 0.0
    payment_status: str = "pending"
    payment_url: Optional[str] = None


# ── JSON Helpers ────────────────────────────────────────────

def safe_parse_json(text: str, fallback: dict | list | None = None):
    """Parse JSON from text, trying to extract JSON blocks if direct parse fails."""
    if fallback is None:
        fallback = {}
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        pass
    # Try to find JSON in markdown code blocks
    import re
    patterns = [
        r'```json\s*([\s\S]*?)\s*```',
        r'```\s*([\s\S]*?)\s*```',
        r'\{[\s\S]*\}',
        r'\[[\s\S]*\]',
    ]
    for pattern in patterns:
        match = re.search(pattern, str(text))
        if match:
            try:
                return json.loads(match.group(1) if '```' in pattern else match.group(0))
            except (json.JSONDecodeError, IndexError):
                continue
    return fallback


def parse_trip_request(user_input: str) -> dict:
    """Extract trip parameters from natural language input.
    Returns a dict that can be used to construct a TripRequest.
    This is a helper — the LLM agent does the actual parsing.
    """
    import re
    result = {}

    # Try to extract days
    days_match = re.search(r'(\d+)\s*(?:-\s*)?day', user_input, re.IGNORECASE)
    if days_match:
        result["num_days"] = int(days_match.group(1))

    # Try to extract people/travelers
    people_match = re.search(r'(\d+)\s*(?:people|person|travelers?|adults?|pax)', user_input, re.IGNORECASE)
    if people_match:
        result["num_travelers"] = int(people_match.group(1))

    # Try to extract budget
    budget_match = re.search(r'\$\s*([\d,]+)', user_input)
    if budget_match:
        result["budget_per_person"] = float(budget_match.group(1).replace(",", ""))

    return result
