"""
FlexeTravels — Travel Style Suggestions
Returns location-relevant destination suggestions per travel style.
Uses a region-based mapping (no API calls needed — fast and free).
"""

import logging
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.cache import get_cached, set_cached

logger = logging.getLogger(__name__)

# ── Region Detection ────────────────────────────────────────────

_REGION_MAP = {
    # North America
    "US": "north_america", "CA": "north_america", "MX": "north_america",
    # Europe
    "GB": "europe", "DE": "europe", "FR": "europe", "IT": "europe",
    "ES": "europe", "NL": "europe", "PT": "europe", "SE": "europe",
    "NO": "europe", "DK": "europe", "FI": "europe", "CH": "europe",
    "AT": "europe", "IE": "europe", "BE": "europe", "PL": "europe",
    "CZ": "europe", "GR": "europe", "RO": "europe", "HU": "europe",
    "BG": "europe", "HR": "europe", "IS": "europe", "LT": "europe",
    "LV": "europe", "EE": "europe", "SK": "europe", "SI": "europe",
    # Asia
    "CN": "asia", "JP": "asia", "KR": "asia", "IN": "asia",
    "TH": "asia", "VN": "asia", "SG": "asia", "MY": "asia",
    "ID": "asia", "PH": "asia", "TW": "asia", "HK": "asia",
    "LK": "asia", "NP": "asia", "KH": "asia", "MM": "asia",
    # Oceania
    "AU": "oceania", "NZ": "oceania", "FJ": "oceania",
    # Middle East
    "AE": "middle_east", "SA": "middle_east", "QA": "middle_east",
    "IL": "middle_east", "TR": "middle_east", "OM": "middle_east",
    "JO": "middle_east", "BH": "middle_east", "KW": "middle_east",
    # Latin America
    "BR": "latin_america", "AR": "latin_america", "CL": "latin_america",
    "CO": "latin_america", "PE": "latin_america", "EC": "latin_america",
    "CR": "latin_america", "PA": "latin_america", "UY": "latin_america",
    # Africa
    "ZA": "africa", "EG": "africa", "MA": "africa", "KE": "africa",
    "NG": "africa", "TZ": "africa", "GH": "africa", "ET": "africa",
}


def _get_region(country_code: str) -> str:
    return _REGION_MAP.get(country_code.upper(), "north_america")


# ── Style Definitions ───────────────────────────────────────────

STYLES_META = [
    {"key": "adventure", "name": "Adventure", "emoji": "🏔️",
     "tagline": "Push your limits, explore the wild",
     "image": "https://images.unsplash.com/photo-1551632811-561732d1e306?w=600&h=400&fit=crop"},
    {"key": "cultural", "name": "Cultural", "emoji": "🏛️",
     "tagline": "Immerse in history, art & traditions",
     "image": "https://images.unsplash.com/photo-1533669955142-6a73332af4db?w=600&h=400&fit=crop"},
    {"key": "luxury", "name": "Luxury", "emoji": "💎",
     "tagline": "Indulge in the finest experiences",
     "image": "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=600&h=400&fit=crop"},
    {"key": "family", "name": "Family", "emoji": "👨‍👩‍👧‍👦",
     "tagline": "Create unforgettable memories together",
     "image": "https://images.unsplash.com/photo-1511895426328-dc8714191300?w=600&h=400&fit=crop"},
    {"key": "solo", "name": "Solo", "emoji": "🎒",
     "tagline": "Find yourself on the road",
     "image": "https://images.unsplash.com/photo-1501555088652-021faa106b9b?w=600&h=400&fit=crop"},
    {"key": "wellness", "name": "Wellness", "emoji": "🧘",
     "tagline": "Rejuvenate body, mind & soul",
     "image": "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=600&h=400&fit=crop"},
]


# ── Region-Based Destination Suggestions ────────────────────────
# Each region has 3 destination suggestions per style.
# Mix of nearby (easy reach) and aspirational (bucket-list) destinations.

