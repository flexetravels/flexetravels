"""
FlexeTravels — IP Geolocation Tool
Converts a visitor's IP address to city/country/IATA code using ip-api.com (free, no key).
"""

import json
import logging
from pathlib import Path
import sys

import urllib.request
import urllib.error

sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.cache import cached_api_call

logger = logging.getLogger(__name__)

# ── City → Nearest Airport IATA Code Mapping ──────────────────────────────
# Maps lowercase city names (from ip-api.com) to their nearest major airport
CITY_TO_IATA = {
    # North America
    "new york": "JFK", "new york city": "JFK", "brooklyn": "JFK", "queens": "JFK",
    "los angeles": "LAX", "san francisco": "SFO", "chicago": "ORD",
    "miami": "MIA", "dallas": "DFW", "seattle": "SEA", "boston": "BOS",
    "denver": "DEN", "atlanta": "ATL", "houston": "IAH", "phoenix": "PHX",
    "san diego": "SAN", "portland": "PDX", "minneapolis": "MSP",
    "philadelphia": "PHL", "orlando": "MCO", "tampa": "TPA",
    "charlotte": "CLT", "detroit": "DTW", "las vegas": "LAS",
    "honolulu": "HNL", "nashville": "BNA", "raleigh": "RDU",
    "salt lake city": "SLC", "indianapolis": "IND", "columbus": "CMH",
    "austin": "AUS", "san jose": "SJC", "sacramento": "SMF",
    "kansas city": "MCI", "memphis": "MEM", "new orleans": "MSY",
    "pittsburgh": "PIT", "st. louis": "STL", "saint louis": "STL",
    "cincinnati": "CVG", "oklahoma city": "OKC", "buffalo": "BUF",
    # Canada
    "vancouver": "YVR", "toronto": "YYZ", "montreal": "YUL",
    "calgary": "YYC", "ottawa": "YOW", "edmonton": "YEG",
    "winnipeg": "YWG", "quebec city": "YQB",
    # UK / Ireland
    "london": "LHR", "manchester": "MAN", "birmingham": "BHX",
    "edinburgh": "EDI", "glasgow": "GLA", "dublin": "DUB",
    # Europe
    "paris": "CDG", "amsterdam": "AMS", "frankfurt": "FRA",
    "munich": "MUC", "berlin": "BER", "madrid": "MAD",
    "barcelona": "BCN", "rome": "FCO", "milan": "MXP",
    "zurich": "ZRH", "vienna": "VIE", "brussels": "BRU",
    "lisbon": "LIS", "athens": "ATH", "istanbul": "IST",
    "copenhagen": "CPH", "oslo": "OSL", "stockholm": "ARN",
    "helsinki": "HEL", "prague": "PRG", "warsaw": "WAW",
    "budapest": "BUD",
    # Asia
    "tokyo": "NRT", "osaka": "KIX", "beijing": "PEK", "shanghai": "PVG",
    "hong kong": "HKG", "singapore": "SIN", "seoul": "ICN",
    "bangkok": "BKK", "kuala lumpur": "KUL", "jakarta": "CGK",
    "mumbai": "BOM", "delhi": "DEL", "new delhi": "DEL",
    "taipei": "TPE", "manila": "MNL", "ho chi minh city": "SGN",
    "hanoi": "HAN", "chennai": "MAA", "bengaluru": "BLR",
    "bangalore": "BLR", "hyderabad": "HYD",
    # Middle East
    "dubai": "DXB", "abu dhabi": "AUH", "doha": "DOH",
    "riyadh": "RUH", "tel aviv": "TLV",
    # Africa
    "cairo": "CAI", "johannesburg": "JNB", "cape town": "CPT",
    "nairobi": "NBO", "casablanca": "CMN",
    # Oceania
    "sydney": "SYD", "melbourne": "MEL", "brisbane": "BNE",
    "perth": "PER", "auckland": "AKL",
    # Latin America
    "mexico city": "MEX", "cancun": "CUN", "guadalajara": "GDL",
    "sao paulo": "GRU", "rio de janeiro": "GIG", "buenos aires": "EZE",
    "bogota": "BOG", "lima": "LIM", "santiago": "SCL",
    "caracas": "CCS", "medellin": "MDE",
}

