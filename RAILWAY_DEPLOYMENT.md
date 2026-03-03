# Railway Deployment Guide - Duffel API Integration

**Last Updated:** March 3, 2026
**Status:** ✅ Ready for Production

## Quick Summary

Your local setup is working perfectly with Duffel API. To deploy to Railway:

1. Add `DUFFEL_API_KEY` environment variable
2. Set `ACTIVE_TRAVEL_API=duffel`
3. Deploy (Vercel frontend auto-deploys, Railway backend needs manual push)

**Current Status:**
- ✅ Duffel Flights: Working (tested end-to-end)
- ✅ Amadeus Experiences: Working
- ⚠️ Hotels: Amadeus only (limited to ~7 cities, Duffel Stays unavailable in test mode)

---

## Step-by-Step Deployment to Railway

### Step 1: Add Duffel API Key to Railway Dashboard

1. Go to [Railway Dashboard](https://railway.app)
2. Select your **FlexeTravels** project
3. Click on the **Backend** service (Python/FastAPI)
4. Go to **Settings** → **Variables**
5. Add these new variables:

   ```
   DUFFEL_API_KEY = duffel_test_YOUR_KEY_HERE
   ACTIVE_TRAVEL_API = duffel
   ```

6. Click **Save**

### Step 2: Verify Variables Are Set

1. Still in **Settings** → **Variables**, confirm you see:
   - ✅ `ANTHROPIC_API_KEY` (existing)
   - ✅ `AMADEUS_API_KEY` (existing)
   - ✅ `DUFFEL_API_KEY` (newly added)
   - ✅ `ACTIVE_TRAVEL_API = duffel` (newly added)

### Step 3: Deploy Backend to Railway

**Option A: Via GitHub (Recommended)**

```bash
# From your local machine:
cd "FlexeTravels website"
git add backend/.env
git commit -m "Configure Duffel API for production"
git push origin main

# Railway auto-deploys from GitHub
# Check deployment status in Railway dashboard
```

**Option B: Via Railway CLI**

```bash
# If you have Railway CLI installed:
railway up
```

### Step 4: Monitor Deployment

1. Go to Railway Dashboard
2. Select **FlexeTravels** project → **Backend** service
3. Go to **Deployments** tab
4. Watch for the new deployment (takes 2-3 minutes)
5. Status should change from "Building" → "Success" ✅

### Step 5: Test Production Deployment

Once deployment succeeds, test in your browser:

```
https://flexetravels.com/admin.html
```

1. Go to **Flights** tab
2. Enter:
   - Origin: `LHR`
   - Destination: `JFK`
   - Departure: `2026-03-12`
   - Return: `2026-03-26`
   - Adults: `1`
3. Click **Search**
4. Should see ✅ **10 flight options** (Duffel results)

### Step 6: Test Chatbot in Production

Go to [https://flexetravels.com](https://flexetravels.com)

1. Click chat bubble (bottom-right)
2. Send message: "Flights from London to New York March 12-26 for 1 person"
3. Should see ✅ **Flight options with real prices** (Duffel results)

---

## Configuration Reference

### Local Development (`.env`)

```bash
DUFFEL_API_KEY=duffel_test_YOUR_KEY_HERE
ACTIVE_TRAVEL_API=duffel
```

### Railway Production Environment Variables

Same as above. Go to **Settings → Variables** and add both.

### Quick Rollback (If Needed)

If Duffel has issues, revert to Amadeus:

```
ACTIVE_TRAVEL_API=amadeus
```

Then redeploy. Changes take effect immediately on next request.

---

## Behavior Comparison

### With `ACTIVE_TRAVEL_API=duffel` (Current)

| Feature | Status | Details |
|---------|--------|---------|
| Flights | ✅ Working | Real Duffel Airways test data |
| Hotels  | ⚠️ Limited | Uses Amadeus (only ~7 cities) |
| Experiences | ✅ Working | Amadeus activities |
| Chatbot | ✅ Working | Uses Duffel for flights |
| Admin Panel | ✅ Working | Shows Duffel flight results |

### With `ACTIVE_TRAVEL_API=amadeus` (Fallback)

| Feature | Status | Details |
|---------|--------|---------|
| Flights | ✅ Working | Real Amadeus data |
| Hotels  | ⚠️ Limited | Only ~7 cities (LAS, MIA, ATL, LON, DPS, DXB, SIN) |
| Experiences | ✅ Working | Amadeus activities |
| Chatbot | ✅ Working | Uses Amadeus for flights |
| Admin Panel | ✅ Working | Shows Amadeus flight results |

---

## Troubleshooting

### ❌ Hotels Still Not Showing for City X

**Problem:** User searches for hotels in NYC, London, or other major cities, but gets 0 results.

**Root Cause:** Both Duffel (Stays API) and Amadeus (limited coverage) don't support the requested city.

**Solution:** This is a known limitation of test mode APIs. In production, consider:
- Activating Duffel production account for global hotel coverage
- Using Booking.com or Trivago APIs as alternatives
- For now, inform users that hotel searches are limited

### ❌ Flights Not Showing

**Problem:** Chatbot says "flights returned 0 results" even for valid routes.

**Solution:**
1. Check Railway logs: Dashboard → Backend → Logs
2. Look for error messages
3. Verify `DUFFEL_API_KEY` is correctly set
4. Test with route: LHR → JFK (known working route)

### ❌ "Invalid IATA code" Error

**Problem:** API returns `"Invalid IATA code"` error.

**Cause:** Duffel test mode may not support all IATA codes. Stick to major airports.

**Tested Working Routes:**
- LHR → JFK
- YVR → LAS
- CDG → DXB

---

## Next Steps (Optional)

### Option 1: Upgrade Duffel to Production
- Contact Duffel support to activate Stays API
- Production account gives access to:
  - All airlines (not just test airlines)
  - Global hotel coverage
  - Real-time pricing

### Option 2: Add Alternative Hotel APIs
- Booking.com API (faster checkout)
- Trivago API (price comparison)
- Expedia API (more inventory)

See `RESEARCH_TRAVEL_APIS.md` for comparison.

### Option 3: Keep Current Setup
- Duffel for flights (works great)
- Amadeus hotels (7-city fallback for now)
- Users can still book what's available

---

## Verification Checklist

- [ ] Variables added to Railway dashboard
- [ ] Backend deployed successfully (Deployments tab shows ✅)
- [ ] Admin panel flights work (10 results for LHR→JFK)
- [ ] Chatbot flights work (shows flight options)
- [ ] Hotels show for supported cities (LAS, MIA, ATL, LON, DPS, DXB, SIN)
- [ ] Hotels show error message gracefully for unsupported cities
- [ ] Configuration switch (`ACTIVE_TRAVEL_API`) changes behavior immediately

---

## Support

If you encounter issues:

1. **Check logs:** Railway Dashboard → Backend → Logs
2. **Test locally first:** `cd backend && python3 main.py`
3. **Verify keys:** Railway Variables tab shows all keys correctly
4. **Check Duffel status:** https://duffel.com (API status page)

Questions? See `STEERING.md` for architecture overview.
