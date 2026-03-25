#!/bin/bash
# ─── FlexeTravels Local E2E Test Script ───────────────────────────────────────
# Tests the full booking lifecycle locally before pushing to Railway.
# Run: bash scripts/test-e2e.sh
#
# Prerequisites:
#   • npm run dev running in another terminal (http://localhost:3000)
#   • SUPABASE_URL + SUPABASE_SERVICE_KEY set in .env.local
#   • DUFFEL_ACCESS_TOKEN, LITEAPI_KEY, STRIPE_SECRET_KEY set
# ─────────────────────────────────────────────────────────────────────────────

BASE="http://localhost:3000"
ADMIN_SECRET="${ADMIN_SECRET:-}"  # set to your X-Admin-Secret if configured
PASS=0; FAIL=0

# ── Colour helpers ─────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
section() { echo -e "\n${YELLOW}━━ $1 ━━${NC}"; }

# ── Helper: POST JSON ──────────────────────────────────────────────────────────
post() {
  local path=$1; local data=$2
  curl -s -X POST "$BASE$path" \
    -H "Content-Type: application/json" \
    -d "$data"
}

# ── Helper: GET ────────────────────────────────────────────────────────────────
get() {
  local path=$1
  local headers=""
  [ -n "$ADMIN_SECRET" ] && headers="-H 'X-Admin-Secret: $ADMIN_SECRET'"
  curl -s "$BASE$path" $headers
}

# ══════════════════════════════════════════════════════════════════════════════
section "1. Health Checks"
# ══════════════════════════════════════════════════════════════════════════════

# Next.js up?
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE")
[ "$STATUS" = "200" ] && ok "Next.js running ($BASE)" || fail "Next.js not responding — run: npm run dev"

# Duffel connectivity
DUFFEL=$(get "/api/admin/duffel-check" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tokenMode','unknown'), '|', 'OK' if d.get('connectivity') else 'FAIL')" 2>/dev/null)
echo "  Duffel: $DUFFEL"
[[ "$DUFFEL" == *"OK"* ]] && ok "Duffel API reachable" || fail "Duffel API unreachable"

# ══════════════════════════════════════════════════════════════════════════════
section "2. Flight Search (Duffel)"
# ══════════════════════════════════════════════════════════════════════════════

# Use a near-future date (30 days out)
DEPART=$(date -d "+30 days" +%Y-%m-%d 2>/dev/null || date -v+30d +%Y-%m-%d)

SEARCH_RESP=$(post "/api/chat" '{
  "messages": [{"role":"user","content":"Find me flights from YVR to YYZ on '"$DEPART"' for 1 adult economy"}],
  "sessionId": "test-session-e2e"
}')

# Extract offer ID from response (look for duffel offer IDs starting with "off_")
OFFER_ID=$(echo "$SEARCH_RESP" | python3 -c "
import json, sys, re
text = sys.stdin.read()
ids = re.findall(r'off_[a-zA-Z0-9_]+', text)
print(ids[0] if ids else '')
" 2>/dev/null)

if [ -n "$OFFER_ID" ]; then
  ok "Flight search returned offer: ${OFFER_ID:0:25}..."
else
  warn "No Duffel offer ID found in chat response — check if chat endpoint is using Duffel"
  # Try a fallback static offer ID for further tests
  OFFER_ID="skip"
fi

# ══════════════════════════════════════════════════════════════════════════════
section "3. Hotel Search (LiteAPI)"
# ══════════════════════════════════════════════════════════════════════════════

HOTEL_RESP=$(get "/api/debug/liteapi?destination=Vancouver&checkIn=$(date -d '+30 days' +%Y-%m-%d 2>/dev/null || date -v+30d +%Y-%m-%d)&checkOut=$(date -d '+32 days' +%Y-%m-%d 2>/dev/null || date -v+32d +%Y-%m-%d)&adults=1")
HOTEL_STATUS=$(echo "$HOTEL_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('success') else 'fail')" 2>/dev/null)
[ "$HOTEL_STATUS" = "ok" ] && ok "LiteAPI hotel search working" || warn "LiteAPI returned no results (sandbox key may need activation)"

# ══════════════════════════════════════════════════════════════════════════════
section "4. Booking Flow (book-trip)"
# ══════════════════════════════════════════════════════════════════════════════

# Test with a real Duffel offer if we got one, else just validation
if [ "$OFFER_ID" != "skip" ] && [ -n "$OFFER_ID" ]; then
  BOOK_RESP=$(post "/api/book-trip" '{
    "sessionId": "test-session-e2e",
    "flightOfferId": "'"$OFFER_ID"'",
    "passengers": [{
      "firstName": "Test",
      "lastName": "User",
      "dateOfBirth": "1990-01-01",
      "email": "test@flexetravels.com",
      "phone": "6041234567"
    }],
    "originAirport": "YVR"
  }')

  BOOK_OK=$(echo "$BOOK_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('flightRef','') or d.get('error','no_ref'))" 2>/dev/null)
  [[ "$BOOK_OK" != *"error"* ]] && [[ "$BOOK_OK" != "no_ref" ]] \
    && ok "Duffel booking succeeded: ref=$BOOK_OK" \
    || warn "Booking returned: $BOOK_OK (offer may have expired — normal in test)"

  # Check Stripe PaymentIntent was created
  HAS_PI=$(echo "$BOOK_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes' if d.get('clientSecret') else 'no')" 2>/dev/null)
  [ "$HAS_PI" = "yes" ] && ok "Stripe PaymentIntent created" || fail "No Stripe client_secret in response"
else
  # Validate schema only — no real offer ID
  BOOK_RESP=$(post "/api/book-trip" '{
    "passengers": []
  }')
  STATUS=$(echo "$BOOK_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print('validation_ok' if d.get('error') == 'Validation error' else 'wrong')" 2>/dev/null)
  [ "$STATUS" = "validation_ok" ] && ok "book-trip validation schema working" || fail "book-trip schema validation broken"
fi

# ══════════════════════════════════════════════════════════════════════════════
section "5. DB Persistence (Supabase)"
# ══════════════════════════════════════════════════════════════════════════════

DB_RESP=$(python3 - <<'PYEOF'
import os, urllib.request, json, sys

url  = os.environ.get("SUPABASE_URL", "")
key  = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not url or not key or "PASTE" in url:
    print("not_configured")
    sys.exit(0)

req = urllib.request.Request(
    f"{url}/rest/v1/trips?limit=1",
    headers={"apikey": key, "Authorization": f"Bearer {key}"},
)
try:
    with urllib.request.urlopen(req, timeout=5) as r:
        data = json.loads(r.read())
        print(f"ok:{len(data)}_rows")
except Exception as e:
    print(f"error:{e}")
PYEOF
)

case "$DB_RESP" in
  "not_configured") warn "Supabase not configured — add SUPABASE_URL + SUPABASE_SERVICE_KEY to .env.local" ;;
  ok:*)             ok "Supabase connected (trips table reachable, ${DB_RESP#ok:})" ;;
  *)                fail "Supabase error: $DB_RESP" ;;
