# FlexeTravels — Audit & Debugging Guide

## Overview

All searches, agent tool calls, and user interactions are logged to SQLite for debugging, analytics, and understanding agent behavior.

**Database location**: `/backend/.cache/flexetravels_audit.db`

---

## API Endpoints

### Get Aggregate Statistics
```bash
curl http://localhost:8000/api/audit/stats
```

**Returns:**
```json
{
  "total_searches": 42,
  "by_source": {
    "amadeus_live": 25,
    "amadeus_test": 10,
    "web_search": 7
  },
  "by_type": {
    "amadeus_flights": 15,
    "amadeus_hotels": 10,
    "web_search_flights": 5,
    "web_search_hotels": 2
  },
  "avg_duration_ms": 3500,
  "total_errors": 2,
  "top_destinations": {
    "NRT": 8,
    "CDG": 7,
    "LHR": 5
  },
  "top_origins": {
    "JFK": 12,
    "LAX": 8
  }
}
```

### Get Recent Searches
```bash
curl "http://localhost:8000/api/audit/searches?limit=20"
```

**Returns recent searches with:**
- Timestamp
- Session ID
- Search type (amadeus_flights, amadeus_hotels, web_search_flights, etc.)
- Origin/destination airports
- Number of results returned
- Data source (amadeus_live, amadeus_test, web_search)
- Duration in milliseconds
- Any errors

### Get Searches by Session
```bash
curl "http://localhost:8000/api/audit/session/{SESSION_ID}/searches"
```

Returns all searches for a specific chat session.

---

## SQL Queries (Direct Database Access)

### Recent searches by a user
```sql
SELECT * FROM searches
ORDER BY timestamp DESC
LIMIT 20;
```

### Searches that returned zero results
```sql
SELECT * FROM searches
WHERE results_count = 0
ORDER BY timestamp DESC;
```

### Which destinations are most popular?
```sql
SELECT destination, COUNT(*) as search_count
FROM searches
WHERE destination IS NOT NULL
GROUP BY destination
ORDER BY search_count DESC;
```

### Average search duration by source
```sql
SELECT data_source, AVG(duration_ms) as avg_ms, COUNT(*) as total
FROM searches
WHERE duration_ms > 0
GROUP BY data_source;
```

### Web search fallback usage (when was it triggered?)
```sql
SELECT * FROM searches
WHERE data_source = 'web_search'
ORDER BY timestamp DESC;
```

### Find errored searches (for debugging)
```sql
SELECT id, timestamp, search_type, error
FROM searches
WHERE error IS NOT NULL
ORDER BY timestamp DESC;
```

### Tool call success rate
```sql
SELECT tool_name, status, COUNT(*) as count
FROM tool_calls
GROUP BY tool_name, status;
```

### Slowest searches (performance debugging)
```sql
SELECT id, timestamp, search_type, duration_ms, data_source
FROM searches
WHERE duration_ms > 0
ORDER BY duration_ms DESC
LIMIT 10;
```

### When did Amadeus return < 3 results (triggering web search)?
```sql
SELECT * FROM searches
WHERE results_count < 3 AND data_source LIKE 'amadeus%'
ORDER BY timestamp DESC;
```

### Session conversation flow
```sql
SELECT timestamp, search_type, results_count, data_source
FROM searches
WHERE session_id = 'abc123'
ORDER BY timestamp;
```

---

## Understanding Agent Behavior

### Did the agent use web search fallback?
1. Check if a search has `data_source = 'web_search'`
2. Look at the preceding Amadeus search to see if it returned <3 results
3. This indicates the agent correctly triggered fallback logic

### Why did a search fail?
1. Query the `error` column in the searches table
2. Common errors:
   - "API rate limited" → Too many requests to Amadeus
   - "Invalid airport code" → Claude misidentified a city code
   - "No results found" → Valid route but no flights available
   - "SerpAPI not configured" → Web search fell back to mock data

### Is the agent extracting parameters correctly?
1. Check `origin` and `destination` columns in searches table
2. Look at `departure_date` and `return_date` formats (should be YYYY-MM-DD)
3. Verify `adults` count is reasonable
4. If any are NULL or malformed, agent needs system prompt adjustment

### How long do searches take?
1. Check `avg_duration_ms` in stats
2. If > 5000ms, API is slow (network issue or rate limiting)
3. If < 1000ms, cache hit or mock data
4. Track over time to detect performance degradation

### Are we hitting rate limits?
1. Look for errors mentioning "rate" or "quota"
2. Check duration spike (normal: 1-2s, rate limited: 10-30s)
3. Consider caching strategy or upgrade Amadeus plan

---

## Debugging Specific Scenarios

### Example 1: User says "flights to Tokyo" but agent searches "flights to NRT"
✓ **Expected behavior** — agent correctly converted city name to IATA code

### Example 2: Amadeus returns flights in EUR, agent should show in USD
- Check `response_json` field in searches table (raw API response)
- If Amadeus returned EUR, agent should note this in chat
- Future: implement currency conversion in AMADEUS_CURRENCY config