STYLE_DESTINATIONS = {
    "north_america": {
        "adventure": [
            {"name": "Banff", "country": "Canada"},
            {"name": "Costa Rica", "country": "Costa Rica"},
            {"name": "Patagonia", "country": "Argentina"},
        ],
        "cultural": [
            {"name": "Mexico City", "country": "Mexico"},
            {"name": "Kyoto", "country": "Japan"},
            {"name": "Marrakech", "country": "Morocco"},
        ],
        "luxury": [
            {"name": "Maldives", "country": "Maldives"},
            {"name": "Santorini", "country": "Greece"},
            {"name": "Bora Bora", "country": "French Polynesia"},
        ],
        "family": [
            {"name": "Orlando", "country": "USA"},
            {"name": "Cancún", "country": "Mexico"},
            {"name": "Hawaii", "country": "USA"},
        ],
        "solo": [
            {"name": "Iceland", "country": "Iceland"},
            {"name": "Lisbon", "country": "Portugal"},
            {"name": "Medellín", "country": "Colombia"},
        ],
        "wellness": [
            {"name": "Tulum", "country": "Mexico"},
            {"name": "Sedona", "country": "USA"},
            {"name": "Bali", "country": "Indonesia"},
        ],
    },
    "europe": {
        "adventure": [
            {"name": "Swiss Alps", "country": "Switzerland"},
            {"name": "Iceland", "country": "Iceland"},
            {"name": "Norwegian Fjords", "country": "Norway"},
        ],
        "cultural": [
            {"name": "Rome", "country": "Italy"},
            {"name": "Istanbul", "country": "Turkey"},
            {"name": "Fez", "country": "Morocco"},
        ],
        "luxury": [
            {"name": "Amalfi Coast", "country": "Italy"},
            {"name": "Maldives", "country": "Maldives"},
            {"name": "French Riviera", "country": "France"},
        ],
        "family": [
            {"name": "Barcelona", "country": "Spain"},
            {"name": "Amsterdam", "country": "Netherlands"},
            {"name": "Algarve", "country": "Portugal"},
        ],
        "solo": [
            {"name": "Lisbon", "country": "Portugal"},
            {"name": "Split", "country": "Croatia"},
            {"name": "Edinburgh", "country": "Scotland"},
        ],
        "wellness": [
            {"name": "Bali", "country": "Indonesia"},
            {"name": "Tuscany", "country": "Italy"},
            {"name": "Lake Bled", "country": "Slovenia"},
        ],
    },
    "asia": {
        "adventure": [
            {"name": "Nepal Himalayas", "country": "Nepal"},
            {"name": "Borneo", "country": "Malaysia"},
            {"name": "New Zealand", "country": "New Zealand"},
        ],
        "cultural": [
            {"name": "Kyoto", "country": "Japan"},
            {"name": "Angkor Wat", "country": "Cambodia"},
            {"name": "Varanasi", "country": "India"},
        ],
        "luxury": [
            {"name": "Maldives", "country": "Maldives"},
            {"name": "Bora Bora", "country": "French Polynesia"},
            {"name": "Amalfi Coast", "country": "Italy"},
        ],
        "family": [
            {"name": "Singapore", "country": "Singapore"},
            {"name": "Tokyo", "country": "Japan"},
            {"name": "Phuket", "country": "Thailand"},
        ],
        "solo": [
            {"name": "Vietnam", "country": "Vietnam"},
            {"name": "Sri Lanka", "country": "Sri Lanka"},
            {"name": "Lisbon", "country": "Portugal"},
        ],
        "wellness": [
            {"name": "Bali", "country": "Indonesia"},
            {"name": "Rishikesh", "country": "India"},
            {"name": "Chiang Mai", "country": "Thailand"},
        ],
    },
    "oceania": {
        "adventure": [
            {"name": "Queenstown", "country": "New Zealand"},
            {"name": "Great Barrier Reef", "country": "Australia"},
            {"name": "Patagonia", "country": "Argentina"},
        ],
        "cultural": [
            {"name": "Kyoto", "country": "Japan"},
            {"name": "Bali", "country": "Indonesia"},
            {"name": "Rome", "country": "Italy"},
        ],
        "luxury": [
            {"name": "Fiji", "country": "Fiji"},
            {"name": "Maldives", "country": "Maldives"},
            {"name": "Santorini", "country": "Greece"},
        ],
        "family": [
            {"name": "Gold Coast", "country": "Australia"},
            {"name": "Fiji", "country": "Fiji"},
            {"name": "Singapore", "country": "Singapore"},
        ],
        "solo": [
            {"name": "Vietnam", "country": "Vietnam"},
            {"name": "Japan", "country": "Japan"},
            {"name": "South Island", "country": "New Zealand"},
        ],
        "wellness": [
            {"name": "Bali", "country": "Indonesia"},
            {"name": "Byron Bay", "country": "Australia"},
            {"name": "Thailand", "country": "Thailand"},
        ],
    },
    "middle_east": {
        "adventure": [
            {"name": "Oman", "country": "Oman"},
            {"name": "Cappadocia", "country": "Turkey"},
            {"name": "Jordan", "country": "Jordan"},
        ],
        "cultural": [
            {"name": "Istanbul", "country": "Turkey"},
            {"name": "Petra", "country": "Jordan"},
            {"name": "Marrakech", "country": "Morocco"},
        ],
        "luxury": [
            {"name": "Maldives", "country": "Maldives"},
            {"name": "Seychelles", "country": "Seychelles"},
            {"name": "Santorini", "country": "Greece"},
        ],
        "family": [
            {"name": "Dubai", "country": "UAE"},
            {"name": "Istanbul", "country": "Turkey"},
            {"name": "Antalya", "country": "Turkey"},
        ],
        "solo": [
            {"name": "Georgia", "country": "Georgia"},
            {"name": "Sri Lanka", "country": "Sri Lanka"},
            {"name": "Portugal", "country": "Portugal"},
        ],
        "wellness": [
            {"name": "Dead Sea", "country": "Jordan"},
            {"name": "Bali", "country": "Indonesia"},
            {"name": "Kerala", "country": "India"},
        ],
    },
    "latin_america": {
        "adventure": [
            {"name": "Patagonia", "country": "Argentina"},
            {"name": "Galápagos", "country": "Ecuador"},
            {"name": "Machu Picchu", "country": "Peru"},
        ],
        "cultural": [
            {"name": "Oaxaca", "country": "Mexico"},
            {"name": "Havana", "country": "Cuba"},
            {"name": "Cusco", "country": "Peru"},
        ],
        "luxury": [
            {"name": "Cartagena", "country": "Colombia"},
            {"name": "Maldives", "country": "Maldives"},
            {"name": "Santorini", "country": "Greece"},
        ],
        "family": [
            {"name": "Cancún", "country": "Mexico"},
            {"name": "Costa Rica", "country": "Costa Rica"},
            {"name": "Orlando", "country": "USA"},
        ],
        "solo": [
            {"name": "Medellín", "country": "Colombia"},
            {"name": "Buenos Aires", "country": "Argentina"},
            {"name": "Lisbon", "country": "Portugal"},
        ],
        "wellness": [
            {"name": "Tulum", "country": "Mexico"},
            {"name": "Sacred Valley", "country": "Peru"},
            {"name": "Bali", "country": "Indonesia"},
        ],
    },
    "africa": {
        "adventure": [
            {"name": "Serengeti", "country": "Tanzania"},
            {"name": "Victoria Falls", "country": "Zambia"},
            {"name": "Atlas Mountains", "country": "Morocco"},
        ],
        "cultural": [
            {"name": "Marrakech", "country": "Morocco"},
            {"name": "Cairo", "country": "Egypt"},
            {"name": "Stone Town", "country": "Tanzania"},
        ],
        "luxury": [
            {"name": "Cape Winelands", "country": "South Africa"},
            {"name": "Seychelles", "country": "Seychelles"},
            {"name": "Maldives", "country": "Maldives"},
        ],
        "family": [
            {"name": "Cape Town", "country": "South Africa"},
            {"name": "Mauritius", "country": "Mauritius"},
            {"name": "Marrakech", "country": "Morocco"},
        ],
        "solo": [
            {"name": "Morocco", "country": "Morocco"},
            {"name": "Ghana", "country": "Ghana"},
            {"name": "Ethiopia", "country": "Ethiopia"},
        ],
        "wellness": [
            {"name": "Zanzibar", "country": "Tanzania"},
            {"name": "Bali", "country": "Indonesia"},
            {"name": "Kerala", "country": "India"},
        ],
    },
}


def get_travel_style_suggestions(city: str, country_code: str) -> list:
    """
    Return 6 travel style cards with location-relevant destination suggestions.

    Args:
        city: User's detected city name
        country_code: 2-letter ISO country code

    Returns:
        List of 6 dicts, each with: key, name, emoji, tagline, image,
        destinations (list of {name, country})
    """
    cache_params = {"country_code": country_code, "type": "travel_styles_v2"}
    cached = get_cached("travel_styles", cache_params, ttl=86400)  # 24h
    if cached:
        return cached

    region = _get_region(country_code)
    region_dests = STYLE_DESTINATIONS.get(region, STYLE_DESTINATIONS["north_america"])

    styles = []
    for meta in STYLES_META:
        style = {
            **meta,
            "destinations": region_dests.get(meta["key"], []),
        }
        styles.append(style)

    set_cached("travel_styles", cache_params, styles)
    logger.info(f"Travel styles generated for {city} ({country_code}) → region: {region}")
    return styles
