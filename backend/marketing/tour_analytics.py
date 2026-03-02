"""
FlexeTravels — Tour Analytics
Lightweight JSONL-based analytics tracker for featured tour impressions.
No database required — append-only file, read on demand.
"""

import json
import logging
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

logger = logging.getLogger(__name__)

ANALYTICS_DIR = Path(__file__).parent.parent / "analytics"
IMPRESSIONS_FILE = ANALYTICS_DIR / "impressions.jsonl"


def record_tour_impression(destination: str, origin_city: str = "") -> None:
    """Record that a tour destination was shown to a visitor."""
    ANALYTICS_DIR.mkdir(exist_ok=True)
    record = {
        "ts": datetime.utcnow().isoformat(),
        "destination": destination,
        "origin_city": origin_city,
    }
    try:
        with open(IMPRESSIONS_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except Exception as e:
        logger.warning(f"Failed to record impression: {e}")


def get_top_destination(days: int = 7) -> str:
    """
    Return the most-featured destination over the last N days.
    Falls back to 'Tokyo' if no data available.
    """
    if not IMPRESSIONS_FILE.exists():
        return "Tokyo"

    cutoff = datetime.utcnow() - timedelta(days=days)
    counts: Counter = Counter()

    try:
        with open(IMPRESSIONS_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    ts = datetime.fromisoformat(rec.get("ts", ""))
                    if ts >= cutoff:
                        dest = rec.get("destination", "")
                        if dest:
                            counts[dest] += 1
                except Exception:
                    continue
    except Exception as e:
        logger.warning(f"Failed to read analytics: {e}")
        return "Tokyo"

    if not counts:
        return "Tokyo"

    top = counts.most_common(1)[0][0]
    logger.info(f"Top destination (last {days}d): {top} ({counts[top]} impressions)")
    return top


def get_analytics_summary(days: int = 7) -> dict:
    """Return a summary dict of top destinations for admin/debug."""
    if not IMPRESSIONS_FILE.exists():
        return {"days": days, "total": 0, "top": []}

    cutoff = datetime.utcnow() - timedelta(days=days)
    counts: Counter = Counter()
    total = 0

    try:
        with open(IMPRESSIONS_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    ts = datetime.fromisoformat(rec.get("ts", ""))
                    if ts >= cutoff:
                        dest = rec.get("destination", "")
                        if dest:
                            counts[dest] += 1
                            total += 1
                except Exception:
                    continue
    except Exception as e:
        logger.warning(f"Analytics read error: {e}")

    return {
        "days": days,
        "total_impressions": total,
        "top": [{"destination": d, "impressions": c} for d, c in counts.most_common(10)],
    }
