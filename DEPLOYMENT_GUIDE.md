# 🚀 FlexeTravels Deployment Guide

## Deployment Architecture

```
Domain: flexetravels.com (Namecheap)
├── Frontend: vercel.app (Vercel - Free)
└── Backend API: railway.app (Railway - Free)
```

---

## Prerequisites

1. ✅ GitHub Account (free) - https://github.com
2. ✅ Vercel Account (free) - https://vercel.com
3. ✅ Railway Account (free) - https://railway.app
4. ✅ Namecheap Domain (already have flexetravels.com)
5. ✅ All API Keys ready:
   - ANTHROPIC_API_KEY
   - AMADEUS_API_KEY & AMADEUS_API_SECRET
   - UNSPLASH_ACCESS_KEY
   - SERPAPI_API_KEY
   - NEOMAIL SMTP credentials

---

## Step 1: Set Up GitHub Repository

### 1.1 Create GitHub Repo
```bash
cd "/Users/sumanthumboli/Downloads/FlexeTravels website"
git init
git add .
git commit -m "Initial commit: FlexeTravels with dynamic tours and marketing system"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/flexetravels.git
git push -u origin main
```

### 1.2 Create `.gitignore` (if not exists)
```
__pycache__/
*.pyc
.env
.env.local
.cache/
logs/
output/
node_modules/
.DS_Store
```

---

## Step 2: Prepare Backend for Railway Deployment

### 2.1 Create `requirements.txt` in `/backend`
```bash
cd backend
pip freeze > requirements.txt
# Add to requirements.txt:
# anthropic==0.x.x
# fastapi==0.x.x
# uvicorn==0.x.x
# python-dotenv==0.x.x
# requests==2.x.x
```

### 2.2 Create `Procfile` in `/backend`
```
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

### 2.3 Create `railway.json` in `/backend`
```json
{
  "build": {
    "builder": "nixpacks"
  },
  "deploy": {
    "startCommand": "uvicorn main:app --host 0.0.0.0 --port $PORT"
  }
}
```

### 2.4 Update Backend for Production

In `backend/main.py`, add at the top:
```python
import os
from fastapi.middleware.cors import CORSMiddleware

# Allow Vercel domain
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost",
    "https://flexetravels.com",
    "https://www.flexetravels.com",
    "https://flexetravels-frontend.vercel.app",  # Vercel default
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

In `backend/config.py`, update API URLs:
```python
import os

# Use Railway environment variable if available
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("PORT", "8000"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# For production
if os.getenv("RAILWAY_ENVIRONMENT") == "production":
    FRONTEND_URL = "https://flexetravels.com"
```

---

## Step 3: Deploy Backend to Railway

### 3.1 Login to Railway.app
- Go to: https://railway.app
- Click "Start Now"
- Choose "Deploy from GitHub"
- Authorize Railway to access your GitHub

### 3.2 Create New Project
1. Click "Create a new project"
2. Select "Deploy from GitHub"
3. Choose your `flexetravels` repository
4. Select `/backend` as root directory (if asked)
5. Railway auto-detects Python

### 3.3 Add Environment Variables
In Railway dashboard:
1. Go to Variables
2. Add all from your `.env` file:
```
ANTHROPIC_API_KEY=sk-ant-...
AMADEUS_API_KEY=...
AMADEUS_API_SECRET=...
UNSPLASH_ACCESS_KEY=...
SERPAPI_API_KEY=...
SMTP_USER=suman@flexetravels.com
SMTP_PASSWORD=...
SMTP_HOST=smtp0001.neo.space
SMTP_PORT=587
SMTP_USE_TLS=true
MARKETING_EMAIL_RECIPIENT=suman@flexetravels.com
CHATBOT_URL=https://flexetravels.com
ALLOWED_ORIGINS=https://flexetravels.com,https://www.flexetravels.com
```

### 3.4 Get Backend URL
- Copy your Railway URL: `https://your-project.railway.app`
- Note this for Step 5

---

## Step 4: Prepare Frontend for Vercel Deployment

### 4.1 Update `app.js` for Production
Change this line:
```javascript
// OLD (local)
const API_BASE = 'http://localhost:8000';

// NEW (production)
const API_BASE = window.location.hostname === 'localhost' 
  ? 'http://localhost:8000' 
  : 'https://your-railway-url.railway.app';
```

Or use environment file:

Create `frontend/.env.production`:
```
VITE_API_BASE=https://your-railway-url.railway.app
```

### 4.2 Update `index.html`
Make sure it references `app.js` correctly:
```html
<script src="app.js"></script>
```

---

## Step 5: Deploy Frontend to Vercel

### 5.1 Login to Vercel
- Go to: https://vercel.com
- Click "Sign Up" (or login)
- Choose "Continue with GitHub"

