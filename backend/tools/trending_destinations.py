"""
FlexeTravels — Trending Destinations Tool
Combines Amadeus Travel Analytics + Claude AI + Unsplash to generate
personalised tour packages based on user's origin city.
"""

import json
import logging
import random
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import ANTHROPIC_API_KEY, CLAUDE_MODEL, HAS_AMADEUS, HAS_CLAUDE
from utils.cache import cached_api_call

logger = logging.getLogger(__name__)

# ── IATA Destination Code → City/Country Name ─────────────────────────────
IATA_TO_CITY = {
    "LON": ("London", "United Kingdom"),      "LHR": ("London", "United Kingdom"),
    "PAR": ("Paris", "France"),               "CDG": ("Paris", "France"),
    "NYC": ("New York", "USA"),               "JFK": ("New York", "USA"),
    "LAX": ("Los Angeles", "USA"),            "MIA": ("Miami", "USA"),
    "NRT": ("Tokyo", "Japan"),                "TYO": ("Tokyo", "Japan"),
    "HND": ("Tokyo", "Japan"),                "ICN": ("Seoul", "South Korea"),
    "SIN": ("Singapore", "Singapore"),        "HKG": ("Hong Kong", "China"),
    "DXB": ("Dubai", "UAE"),                  "BKK": ("Bangkok", "Thailand"),
    "SYD": ("Sydney", "Australia"),           "MEL": ("Melbourne", "Australia"),
    "FCO": ("Rome", "Italy"),                 "BCN": ("Barcelona", "Spain"),
    "AMS": ("Amsterdam", "Netherlands"),      "FRA": ("Frankfurt", "Germany"),
    "MUC": ("Munich", "Germany"),             "MAD": ("Madrid", "Spain"),
    "IST": ("Istanbul", "Turkey"),            "ATH": ("Athens", "Greece"),
    "CPH": ("Copenhagen", "Denmark"),         "VIE": ("Vienna", "Austria"),
    "ZRH": ("Zurich", "Switzerland"),         "PRG": ("Prague", "Czech Republic"),
    "LIS": ("Lisbon", "Portugal"),            "DUB": ("Dublin", "Ireland"),
    "DEL": ("New Delhi", "India"),            "BOM": ("Mumbai", "India"),
    "PEK": ("Beijing", "China"),              "PVG": ("Shanghai", "China"),
    "KUL": ("Kuala Lumpur", "Malaysia"),      "MNL": ("Manila", "Philippines"),
    "CGK": ("Jakarta", "Indonesia"),          "DPS": ("Bali", "Indonesia"),
    "DOH": ("Doha", "Qatar"),                 "AUH": ("Abu Dhabi", "UAE"),
    "ORD": ("Chicago", "USA"),                "SEA": ("Seattle", "USA"),
    "SFO": ("San Francisco", "USA"),          "YVR": ("Vancouver", "Canada"),
    "YYZ": ("Toronto", "Canada"),             "GRU": ("São Paulo", "Brazil"),
    "EZE": ("Buenos Aires", "Argentina"),     "BOG": ("Bogotá", "Colombia"),
    "SCL": ("Santiago", "Chile"),             "LIM": ("Lima", "Peru"),
    "MEX": ("Mexico City", "Mexico"),         "CUN": ("Cancún", "Mexico"),
    "CAI": ("Cairo", "Egypt"),                "JNB": ("Johannesburg", "South Africa"),
    "NBO": ("Nairobi", "Kenya"),              "CMN": ("Casablanca", "Morocco"),
    "ATL": ("Atlanta", "USA"),                "DFW": ("Dallas", "USA"),
    "BOS": ("Boston", "USA"),                 "LAS": ("Las Vegas", "USA"),
    "MXP": ("Milan", "Italy"),                "OSL": ("Oslo", "Norway"),
    "ARN": ("Stockholm", "Sweden"),           "HEL": ("Helsinki", "Finland"),
    "WAW": ("Warsaw", "Poland"),              "BUD": ("Budapest", "Hungary"),
    "BER": ("Berlin", "Germany"),             "GLA": ("Glasgow", "Scotland"),
    "EDI": ("Edinburgh", "Scotland"),         "TPE": ("Taipei", "Taiwan"),
    "SGN": ("Ho Chi Minh City", "Vietnam"),   "HAN": ("Hanoi", "Vietnam"),
    "BLR": ("Bangalore", "India"),            "TLV": ("Tel Aviv", "Israel"),
    "AKL": ("Auckland", "New Zealand"),       "RUH": ("Riyadh", "Saudi Arabia"),
}