### Example 3: User asks for trips but agent doesn't search
- Check if search was triggered in `searches` table for that session
- If no row, agent didn't have all 4 required params (origin, dest, dates, travelers)
- Check system prompt to ensure it asks for missing info

### Example 4: Same search requested twice, but second didn't use cache
- Cache is file-based with 30-min TTL
- Check if timestamps are >30 mins apart
- Or cache was cleared via `/api/amadeus/clear-cache` endpoint

### Example 5: Web search results are inaccurate / all mock
- Check if `SERPER_API_KEY` is set in `.env`
- If not set, web_search tool returns mock data
- Verify it's correct key from serper.dev dashboard

---

## Exporting Data

### Export to CSV
```python
import sqlite3
import csv

conn = sqlite3.connect('/path/to/flexetravels_audit.db')
cursor = conn.cursor()
cursor.execute('SELECT * FROM searches')

with open('searches.csv', 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow([d[0] for d in cursor.description])  # Headers
    writer.writerows(cursor.fetchall())

conn.close()
```

### Export to JSON
```python
import sqlite3
import json

conn = sqlite3.connect('/path/to/flexetravels_audit.db')
cursor = conn.cursor()
cursor.execute('SELECT * FROM searches')

rows = cursor.fetchall()
columns = [d[0] for d in cursor.description]
data = [dict(zip(columns, row)) for row in rows]

with open('searches.json', 'w') as f:
    json.dump(data, f, indent=2, default=str)

conn.close()
```

---

## Interpreting Currency Issues

**Scenario**: Admin console shows flights in EUR, chat shows USD
- **Cause**: Amadeus returns prices in airline's native currency
- **Solution**:
  1. Set `AMADEUS_CURRENCY=USD` in `.env` (when implemented)
  2. Agent will note source currency in response
  3. Future: automatic conversion via exchange rate API

**Scenario**: Same flight shows different prices
- **Cause**: Exchange rate fluctuation, timing of cache
- **Solution**: Check `timestamp` and `response_json` to see exchange rate at time of search

---

## Fixing Common Issues

### Issue: Web search triggered but Amadeus had results
**Check:**
```sql
SELECT * FROM searches
WHERE data_source = 'web_search'
AND id > (
  SELECT MAX(id) FROM searches
  WHERE data_source LIKE 'amadeus%'
)
LIMIT 5;
```

Look at the preceding amadeus_flights search:
- If `results_count < 3`, web search was correctly triggered
- If `results_count >= 3`, system prompt needs adjustment

### Issue: Agent searches for same route twice
**Check:**
```sql
SELECT id, timestamp, search_type, destination, results_count
FROM searches
WHERE session_id = 'SESSION_ID'
ORDER BY timestamp;
```

**Possible causes:**
1. Cache expired (>30 min)
2. Duplicate tool call (agent confusion)
3. Intentional refinement (user asked to "search again")

### Issue: Results count is 0 but no error
**Check** the `response_json` field to see what Amadeus actually returned

**Possible causes:**
1. Valid route but no inventory
2. Invalid date (past date, too far future)
3. Invalid airport codes
4. Test sandbox with limited data

---

## Monitoring & Alerts

### Setup a simple monitoring query
```python
import sqlite3
from datetime import datetime, timedelta

conn = sqlite3.connect('/path/to/flexetravels_audit.db')
cursor = conn.cursor()

# Last 5 minutes
five_min_ago = datetime.now() - timedelta(minutes=5)
cursor.execute('''
  SELECT COUNT(*) as error_count
  FROM searches
  WHERE error IS NOT NULL
  AND datetime(timestamp) > ?
''', (five_min_ago.isoformat(),))

errors = cursor.fetchone()[0]
if errors > 5:
    print(f"⚠️ Alert: {errors} errors in last 5 minutes")
```

### Track agent behavior metrics
```python
# Daily active users
SELECT COUNT(DISTINCT session_id) FROM searches
WHERE datetime(timestamp) > datetime('now', '-1 day');

# Most common errors
SELECT error, COUNT(*) FROM searches
WHERE error IS NOT NULL
GROUP BY error
ORDER BY COUNT(*) DESC;

# Web search fallback rate
SELECT
  COUNT(CASE WHEN data_source = 'web_search' THEN 1 END) * 100.0 / COUNT(*) as fallback_pct
FROM searches;
```

---

## Privacy & Data Retention

**What's logged:**
- User messages (first 500 chars)
- Search parameters (airports, dates)
- Results metadata (count, source, duration)
- Errors

**What's NOT logged:**
- User's name, email, payment info
- Full response JSON (truncated preview only)
- Audio/video
- IP addresses

**Data retention:**
- Default: indefinite (no auto-delete)
- Recommended: Archive & delete after 90 days for privacy
- To delete old data:
  ```sql
  DELETE FROM searches
  WHERE datetime(timestamp) < datetime('now', '-90 days');
  ```

---

**Questions?** Check the logs, query the audit DB, and look at raw response_json fields for detailed debugging.
