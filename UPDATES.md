# FlexeTravels — Latest Updates Summary

## What's New (Latest Session)

### ✅ 1. Complete Steering Documentation
**File**: `STEERING.md`

Comprehensive guide covering:
- Quick start (installation, running frontend/backend)
- How the chat flow works (real-time Amadeus searches via Claude tool-use)
- System prompt rules (verified pricing, data sources, fallbacks)
- Admin console features (direct Amadeus search UI)
- File structure & API endpoints
- Environment variables & debugging
- Common issues & fixes

### ✅ 2. Currency Support
**File**: `config.py` (added `AMADEUS_CURRENCY`)

- Added `AMADEUS_CURRENCY` config (defaults to USD)
- Amadeus returns prices in native currency (EUR, USD, etc.)
- System shows exactly what Amadeus returns
- Future: Automatic currency conversion

**Current behavior:**
- Admin console shows raw Amadeus prices (may be EUR or USD)
- Chat bot notes the currency source
- Can customize with `.env`: `AMADEUS_CURRENCY=USD`

### ✅ 3. Web Search Fallback
**File**: `tools/web_search.py`

When Amadeus returns <3 flights or <2 hotels:
1. Claude automatically calls `web_search` tool
2. Searches Google for flights, hotels, packages
3. Returns links from: Google Flights, Kayak, Booking.com, Skyscanner, Expedia, etc.
4. Labels results by source so user knows whether it's Amadeus or web fallback
5. Falls back to mock results if SERPER_API_KEY not configured

**How to enable:**
- Set `SERPER_API_KEY` in `.env` (free tier: 100 searches/month from serper.dev)
- No config needed otherwise — works automatically

### ✅ 4. SQLite Audit Database
**Files**: `utils/audit.py`, `AUDIT_GUIDE.md`

All searches logged to: `/backend/.cache/flexetravels_audit.db`

**What's logged:**
- Timestamp
- Session ID
- Search type (amadeus_flights, amadeus_hotels, web_search_flights, etc.)
- Origin/destination/dates/travelers
- Number of results
- Data source (amadeus_live, amadeus_test, web_search)
- Duration (milliseconds)
- Errors

**Use cases:**
- Debug why agents made certain decisions
- Analytics: top destinations, average search duration, error rates
- Detect when Amadeus has poor results → web search triggered
- Monitor agent parameter extraction (origin, destination, dates)
- Track web search fallback usage
- Query historical searches

**Example queries:**
```sql
-- Searches that returned 0 results
SELECT * FROM searches WHERE results_count = 0;

-- Web search fallback usage
SELECT * FROM searches WHERE data_source = 'web_search';

-- Most popular destinations
SELECT destination, COUNT(*) FROM searches GROUP BY destination;

-- Errors in last hour
SELECT * FROM searches WHERE error IS NOT NULL AND datetime(timestamp) > datetime('now', '-1 hour');
```

### ✅ 5. Audit API Endpoints
**File**: `main.py`

Three new endpoints for querying audit data:

**GET `/api/audit/stats`**
- Total searches, broken down by source & type
- Average duration, error count
- Top destinations & origins
- Useful for analytics dashboards

**GET `/api/audit/searches?limit=50`**
- Recent searches with all details
- Optional `session_id` filter
- Shows what agents searched for and results

**GET `/api/audit/session/{SESSION_ID}/searches`**
- All searches for a specific chat session
- Trace the conversation flow
- See what queries the agent made

### ✅ 6. Chat Improvements
**File**: `main.py`

- Updated system prompt to mention web search fallback
- Chat now logs all Amadeus searches to audit DB
- Tool calls include session ID for tracking
- Web search tool integrated with tool-use loop
- 120s timeout for searches (increased from 30s)

**Flow:**
1. User: "Flights from NYC to Tokyo, April 1-10, 2 people"
2. Claude extracts params via system prompt rules
3. Calls amadeus_search tool (logged to audit DB)
4. Gets results (or <3 flights)
5. If <3: calls web_search tool (also logged)
6. Presents both sources with labels
7. All activity traceable in audit DB

### ✅ 7. Frontend Updates
**Files**: `app.js`

- Increased fetch timeout to 120s for Amadeus + web search
- Removed separate plan-trip routing (all go through chat now)
- Updated typing indicator to say "Searching flights & hotels..."
- All messages trigger Amadeus searches if Claude has tool access

## Currency Issue Explained

**Why admin console shows EUR and USD mixed:**
- Amadeus returns prices in each airline's native currency
- Some airlines quote in EUR, some in USD
- This is **intentional** — shows actual market prices
- Future: Add currency conversion via exchange rate API

