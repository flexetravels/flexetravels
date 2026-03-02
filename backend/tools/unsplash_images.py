"""
FlexeTravels — Unsplash Images Tool
Fetches beautiful travel destination images from Unsplash API.
Falls back to curated hardcoded photo IDs when no API key is set.
"""

import json
import logging
import urllib.request
import urllib.parse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import UNSPLASH_ACCESS_KEY, HAS_UNSPLASH
from utils.cache import cached_api_call

logger = logging.getLogger(__name__)

# ── Curated fallback photos (destination → Unsplash photo ID) ─────────────
# High-quality travel photos handpicked for each destination
FALLBACK_PHOTOS = {
    "tokyo":        {"id": "1540959733-a743e293a979", "credit": "Louie Martinez"},
    "paris":        {"id": "1502602317-aeefbbd868f8", "credit": "Léonard Cotte"},
    "new york":     {"id": "1485871538-2c9d4027ea09", "credit": "Oliver Niblett"},
    "london":       {"id": "1513635269975-59663e0ac1ad", "credit": "Benjamin Davies"},
    "bali":         {"id": "1537996134847-e26b1b32dfba", "credit": "Artem Beliaikin"},
    "bangkok":      {"id": "1508009603885-50cf7c579365", "credit": "Yoal Desurmont"},
    "singapore":    {"id": "1525625293386-7e83116a2d19", "credit": "Kirill Petropavlov"},
    "dubai":        {"id": "1512453979798-5ea266f8880c", "credit": "ZQ Lee"},
    "rome":         {"id": "1552832230-c0197dd311b5", "credit": "David Köhler"},
    "barcelona":    {"id": "1539037116277-4db20889f2d4", "credit": "Vlad Bitte"},
    "amsterdam":    {"id": "1534351590666-13e3e96b5702", "credit": "Léonard Cotte"},
    "sydney":       {"id": "1523428096881-5bd79d43032a", "credit": "Photoholgic"},
    "miami":        {"id": "1533106497176-424537727d8b", "credit": "Vita Marija Murenaite"},
    "cancun":       {"id": "1552074284-a31cfff8cf73", "credit": "Gabriel Tovar"},
    "istanbul":     {"id": "1541432901042-d8c42ad95d40", "credit": "Miltiadis Fragkidis"},
    "cairo":        {"id": "1539650116574-75c5a82a2c0d", "credit": "Jeremy Zero"},
    "los angeles":  {"id": "1534190760961-74e8c1c5c3da", "credit": "Chris Briggs"},
    "madrid":       {"id": "1543783207-ec64e4d88a28", "credit": "Florian K"},
    "seoul":        {"id": "1557247824-1e09da52d916", "credit": "Jason Richard"},
    "mexico city":  {"id": "1518659832947-c4d5c69a8afe", "credit": "David Vives"},
    "marrakech":    {"id": "1534438097545-a2c22c57f2ad", "credit": "Jeremy Zero"},
    "prague":       {"id": "1541849563517-6db83f3a3480", "credit": "Martin Péchy"},
    "maldives":     {"id": "1514282401047-d79a71a590e8", "credit": "Jeremy Bishop"},
    "santorini":    {"id": "1570077188670-e3a8d69ac5ff", "credit": "Toa Heftiba"},
    "vienna":       {"id": "1557800636-a93f37cac597", "credit": "Kévin et Laurianne Langlais"},
    "lisbon":       {"id": "1558618666-fcd25c85cd64", "credit": "Julie Hofmann"},
    "hong kong":    {"id": "1506869640319-fe1a1fd4202c", "credit": "Kin Li"},
    "berlin":       {"id": "1560969184-10fe8719e047", "credit": "Alexander Michl"},
    "toronto":      {"id": "1517090186835-e348b621c920", "credit": "Izabelle Acheson"},
    "vancouver":    {"id": "1559511260-88f41fb28a01", "credit": "Lorenzo Pierartozzi"},
}

UNSPLASH_BASE_URL = "https://images.unsplash.com/photo-"
UNSPLASH_API_URL = "https://api.unsplash.com/search/photos"


def get_destination_image(destination: str) -> dict:
    """
    Fetch a high-quality travel image for a destination.

    Returns: {url, thumb_url, credit_name, credit_link, source}
    """
    dest_lower = destination.lower().strip()

    if HAS_UNSPLASH:
        try:
            result = _fetch_from_api(destination)
            if result:
                return result
        except Exception as e:
            logger.warning(f"Unsplash API failed for {destination}: {e}")

    # Fallback: use curated hardcoded photos
    return _get_fallback_image(dest_lower, destination)


def _fetch_from_api(destination: str):
    """Fetch image from Unsplash API."""
    query = urllib.parse.quote(f"{destination} travel landmark")

    def _call():
        url = f"{UNSPLASH_API_URL}?query={query}&per_page=3&orientation=landscape"
        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Client-ID {UNSPLASH_ACCESS_KEY}"}
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode())

    data = cached_api_call(
        prefix="unsplash_img",
        params={"dest": destination.lower()},
        fn=_call,
        ttl=86400,  # 24 hours
    )

    results = data.get("results", [])
    if not results:
        return None

    photo = results[0]
    urls = photo.get("urls", {})
    user = photo.get("user", {})

    return {
        "url": urls.get("regular", ""),
        "thumb_url": urls.get("small", ""),
        "credit_name": user.get("name", "Unsplash"),
        "credit_link": user.get("links", {}).get("html", "https://unsplash.com"),
        "source": "unsplash_api",
    }


def _get_fallback_image(dest_lower: str, destination: str) -> dict:
    """Return a curated fallback photo for the destination."""
    # Direct match
    if dest_lower in FALLBACK_PHOTOS:
        p = FALLBACK_PHOTOS[dest_lower]
        return _build_fallback(p["id"], p["credit"], destination)

    # Partial match (e.g., "Bali, Indonesia" → "bali")
    for key, p in FALLBACK_PHOTOS.items():
        if key in dest_lower or dest_lower in key:
            return _build_fallback(p["id"], p["credit"], destination)

    # Generic travel photo
    return {
        "url": f"{UNSPLASH_BASE_URL}1488085061851-d223a4463480?w=800&h=533&fit=crop",
        "thumb_url": f"{UNSPLASH_BASE_URL}1488085061851-d223a4463480?w=400&h=267&fit=crop",
        "credit_name": "Unsplash",
        "credit_link": "https://unsplash.com",
        "source": "fallback",
    }


def _build_fallback(photo_id: str, credit: str, destination: str) -> dict:
    url = f"{UNSPLASH_BASE_URL}{photo_id}?w=800&h=533&fit=crop"
    thumb = f"{UNSPLASH_BASE_URL}{photo_id}?w=400&h=267&fit=crop"
    return {
        "url": url,
        "thumb_url": thumb,
        "credit_name": credit,
        "credit_link": "https://unsplash.com",
        "source": "fallback_curated",
    }