# ── Global Fallback Tours (shown when Amadeus/Claude unavailable) ──────────
GLOBAL_FALLBACK_TOURS = [
    {"title": "Discover Japan", "destination": "Tokyo", "country": "Japan",
     "tagline": "Ancient temples meet neon skylines", "route": "Tokyo → Kyoto → Osaka → Hiroshima",
     "duration_days": 14, "price_from": 3850, "badge": "AI Pick", "badge_type": "ai",
     "why_exciting": "Blend of ultra-modern cities and centuries-old traditions",
     "rating": 4.8, "image_url": None},
    {"title": "Highlights of Italy", "destination": "Rome", "country": "Italy",
     "tagline": "La dolce vita awaits", "route": "Rome → Florence → Venice → Amalfi Coast",
     "duration_days": 10, "price_from": 2490, "badge": "Best Seller", "badge_type": "hot",
     "why_exciting": "World-class art, cuisine, and coastlines in one perfect journey",
     "rating": 4.9, "image_url": None},
    {"title": "Bali & Beyond", "destination": "Bali", "country": "Indonesia",
     "tagline": "Where paradise meets culture", "route": "Ubud → Seminyak → Nusa Penida",
     "duration_days": 8, "price_from": 1690, "badge": "20% Off", "badge_type": "sale",
     "why_exciting": "Lush rice terraces, stunning temples, and pristine beaches",
     "rating": 4.9, "image_url": None},
    {"title": "Moroccan Wonders", "destination": "Marrakech", "country": "Morocco",
     "tagline": "A sensory feast for the soul", "route": "Marrakech → Sahara → Fes → Chefchaouen",
     "duration_days": 12, "price_from": 2190, "badge": "AI Pick", "badge_type": "ai",
     "why_exciting": "Vibrant souks, Sahara sunsets, and the magical Blue City",
     "rating": 4.7, "image_url": None},
    {"title": "Singapore & Beyond", "destination": "Singapore", "country": "Singapore",
     "tagline": "The gateway to Southeast Asia", "route": "Singapore → Sentosa → Gardens by the Bay",
     "duration_days": 7, "price_from": 2890, "badge": "New", "badge_type": "new",
     "why_exciting": "Futuristic city-state with world-class food and architecture",
     "rating": 4.8, "image_url": None},
    {"title": "Paris & Riviera", "destination": "Paris", "country": "France",
     "tagline": "Romance, art, and haute cuisine", "route": "Paris → Loire Valley → Nice → Monaco",
     "duration_days": 10, "price_from": 3200, "badge": "Best Seller", "badge_type": "hot",
     "why_exciting": "The Eiffel Tower, Versailles, and sun-drenched Côte d'Azur",
     "rating": 4.9, "image_url": None},
]


def get_trending_tours(origin_iata: str, user_city: str, count: int = 6) -> list:
    """
    Generate personalised tour packages based on user's origin airport.

    Args:
        origin_iata: User's nearest airport IATA code (e.g., 'JFK', 'LHR')
        user_city: Human-readable city name for logging
        count: Number of tours to return (default 6)

    Returns:
        List of tour card dicts with images, pricing, and AI-generated descriptions
    """
    cache_key = f"{origin_iata.upper()}_{count}"

    def _generate():
        return _build_tours(origin_iata, user_city, count)

    try:
        tours = cached_api_call(
            prefix="trending_tours_v2",
            params={"origin": origin_iata.upper(), "count": count},
            fn=_generate,
            ttl=21600,  # 6 hours
        )
        if tours and isinstance(tours, list):
            return tours
    except Exception as e:
        logger.warning(f"Trending tours cache/fetch failed: {e}")

    return _with_images(GLOBAL_FALLBACK_TOURS[:count])


