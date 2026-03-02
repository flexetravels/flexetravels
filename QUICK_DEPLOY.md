# ⚡ FlexeTravels Quick Deployment Checklist

## 🚀 Deploy in 10 Minutes!

### Step 1: GitHub Setup (2 min)
```bash
# Go to https://github.com/new
# Create new repo: "flexetravels"
# Then run in your terminal:

cd "/Users/sumanthumboli/Downloads/FlexeTravels website"
git init
git add .
git commit -m "Initial commit: FlexeTravels with dynamic tours and marketing system"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/flexetravels.git
git push -u origin main
```

### Step 2: Deploy Backend to Railway (3 min)
1. Go to: https://railway.app
2. Click "Start Now" → "Deploy from GitHub"
3. Authorize Railway
4. Select your "flexetravels" repository
5. Select `/backend` as root directory
6. Railway auto-detects Python and deploys!
7. When done, click on the service to get your Railway URL

### Step 3: Add Environment Variables to Railway (3 min)
In Railway Dashboard:
1. Go to Variables
2. Copy each from your local `.env` file:
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

### Step 4: Deploy Frontend to Vercel (2 min)
1. Go to: https://vercel.com
2. Click "New Project"
3. Import your "flexetravels" GitHub repository
4. Click "Deploy"
5. Get your Vercel URL: `https://flexetravels-[random].vercel.app`

### Step 5: Connect Your Domain (1 min)
1. In Vercel Dashboard → Project Settings → Domains
2. Add: `flexetravels.com`
3. Follow Vercel's instructions to connect Namecheap
4. In Namecheap, update DNS to point to Vercel

---

## ✅ Testing Checklist

```bash
# Test Backend API
curl https://your-railway-url/api/featured-tours

# Should return JSON with tours
```

Then:
1. Open https://flexetravels.com
2. Open Browser Console (F12)
3. Should see tour cards loading
4. Click a tour → Chat opens
5. Check email for test marketing workflow

---

## 📋 Your URLs After Deployment

| Service | URL |
|---------|-----|
| Frontend | https://flexetravels.com |
| Backend API | https://your-project.railway.app |
| GitHub Repo | https://github.com/YOUR_USERNAME/flexetravels |
| Vercel Project | https://vercel.com/dashboard |
| Railway Dashboard | https://railway.app/dashboard |

---

## 🎯 Next Steps

1. **Monitor in Real-Time:**
   - Railway Logs: Dashboard → Logs
   - Vercel Logs: Deployments → Functions

2. **Auto-Deploy on Git Push:**
   - Both services auto-deploy when you push to main
   - No manual deployment needed!

3. **Update API URL in app.js:**
   Replace in `app.js` line 115:
   ```javascript
   const API_BASE = 'https://your-railway-url.railway.app';
   ```
   Then push to GitHub → auto-deploys!

---

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| CORS Error | Check `ALLOWED_ORIGINS` in Railway variables |
| API not responding | Verify Railway URL in app.js |
| Domain not working | Wait 24h for DNS propagation |
| Email not sending | Check SMTP credentials in Railway |

---

## 💰 Cost: $0/month! 🎉

- Railway: Free tier ($5 credit monthly)
- Vercel: Free tier
- Namecheap domain: ~$10/year
- All API keys: Free/Freemium

Total ongoing cost: **FREE** for testing!

---

**Everything is ready to deploy! Follow the 5 steps above in about 10 minutes.** 🚀
