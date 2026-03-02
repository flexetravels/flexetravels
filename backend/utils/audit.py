"""
FlexeTravels — SQLite Audit Database
Logs all searches, results, and agent activity for debugging and analytics.
"""

import sqlite3
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import CACHE_DIR

logger = logging.getLogger(__name__)

DB_PATH = CACHE_DIR / "flexetravels_audit.db"


def init_db():
    """Initialize the audit database schema if it doesn't exist."""
    try:
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()

        # Main searches table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS searches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                session_id TEXT,
                user_message TEXT,
                search_type TEXT,        -- 'chat', 'amadeus_flights', 'amadeus_hotels', 'web_search'
                origin TEXT,
                destination TEXT,
                departure_date TEXT,
                return_date TEXT,
                adults INTEGER,
                results_count INTEGER,
                data_source TEXT,        -- 'amadeus_live', 'amadeus_test', 'web_search', 'mixed'
                response_preview TEXT,   -- First 500 chars of response for quick view
                response_json TEXT,      -- Full response (may be large)
                duration_ms INTEGER,
                error TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Agent tool calls table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tool_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                session_id TEXT,
                tool_name TEXT,         -- 'amadeus_search', 'web_search', 'stripe_payment', etc.
                input_json TEXT,
                output_preview TEXT,    -- First 500 chars
                output_json TEXT,       -- Full output
                duration_ms INTEGER,
                status TEXT,            -- 'success', 'error'
                error TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Conversations table (for conversation analysis)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT UNIQUE,
                user_email TEXT,
                start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                end_time DATETIME,
                message_count INTEGER DEFAULT 0,
                search_count INTEGER DEFAULT 0,
                final_destination TEXT,
                final_origin TEXT,
                budget_mentioned TEXT,
                status TEXT,            -- 'ongoing', 'completed', 'abandoned'
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.commit()
        conn.close()
        logger.info(f"Audit database initialized at {DB_PATH}")
    except Exception as e:
        logger.error(f"Failed to initialize audit DB: {e}")


def log_search(
    session_id: str,
    user_message: str,
    search_type: str,
    origin: Optional[str] = None,
    destination: Optional[str] = None,
    departure_date: Optional[str] = None,
    return_date: Optional[str] = None,
    adults: Optional[int] = None,
    results_count: int = 0,
    data_source: str = "unknown",
    response_data: Optional[Dict[str, Any]] = None,
    duration_ms: int = 0,
    error: Optional[str] = None,
) -> int:
    """Log a search to the audit database. Returns the search ID."""
    try:
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()

        response_str = json.dumps(response_data) if response_data else ""
        response_preview = response_str[:500] if response_str else ""

        cursor.execute("""
            INSERT INTO searches (
                session_id, user_message, search_type, origin, destination,
                departure_date, return_date, adults, results_count, data_source,
                response_preview, response_json, duration_ms, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            session_id,
            user_message,
            search_type,
            origin,
            destination,
            departure_date,
            return_date,
            adults,
            results_count,
            data_source,
            response_preview,
            response_str,
            duration_ms,
            error,
        ))

        conn.commit()
        search_id = cursor.lastrowid
        conn.close()
        return search_id
    except Exception as e:
        logger.error(f"Failed to log search: {e}")
        return -1


def log_tool_call(
    session_id: str,
    tool_name: str,
    input_data: Dict[str, Any],
    output_data: Optional[Dict[str, Any]] = None,
    duration_ms: int = 0,
    error: Optional[str] = None,
) -> int:
    """Log a tool call to the audit database. Returns the call ID."""
    try:
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()

        input_str = json.dumps(input_data)
        output_str = json.dumps(output_data) if output_data else ""
        output_preview = output_str[:500] if output_str else ""
        status = "error" if error else "success"

        cursor.execute("""
            INSERT INTO tool_calls (
                session_id, tool_name, input_json, output_preview, output_json,
                duration_ms, status, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            session_id,
            tool_name,
            input_str,
            output_preview,
            output_str,
            duration_ms,
            status,
            error,
        ))

        conn.commit()
        call_id = cursor.lastrowid
        conn.close()
        return call_id
    except Exception as e:
        logger.error(f"Failed to log tool call: {e}")
        return -1


def get_searches(limit: int = 50, session_id: Optional[str] = None):
    """Retrieve recent searches from the audit database."""
    try:
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()

        if session_id:
            cursor.execute("""
                SELECT id, timestamp, search_type, origin, destination,
                       results_count, data_source, duration_ms, error
                FROM searches WHERE session_id = ?
                ORDER BY timestamp DESC LIMIT ?
            """, (session_id, limit))
        else:
            cursor.execute("""
                SELECT id, timestamp, session_id, search_type, origin, destination,
                       results_count, data_source, duration_ms, error
                FROM searches
                ORDER BY timestamp DESC LIMIT ?
            """, (limit,))

        columns = [description[0] for description in cursor.description]
        rows = cursor.fetchall()
        conn.close()

        return [dict(zip(columns, row)) for row in rows]
    except Exception as e:
        logger.error(f"Failed to retrieve searches: {e}")
        return []


def get_search_stats():
    """Get aggregate statistics from the audit database."""
    try:
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()

        stats = {}

        # Total searches
        cursor.execute("SELECT COUNT(*) FROM searches")
        stats['total_searches'] = cursor.fetchone()[0]

        # By source
        cursor.execute("""
            SELECT data_source, COUNT(*) as count
            FROM searches GROUP BY data_source
        """)
        stats['by_source'] = {row[0]: row[1] for row in cursor.fetchall()}

        # By search type
        cursor.execute("""
            SELECT search_type, COUNT(*) as count
            FROM searches GROUP BY search_type
        """)
        stats['by_type'] = {row[0]: row[1] for row in cursor.fetchall()}

        # Average duration
        cursor.execute("SELECT AVG(duration_ms) FROM searches WHERE duration_ms > 0")
        stats['avg_duration_ms'] = cursor.fetchone()[0] or 0

        # Errors
        cursor.execute("SELECT COUNT(*) FROM searches WHERE error IS NOT NULL")
        stats['total_errors'] = cursor.fetchone()[0]

        # Top destinations
        cursor.execute("""
            SELECT destination, COUNT(*) as count
            FROM searches WHERE destination IS NOT NULL
            GROUP BY destination ORDER BY count DESC LIMIT 10
        """)
        stats['top_destinations'] = {row[0]: row[1] for row in cursor.fetchall()}

        # Most common origins
        cursor.execute("""
            SELECT origin, COUNT(*) as count
            FROM searches WHERE origin IS NOT NULL
            GROUP BY origin ORDER BY count DESC LIMIT 10
        """)
        stats['top_origins'] = {row[0]: row[1] for row in cursor.fetchall()}

        conn.close()
        return stats
    except Exception as e:
        logger.error(f"Failed to get stats: {e}")
        return {}


# Initialize on import
init_db()