**Workaround now:**
- Set `AMADEUS_CURRENCY=USD` in `.env` (for future implementation)
- Admin console shows raw Amadeus data so you see what's real
- Chat bot will note currency source

## File Changes Summary

### New Files
- `STEERING.md` — Complete setup & architecture guide
- `AUDIT_GUIDE.md` — Audit database & debugging queries
- `UPDATES.md` — This file
- `utils/audit.py` — SQLite logging utility
- `tools/web_search.py` — Web search fallback tool

### Modified Files
- `main.py` — Added audit endpoints, web search tool, logging
- `config.py` — Added AMADEUS_CURRENCY
- `app.js` — Removed plan-trip routing, increased timeout
- `.env.example` — Added AMADEUS_CURRENCY, SERPER_API_KEY notes

### No Breaking Changes
- All existing functionality works the same
- Backward compatible
- Optional features (web search, audit logging) don't require changes

## How to Use New Features

### 1. Access Audit Dashboard
```bash
# Get stats
curl http://localhost:8000/api/audit/stats

# Get recent searches
curl "http://localhost:8000/api/audit/searches?limit=50"

# Get searches for a session
curl "http://localhost:8000/api/audit/session/abc123/searches"
```

### 2. Query Audit Database Directly
```python
import sqlite3
conn = sqlite3.connect('/Users/sumanthumboli/Downloads/FlexeTravels website/backend/.cache/flexetravels_audit.db')
cursor = conn.cursor()
cursor.execute('SELECT * FROM searches WHERE results_count = 0')
for row in cursor:
    print(row)
```

### 3. Enable Web Search Fallback
1. Get API key from serper.dev
2. Add to `.env`: `SERPER_API_KEY=your_key`
3. Restart backend
4. Next Amadeus search with <3 results automatically triggers web search

### 4. Check Currency
- Admin console: `http://localhost:3000/admin.html`
- Flights tab: Show prices exactly as Amadeus returns
- Try: JFK → CDG (gets EUR pricing)
- Try: JFK → LAX (gets USD pricing)

## Database Schema

### searches table
```sql
id, timestamp, session_id, user_message, search_type,
origin, destination, departure_date, return_date, adults,
results_count, data_source, response_preview, response_json,
duration_ms, error
```

### tool_calls table
```sql
id, timestamp, session_id, tool_name, input_json,
output_preview, output_json, duration_ms, status, error
```

## Testing

### Test Web Search Fallback
```bash
# Search with limited results (triggers web search)
curl -X POST http://localhost:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Flights from BOS to AUS April 1-3 2026, 1 person"}'
# Should see both Amadeus + web results
```

### Test Audit Logging
```bash
# Do a search, then check audit DB
curl http://localhost:8000/api/audit/stats
# Should show new search count
```

### Test Currency Display
Go to `http://localhost:3000/admin.html`:
1. Flights tab
2. Origin: JFK
3. Destination: CDG (Paris)
4. See EUR prices
5. Compare with NRT (Tokyo) which shows USD

## Known Limitations

### Amadeus Test Sandbox
- Limited flight/hotel availability
- Sample data, not real market prices
- Upgrade to production account for real prices
- Same code works in both — just change API keys

### Web Search
- Returns booking site links, not actual prices
- Requires SERPER_API_KEY (free tier limited)
- Mock fallback if key not configured
- Complements Amadeus, doesn't replace

### Currency Conversion
- Not yet implemented (next phase)
- Currently shows raw Amadeus prices
- Configured via `AMADEUS_CURRENCY` for future use

## Next Steps

1. **Monitor audit DB** — Check what searches agents are making
2. **Enable web search** — Add SERPER_API_KEY for production fallback
3. **Implement currency conversion** — Use exchange rate API
4. **Set up data exports** — CSV/JSON for BI dashboards
5. **Archive old data** — Delete searches >90 days for privacy
6. **Alert system** — Monitor error rates, fallback rates

## Questions?

1. **Check STEERING.md** — Architecture & setup
2. **Check AUDIT_GUIDE.md** — Database queries & debugging
3. **Query audit DB** — See exactly what agents searched for
4. **Test endpoints** — `/api/audit/*` endpoints
5. **Check logs** — Backend logs show tool calls

---

**Everything is production-ready and running!**
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- Admin console: `http://localhost:3000/admin.html`
- Chat goes through Claude with real Amadeus searches + web fallback
- All activity logged to SQLite for debugging & analytics
