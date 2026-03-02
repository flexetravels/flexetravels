"""
FlexeTravels — File-based Cache
Minimizes API costs by caching responses with TTL.
"""

import json
import hashlib
import time
from pathlib import Path
from typing import Any, Optional, Callable

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import CACHE_DIR, CACHE_TTL


def _cache_key(prefix: str, params: dict) -> str:
    """Generate a deterministic cache key from prefix + params."""
    raw = f"{prefix}:{json.dumps(params, sort_keys=True)}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _cache_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.json"


def get_cached(prefix: str, params: dict, ttl: int = CACHE_TTL) -> Optional[Any]:
    """Retrieve a cached result if it exists and isn't expired."""
    key = _cache_key(prefix, params)
    path = _cache_path(key)

    if not path.exists():
        return None

    try:
        data = json.loads(path.read_text())
        if time.time() - data.get("timestamp", 0) < ttl:
            return data.get("value")
        else:
            path.unlink(missing_ok=True)  # expired
            return None
    except (json.JSONDecodeError, KeyError):
        path.unlink(missing_ok=True)
        return None


def set_cached(prefix: str, params: dict, value: Any) -> None:
    """Store a value in cache."""
    key = _cache_key(prefix, params)
    path = _cache_path(key)
    data = {
        "timestamp": time.time(),
        "prefix": prefix,
        "value": value,
    }
    path.write_text(json.dumps(data, default=str))


def cached_api_call(prefix: str, params: dict, fn: Callable, ttl: int = CACHE_TTL) -> Any:
    """Execute fn() with caching. Returns cached result if available."""
    cached = get_cached(prefix, params, ttl)
    if cached is not None:
        return cached

    result = fn()
    set_cached(prefix, params, result)
    return result


def clear_cache() -> int:
    """Clear all cached files. Returns number of files removed."""
    count = 0
    for f in CACHE_DIR.glob("*.json"):
        f.unlink()
        count += 1
    return count