def _build_tours(origin_iata: str, user_city: str, count: int) -> list:
    """Fetch destinations from Amadeus, then package with Claude + images."""
    # Step 1: Get top destinations from Amadeus Travel Analytics
    destination_codes = _get_amadeus_destinations(origin_iata, count + 4)  # extra for filtering

    if not destination_codes:
        logger.info(f"No Amadeus analytics for {origin_iata}, using curated fallback")
        return _with_images(GLOBAL_FALLBACK_TOURS[:count])

    # Step 2: Map IATA codes to city names
    destinations = []
    for code in destination_codes:
        if code.upper() in IATA_TO_CITY:
            city, country = IATA_TO_CITY[code.upper()]
            if city.lower() != user_city.lower():  # Skip user's own city
                destinations.append({"code": code, "city": city, "country": country})

    if not destinations:
        return _with_images(GLOBAL_FALLBACK_TOURS[:count])

    destinations = destinations[:count]

    # Step 3: Claude generates all tour packages in one call
    if HAS_CLAUDE:
        try:
            tours = _claude_generate_tours(destinations, user_city, origin_iata)
            if tours:
                return _with_images(tours)
        except Exception as e:
            logger.warning(f"Claude tour generation failed: {e}")

    # Step 4: Fallback — basic tour packages without AI descriptions
    basic_tours = _basic_tours_from_destinations(destinations)
    return _with_images(basic_tours)


def _get_amadeus_destinations(origin_iata: str, limit: int) -> list:
    """Query Amadeus Travel Analytics for most-traveled destinations."""
    if not HAS_AMADEUS:
        return []
    try:
        from amadeus import Client, ResponseError
        from config import AMADEUS_API_KEY, AMADEUS_API_SECRET

        amadeus = Client(client_id=AMADEUS_API_KEY, client_secret=AMADEUS_API_SECRET)
        response = amadeus.travel.analytics.air_traffic.traveled.get(
            originCityCode=origin_iata.upper(),
            period="2017-01",
        )
        if hasattr(response, "data") and response.data:
            return [d.get("destination", "") for d in response.data[:limit] if d.get("destination")]
    except Exception as e:
        logger.warning(f"Amadeus analytics failed for {origin_iata}: {e}")
    return []


def _claude_generate_tours(destinations: list, user_city: str, origin_iata: str) -> list:
    """Use Claude to generate compelling tour packages for the given destinations."""
    import anthropic

    dest_list = "\n".join(
        f"- {d['city']}, {d['country']}" for d in destinations
    )

    prompt = f"""You are FlexeTravels' AI tour curator. Generate compelling tour packages for travelers from {user_city}.

Destinations to package (these are trending routes from {origin_iata}):
{dest_list}

For each destination, create a JSON object with these exact fields:
- title: Creative tour name (e.g., "Discover Japan", "Moroccan Dreams")
- destination: City name
- country: Country name
- tagline: Punchy 5-8 word tagline that creates desire
- route: 3-4 key stops (e.g., "Tokyo → Kyoto → Osaka → Hiroshima")
- duration_days: Realistic trip duration (integer, 7-14 days)
- price_from: Estimated starting price in USD (integer, realistic for the destination from {user_city})
- badge: One of: "AI Pick", "Best Seller", "Trending", "20% Off", "New", or null
- badge_type: One of: "ai", "hot", "new", "sale", or null
- why_exciting: One sentence on why this trip is unmissable right now
- rating: Float between 4.5 and 5.0

Return ONLY a valid JSON array, no markdown, no explanation.
Example: [{{"title": "...", "destination": "...", ...}}, ...]"""

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    message = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}]
    )

    raw = message.content[0].text.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip().rstrip("```").strip()

    tours = json.loads(raw)
    if not isinstance(tours, list):
        return []
    return tours


def _basic_tours_from_destinations(destinations: list) -> list:
    """Generate minimal tour cards without AI descriptions."""
    badges = ["AI Pick", "Trending", "Best Seller", None, "New", None]
    badge_types = ["ai", "hot", "hot", None, "new", None]
    tours = []
    for i, dest in enumerate(destinations):
        tours.append({
            "title": f"Explore {dest['city']}",
            "destination": dest["city"],
            "country": dest["country"],
            "tagline": f"Discover the best of {dest['country']}",
            "route": f"{dest['city']} highlights",
            "duration_days": random.choice([7, 8, 10, 12, 14]),
            "price_from": random.randint(1500, 4500),
            "badge": badges[i % len(badges)],
            "badge_type": badge_types[i % len(badge_types)],
            "why_exciting": f"A journey through the heart of {dest['country']}",
            "rating": round(random.uniform(4.5, 4.9), 1),
        })
    return tours


def _with_images(tours: list) -> list:
    """Attach Unsplash image to each tour."""
    from tools.unsplash_images import get_destination_image
    result = []
    for t in tours:
        t = dict(t)  # copy
        dest = t.get("destination", "travel")
        img = get_destination_image(dest)
        t["image_url"] = img.get("url", "")
        t["image_thumb"] = img.get("thumb_url", "")
        t["image_credit"] = img.get("credit_name", "")
        result.append(t)
    return result