### 5.2 Create New Project
1. Click "New Project"
2. Import your GitHub repository
3. Select root directory: `/` (or just the website folder if separated)
4. Click "Deploy"

### 5.3 Add Environment Variables
In Vercel project settings:
1. Go to Settings → Environment Variables
2. Add:
```
VITE_API_BASE=https://your-railway-url.railway.app
REACT_APP_API_BASE=https://your-railway-url.railway.app
```

### 5.4 Get Vercel URL
- Your site deployed at: `https://flexetravels-frontend.vercel.app`
- Or use custom domain (Step 6)

---

## Step 6: Configure Custom Domain (flexetravels.com)

### 6.1 Update Namecheap DNS
1. Go to Namecheap Dashboard
2. Select flexetravels.com → Manage
3. Go to Advanced DNS
4. Remove old DNS records
5. Add new records:

**For Vercel (Frontend):**
```
Type: CNAME
Name: www
Value: cname.vercel-dns.com
TTL: 3600
```

**For Root Domain (@):**
Option A - Direct to Vercel:
```
Type: ALIAS/ANAME
Name: @
Value: flexetravels-frontend.vercel.app
TTL: 3600
```

Option B - Use Vercel Nameservers (recommended):
Go to Vercel → Domains → Add Domain → Select Namecheap → Follow instructions

### 6.2 In Vercel Dashboard
1. Go to Project Settings → Domains
2. Add Domain: `flexetravels.com`
3. Add Domain: `www.flexetravels.com`
4. Follow verification steps

### 6.3 Update Backend API Domain
1. In Railway environment variables, update:
```
FRONTEND_URL=https://flexetravels.com
ALLOWED_ORIGINS=https://flexetravels.com,https://www.flexetravels.com
```

2. In app.js, update API_BASE to use actual domain:
```javascript
const API_BASE = window.location.hostname.includes('localhost')
  ? 'http://localhost:8000'
  : 'https://api.flexetravels.com';  // or your Railway domain
```

---

## Step 7: Testing Deployment

### 7.1 Test Backend API
```bash
curl https://your-railway-url.railway.app/api/featured-tours
```

Should return:
```json
{
  "location": {"city": "New York", ...},
  "tours": [...]
}
```

### 7.2 Test Website
1. Open https://flexetravels.com
2. Open Browser Console (F12)
3. Check for logs:
   - 🚀 Fetching featured tours
   - ✅ Tours API response
4. Verify skeleton cards replaced with real tours
5. Click a tour → Chat opens with pre-filled message

### 7.3 Test Marketing Workflow
```bash
# Via API endpoint
curl -X POST https://your-railway-url.railway.app/api/marketing/run-weekly

# Should send email to suman@flexetravels.com
```

---

## Step 8: DNS Propagation & SSL

- DNS changes take 15 mins - 48 hours
- Vercel auto-generates SSL certificate
- Railway provides free HTTPS
- Check propagation: https://www.whatsmydns.net/

---

## Troubleshooting

### "CORS Error" on Frontend
- Check `ALLOWED_ORIGINS` in backend
- Update Railway env variables
- Restart Railway deployment

### "Cannot reach backend"
- Verify Railway URL is correct in app.js
- Check Railway logs in dashboard
- Ensure API keys are set in Railway

### "Domain not resolving"
- Wait for DNS propagation (24 hours max)
- Check DNS records in Namecheap
- Verify in Vercel domain settings

### "Email not sending"
- Check NEOMAIL SMTP credentials
- Verify account has SMTP enabled
- Check Railway logs for SMTP errors

---

## Cost Breakdown

| Service | Cost | Notes |
|---------|------|-------|
| Railway.app | Free | Free tier includes $5/month credits |
| Vercel | Free | Completely free for static/JAMstack |
| Namecheap Domain | ~$10/year | Already purchased |
| **Total** | **Free** | Completely free for testing! |

---

## Production Checklist

- [ ] GitHub repo created and code pushed
- [ ] `requirements.txt` created
- [ ] Backend environment variables in Railway
- [ ] Frontend deployed to Vercel
- [ ] Custom domain pointing to Vercel
- [ ] CORS configured for production domain
- [ ] API_BASE updated in app.js
- [ ] SSL certificate auto-generated
- [ ] Email workflow tested
- [ ] Featured tours loading on website
- [ ] Chatbot integration working
- [ ] Marketing emails sending

---

## Next Steps After Deployment

1. **Monitor Logs**
   - Railway: Dashboard → Deployments → Logs
   - Vercel: Deployments → Functions logs

2. **Auto-Deploy on Push**
   - Both Vercel and Railway auto-deploy on GitHub push
   - No manual deployment needed!

3. **Scale When Needed**
   - Railway offers paid tiers ($5+ per month)
   - Vercel scales automatically for free

---

**🎉 You're now live on https://flexetravels.com!**
