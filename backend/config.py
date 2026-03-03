"""
FlexeTravels Backend — Configuration
Loads environment variables and provides centralized config.
Powered by Claude AI (Anthropic).
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the backend directory
_backend_dir = Path(__file__).parent
load_dotenv(_backend_dir / ".env", override=True)

# ── LLM Config (Claude / Anthropic) ─────────────────────────
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")
CLAUDE_TEMPERATURE = 0.7
CLAUDE_MAX_TOKENS = 4096

# ── API Keys ────────────────────────────────────────────────
SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")
SERPAPI_API_KEY = os.getenv("SERPAPI_API_KEY", "")  # SerpAPI for Google Flights/Hotels fallback
AMADEUS_API_KEY = os.getenv("AMADEUS_API_KEY", "")
AMADEUS_API_SECRET = os.getenv("AMADEUS_API_SECRET", "")
AMADEUS_CURRENCY = os.getenv("AMADEUS_CURRENCY", "USD")  # Default to USD
DUFFEL_API_KEY = os.getenv("DUFFEL_API_KEY", "")  # Duffel API (alternative to Amadeus)
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE_KEY = os.getenv("STRIPE_PUBLISHABLE_KEY", "")
MAILCHIMP_API_KEY = os.getenv("MAILCHIMP_API_KEY", "")
MAILCHIMP_LIST_ID = os.getenv("MAILCHIMP_LIST_ID", "")
BUFFER_ACCESS_TOKEN = os.getenv("BUFFER_ACCESS_TOKEN", "")
UNSPLASH_ACCESS_KEY = os.getenv("UNSPLASH_ACCESS_KEY", "")

# ── Email / Marketing Config ────────────────────────────────
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")  # Gmail default, override for other servers
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))  # 587=TLS, 25/465=others, adjust per server
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() in ("true", "1", "yes")
MARKETING_EMAIL_RECIPIENT = os.getenv("MARKETING_EMAIL_RECIPIENT", SMTP_USER)
BRAND_NAME = "FlexeTravels"
CHATBOT_URL = os.getenv("CHATBOT_URL", "http://localhost:3000")
CHATBOT_UTM = "utm_source=email&utm_medium=newsletter&utm_campaign=weekly_package"

# ── Feature Flags (auto-detect from keys) ───────────────────
HAS_CLAUDE = bool(ANTHROPIC_API_KEY)
HAS_SERPER = bool(SERPER_API_KEY)
HAS_SERPAPI = bool(SERPAPI_API_KEY)
HAS_AMADEUS = bool(AMADEUS_API_KEY and AMADEUS_API_SECRET)
HAS_DUFFEL = bool(DUFFEL_API_KEY)
HAS_STRIPE = bool(STRIPE_SECRET_KEY)
HAS_MAILCHIMP = bool(MAILCHIMP_API_KEY and MAILCHIMP_LIST_ID)
HAS_BUFFER = bool(BUFFER_ACCESS_TOKEN)
HAS_UNSPLASH = bool(UNSPLASH_ACCESS_KEY)
HAS_EMAIL = bool(SMTP_USER and SMTP_PASSWORD)

# ── API Selector (choose primary travel API) ────────────────────
# Options: "amadeus" (limited hotel coverage) or "duffel" (global coverage)
# Falls back automatically if primary API unavailable or returns 0 results
ACTIVE_TRAVEL_API = os.getenv("ACTIVE_TRAVEL_API", "amadeus")

# ── Server Config ──────────────────────────────────────────
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

# ── Retry Config ────────────────────────────────────────────
MAX_RETRIES = 3
RETRY_DELAY = 1.0
RETRY_MAX_DELAY = 10.0

# ── Cache Config ────────────────────────────────────────────
CACHE_DIR = _backend_dir / ".cache"
CACHE_TTL = 3600  # 1 hour default

# ── Agent Config ────────────────────────────────────────────
MAX_AGENT_ITERATIONS = 15
AGENT_VERBOSE = True

# Token budget management
MAX_CONVERSATION_TOKENS = 8000  # Keep conversations compact
MAX_TOOL_RESULT_TOKENS = 2000  # Truncate tool results
SYSTEM_PROMPT_BUDGET = 1500    # Budget for system prompts

# ── Paths ───────────────────────────────────────────────────
LOGS_DIR = _backend_dir / "logs"
LOGS_DIR.mkdir(exist_ok=True)
CACHE_DIR.mkdir(exist_ok=True)


def validate_required_keys():
    """Check that minimum required keys are set. Returns list of warnings."""
    warnings = []
    if not HAS_CLAUDE:
        warnings.append("ANTHROPIC_API_KEY not set - AI agents will not function")
    if not HAS_SERPER:
        warnings.append("SERPER_API_KEY not set - web search will use mock data")
    if not HAS_SERPAPI:
        warnings.append("SERPAPI_API_KEY not set - Google Flights/Hotels fallback disabled")
    if not HAS_AMADEUS and not HAS_DUFFEL:
        warnings.append("Neither Amadeus nor Duffel configured - flight/hotel search disabled")
    if not HAS_STRIPE:
        warnings.append("Stripe key not set - payments use mock checkout links")
    if not HAS_MAILCHIMP:
        warnings.append("Mailchimp keys not set - emails logged to file")
    if not HAS_BUFFER:
        warnings.append("Buffer key not set - social posts logged to file")
    if not HAS_UNSPLASH:
        warnings.append("UNSPLASH_ACCESS_KEY not set - tour images use fallback photos")
    if not HAS_EMAIL:
        warnings.append("SMTP credentials not set - marketing emails will not send")
    return warnings


def get_status():
    """Return a status dict for health checks."""
    return {
        "ai_engine": "Claude (Anthropic)" if HAS_CLAUDE else "Fallback (no API key)",
        "model": CLAUDE_MODEL,
        "active_travel_api": ACTIVE_TRAVEL_API,
        "services": {
            "claude_ai": HAS_CLAUDE,
            "amadeus_flights": HAS_AMADEUS,
            "duffel_api": HAS_DUFFEL,
            "serpapi_fallback": HAS_SERPAPI,
            "stripe_payments": HAS_STRIPE,
            "serper_maps": HAS_SERPER,
            "mailchimp_email": HAS_MAILCHIMP,
            "buffer_social": HAS_BUFFER,
            "unsplash_images": HAS_UNSPLASH,
            "email_marketing": HAS_EMAIL,
        },
        "warnings": validate_required_keys(),
    }