# Country code → default IATA (fallback when city not in map)
COUNTRY_TO_IATA = {
    "US": "JFK", "CA": "YYZ", "GB": "LHR", "AU": "SYD",
    "DE": "FRA", "FR": "CDG", "IT": "FCO", "ES": "MAD",
    "NL": "AMS", "JP": "NRT", "CN": "PEK", "IN": "DEL",
    "BR": "GRU", "MX": "MEX", "SG": "SIN", "AE": "DXB",
    "ZA": "JNB", "KR": "ICN", "TH": "BKK", "MY": "KUL",
    "ID": "CGK", "PH": "MNL", "NZ": "AKL", "AR": "EZE",
    "CO": "BOG", "CL": "SCL", "PE": "LIM", "TR": "IST",
    "SA": "RUH", "EG": "CAI", "NG": "LOS", "KE": "NBO",
    "MA": "CMN", "SE": "ARN", "NO": "OSL", "DK": "CPH",
    "FI": "HEL", "PT": "LIS", "GR": "ATH", "PL": "WAW",
    "CZ": "PRG", "HU": "BUD", "AT": "VIE", "CH": "ZRH",
    "BE": "BRU", "IE": "DUB", "IL": "TLV", "QA": "DOH",
    "VN": "SGN", "TW": "TPE", "HK": "HKG",
}


def get_location_from_ip(ip: str) -> dict:
    """
    Get user location from IP address using ip-api.com (free, no key needed).
    Returns city, country, and nearest IATA airport code.
    """
    # Strip localhost / private IPs — fall back to US default
    if not ip or ip in ("127.0.0.1", "::1", "localhost") or ip.startswith("192.168.") or ip.startswith("10."):
        logger.info(f"Local/private IP {ip!r} detected — defaulting to New York")
        return _default_location("New York", "US")

    def _fetch():
        url = f"http://ip-api.com/json/{ip}?fields=status,country,countryCode,city,lat,lon"
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            return {"status": "fail", "error": str(e)}

    try:
        data = cached_api_call(
            prefix="ip_geo",
            params={"ip": ip},
            fn=_fetch,
            ttl=86400,  # 24 hours
        )

        if isinstance(data, dict) and data.get("status") == "success":
            city = data.get("city", "")
            country_code = data.get("countryCode", "")
            country = data.get("country", "")

            iata = _resolve_iata(city, country_code)
            logger.info(f"IP {ip} → {city}, {country} → {iata}")

            return {
                "city": city,
                "country": country,
                "country_code": country_code,
                "iata_code": iata,
                "lat": data.get("lat", 0),
                "lon": data.get("lon", 0),
            }
    except Exception as e:
        logger.warning(f"IP geolocation failed for {ip}: {e}")

    return _default_location("New York", "US")


def _resolve_iata(city: str, country_code: str) -> str:
    """Map city name and country code to nearest IATA airport."""
    city_lower = city.lower().strip()
    if city_lower in CITY_TO_IATA:
        return CITY_TO_IATA[city_lower]
    # Try partial match
    for known_city, iata in CITY_TO_IATA.items():
        if known_city in city_lower or city_lower in known_city:
            return iata
    # Country fallback
    return COUNTRY_TO_IATA.get(country_code, "JFK")


def _default_location(city: str, country_code: str) -> dict:
    return {
        "city": city,
        "country": "United States" if country_code == "US" else country_code,
        "country_code": country_code,
        "iata_code": _resolve_iata(city, country_code),
        "lat": 40.7128,
        "lon": -74.0060,
    }