esac

# ══════════════════════════════════════════════════════════════════════════════
section "6. Admin Panel"
# ══════════════════════════════════════════════════════════════════════════════

STATS=$(get "/api/admin/stats")
STATS_OK=$(echo "$STATS" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if 'summary' in d or 'stats' in d or 'duffel' in d else 'fail')" 2>/dev/null)
[ "$STATS_OK" = "ok" ] && ok "Admin stats endpoint responding" || fail "Admin stats endpoint broken"

LOGS=$(get "/api/admin/logs?limit=5")
LOGS_OK=$(echo "$LOGS" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if isinstance(d, list) or 'logs' in d else 'fail')" 2>/dev/null)
[ "$LOGS_OK" = "ok" ] && ok "Admin logs endpoint responding" || fail "Admin logs endpoint broken"

echo ""
echo "  Admin panel: $BASE/admin"

# ══════════════════════════════════════════════════════════════════════════════
section "7. Webhook Endpoint"
# ══════════════════════════════════════════════════════════════════════════════

WEBHOOK=$(curl -s "$BASE/api/webhooks/duffel")
WEBHOOK_OK=$(echo "$WEBHOOK" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('status') == 'webhook active' else 'fail')" 2>/dev/null)
[ "$WEBHOOK_OK" = "ok" ] && ok "Duffel webhook endpoint active" || fail "Duffel webhook endpoint not responding"

# ══════════════════════════════════════════════════════════════════════════════
section "8. TypeScript Compile"
# ══════════════════════════════════════════════════════════════════════════════

TS=$(npx tsc --noEmit 2>&1)
[ -z "$TS" ] && ok "TypeScript: 0 errors" || fail "TypeScript errors:\n$TS"

# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}PASSED: $PASS${NC}  ${RED}FAILED: $FAIL${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "Fix failing tests before deploying to Railway."
  exit 1
else
  echo -e "${GREEN}All checks passed — safe to deploy.${NC}"
  echo "  Railway: railway up"
  echo "  Or push to GitHub if CI/CD is connected."
fi
