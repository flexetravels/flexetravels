# 🚀 FlexeTravels GitHub & Deployment Checklist

## ✅ Step 1: Create GitHub Repository (2 minutes)

1. Go to: **https://github.com/new**
2. Fill in:
   - **Repository name:** `flexetravels`
   - **Description:** FlexeTravels - Dynamic travel tours with marketing automation
   - **Public:** Yes (select)
   - **Don't** check "Add a README" (we have one)
3. Click **Create repository**
4. Copy your repo URL: `https://github.com/YOUR_USERNAME/flexetravels.git`

---

## ✅ Step 2: Push Code to GitHub (1 minute)

Replace `YOUR_USERNAME` and run in terminal:

```bash
cd "/Users/sumanthumboli/Downloads/FlexeTravels website"
git remote add origin https://github.com/YOUR_USERNAME/flexetravels.git
git branch -M main
git push -u origin main
```

**Expected output:**
```
Counting objects: 100% (67/67)
Writing objects: 100% (67/67)
...
✅ To https://github.com/YOUR_USERNAME/flexetravels.git
 * [new branch]      main -> main
```

Verify at: `https://github.com/YOUR_USERNAME/flexetravels`

---

## ✅ Step 3: Deploy Backend to Railway.app (3 minutes)

1. Go to: **https://railway.app**
2. Click **Start Now** → **Deploy from GitHub**
3. Authorize Railway with your GitHub account
4. Select your `flexetravels` repository
5. Set root directory: `/backend` ⚠️ **IMPORTANT**
6. Railway auto-detects Python and deploys!
7. When done, copy the Railway URL (Dashboard → Your Project → Settings → URL)
   - Format: `https://your-project-xxxxx.railway.app`

**Environment Variables in Railway:**
Go to Railway Dashboard → Variables and add:
```
ANTHROPIC_API_KEY=sk-ant-...          (from your local .env)
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
ALLOWED_ORIGINS=https://flexetravels.com,https://www.flexetravels.com,http://localhost:3000
```

**Test the backend:**
```bash
curl https://YOUR_RAILWAY_URL/api/featured-tours
# Should return JSON with tours ✅
```

---

## ✅ Step 4: Deploy Frontend to Vercel (2 minutes)

1. Go to: **https://vercel.com**
2. Click **New Project**
3. Import your `flexetravels` GitHub repository
4. Framework: Select **Other** (vanilla JavaScript)
5. Root Directory: `.` (leave default)
6. Click **Deploy**
7. Copy your Vercel URL when deployment finishes
   - Format: `https://flexetravels-xxxxx.vercel.app`

**Update API URL:**
Before the domain works, you need to update app.js with your Railway URL:

1. In this project, edit `app.js` line ~115:
   ```javascript
   const API_BASE = 'https://YOUR_RAILWAY_URL.railway.app';
   ```
2. Replace with your actual Railway URL
3. Commit and push:
   ```bash
   git add app.js
   git commit -m "Update API_BASE to production Railway URL"
   git push origin main
   ```
4. Vercel auto-deploys! (takes 1-2 minutes)

Test at your Vercel URL: `https://flexetravels-xxxxx.vercel.app`

---

## ✅ Step 5: Connect Your Domain (5 minutes)

### In Vercel Dashboard:
1. Go to your Project → Settings → Domains
2. Add domain: `flexetravels.com`
3. Vercel shows you DNS settings

### In Namecheap:
1. Login to Namecheap
2. Go to your domain → Manage
3. Click **Advanced DNS**
4. Replace DNS records with Vercel's settings (Vercel will show exact records)
   - Usually: Update **A** record and **CNAME** records
5. Save changes (can take 24h to propagate)

**Verify domain:**
```bash
curl https://flexetravels.com
# Should return HTML ✅
```

---

## ✅ Step 6: Test Everything

1. **Open https://flexetravels.com**
2. **Console (F12):**
   - Should see tour cards loading with Unsplash images
   - Check for ✅ or ⚠️ messages
3. **Click a tour card:**
   - Chat box opens with pre-filled tour details
4. **Test marketing email:**
   ```bash
   curl -X POST https://YOUR_RAILWAY_URL/api/marketing/run-weekly
   # Check your email for HTML email with tour package + captions
   ```

---

## 📋 Your Deployment URLs

| Service | URL | Status |
|---------|-----|--------|
| **Frontend** | https://flexetravels.com | 🚀 |
| **Backend API** | https://your-project.railway.app | 🚀 |
| **GitHub Repo** | https://github.com/YOUR_USERNAME/flexetravels | 📦 |
| **Vercel Dashboard** | https://vercel.com/dashboard | 📊 |
| **Railway Dashboard** | https://railway.app/dashboard | 📊 |

---

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| **404 on flexetravels.com** | DNS not propagated yet (wait 24h) OR domain not added to Vercel |
| **CORS Error in console** | Check ALLOWED_ORIGINS in Railway variables (must include your Vercel URL) |
| **Tours not loading** | Verify API_BASE URL in app.js matches your Railway URL, then push to main |
| **Email not sending** | Check SMTP credentials in Railway variables, verify Neomail SMTP access enabled |
| **"Cannot GET /api/featured-tours"** | Ensure Railway deployment succeeded (check Railway logs) |

---

## 💰 Cost Breakdown

- **Railway:** FREE tier (~$5/month credit, backend uses ~$2)
- **Vercel:** FREE tier (frontend)
- **Namecheap:** ~$10/year (domain)
- **APIs:** All FREE/freemium (Amadeus, Unsplash, Claude, ip-api)

**Total ongoing cost: FREE** ✨

---

## 📝 After Deployment

**If you make code changes:**
1. Edit files locally
2. `git add .` / `git commit -m "message"` / `git push origin main`
3. Vercel auto-deploys frontend
4. Railway auto-deploys backend
5. Changes live in 1-2 minutes ✨

---

**Questions?** Check [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for detailed troubleshooting or [QUICK_DEPLOY.md](QUICK_DEPLOY.md) for quick reference.

Good luck! 🚀
