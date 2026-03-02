# FlexeTravels Debugging Guide

## 📊 Current Status

### ✅ What's Working
1. **Marketing Content Generation** - Perfect!
   - Generates tour packages with pricing
   - Creates 4 Instagram posts with hashtags
   - Produces blog drafts with CTAs
   - Results saved to `backend/output/YYYY-MM-DD_run.json`
   - Social posts logged to `backend/logs/social_posts.log`

2. **Dynamic Tours Backend** - Perfect!
   - API endpoint `/api/featured-tours` working
   - Detects visitor location from IP
   - Generates personalized tour packages
   - Fetches real Unsplash images
   - Returns properly formatted JSON

3. **Console Logging** - Enhanced!
   - Added detailed debugging logs to `app.js`
   - Shows fetch status, API response, DOM updates
   - Check Browser Console (F12) to see what's happening

### ⚠️ Issues & Fixes

#### Issue 1: Email Not Sending (SMTP Auth Failed)
**Status:** Authentication failing with Neomail

**Updated Credentials in .env:**
```
SMTP_USER=sales@flexetravels.com
SMTP_PASSWORD=Flexetravels@123#
SMTP_HOST=smtp0001.neo.space
SMTP_PORT=587
SMTP_USE_TLS=true
```

**Troubleshooting Steps:**
1. Log into https://admin.neo.space/
2. Verify `sales@flexetravels.com` account is **active**
3. Check if there's a security alert blocking login attempts
4. Try resetting the password in Neomail admin
5. Verify email account has SMTP/IMAP enabled
6. Check for failed login attempts that might have locked the account

**Workaround:** Content is still being generated perfectly!
- Just the email send is failing
- All content saved locally and visible in logs

#### Issue 2: Dynamic Tours Showing Same Location
**Status:** Fixed! Enhanced with location testing

**What Changed:**
- Added `test_city` query parameter to `/api/featured-tours`
- Allows testing different locations without IP spoofing
- Modified app.js with enhanced console logging

**How to Test:**

1. **Via API directly:**
```bash
# Test with London
curl "http://localhost:8000/api/featured-tours?test_city=London"

# Test with Tokyo
curl "http://localhost:8000/api/featured-tours?test_city=Tokyo"

# Test with Sydney
curl "http://localhost:8000/api/featured-tours?test_city=Sydney"
```

2. **Via Browser:**
- Open: `http://localhost:3000?test_city=London`
- Open: `http://localhost:3000?test_city=Tokyo`
- Open: `http://localhost:3000?test_city=Dubai`

3. **Using Test Script:**
```bash
cd "/Users/sumanthumboli/Downloads/FlexeTravels website"
./test_locations.sh
```

**Supported Cities for Testing:**
London, Tokyo, Sydney, Dubai, Paris, Barcelona, New York, Los Angeles, Toronto, Singapore, Bangkok, Istanbul, Rome, Madrid, Barcelona, Amsterdam, Berlin, Vienna, etc.

---

## 🔧 How to Debug

### Browser Console Debugging
1. Open browser DevTools: **F12**
2. Go to **Console** tab
3. Look for messages like:
   ```
   🚀 Fetching featured tours from http://localhost:8000/api/featured-tours
   ✅ Featured tours API response: {location: {...}, tours: [...]}
   📍 Updating location label: Trending for visitors from London, United Kingdom
   📦 Rendering 6 dynamic tour cards
   ✅ Dynamic tours rendered successfully!
   ```
4. If you see ❌ errors, share them for debugging

### API Endpoint Testing
```bash
# Check if backend is running
curl -s http://localhost:8000/api/featured-tours | python3 -m json.tool | head -50

# Test with specific location
curl -s "http://localhost:8000/api/featured-tours?test_city=Paris" | python3 -m json.tool
```

### Log Files
- **Backend Logs:** `backend/logs/flexetravels.log`
- **Social Posts:** `backend/logs/social_posts.log`
- **Marketing Runs:** `backend/output/*.json`

---

## 🚀 Next Steps

### 1. Fix Email Authentication
[ ] Log into Neomail admin panel
[ ] Verify account status
[ ] Reset password if needed
[ ] Re-test email sending

### 2. Verify Dynamic Tours Frontend
[ ] Restart backend: `python3 -m uvicorn main:app --reload --port 8000`
[ ] Open index.html in browser
[ ] Check console (F12) for logs
[ ] Verify skeleton cards are replaced with real tours
[ ] Try different test_city parameters

### 3. Test Marketing Workflow
```bash
# Generate marketing content for a city
cd backend
python3 -m marketing.workflow --destination "Paris"

# Check generated content
cat output/2026-03-01_*_Paris_run.json
```

### 4. Production Deployment
When deployed:
- Real IP geolocation will work automatically
- No need for `test_city` parameter
- Visitors' actual location will be detected
- Personalized tours will show based on their IP

---

## 📝 Files Modified

### Backend
- `backend/main.py` - Added `test_city` parameter to `/api/featured-tours`
- Enhanced location detection for testing

### Frontend
- `app.js` - Added detailed console logging to `fetchFeaturedTours()`
  - Shows fetch status
  - Displays API response
  - Shows DOM update status
  - Logs any errors clearly

---

## ✅ Verification Checklist

- [ ] Backend running on port 8000
- [ ] Browser console shows fetch logs
- [ ] Dynamic tours replace skeleton cards
- [ ] Location label updates correctly
- [ ] Tours change when using different `test_city`
- [ ] Clicking tour card opens chat
- [ ] Marketing email credentials configured
- [ ] Marketing content generates successfully
