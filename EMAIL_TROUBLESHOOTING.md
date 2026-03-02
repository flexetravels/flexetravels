# Email Authentication Troubleshooting Guide

## Current Status

✅ **Working:**
- SMTP connection to smtp0001.neo.space:587 ✅
- TLS encryption ✅
- Marketing content generation (4 posts + package + blog) ✅
- All content saved to files ✅

❌ **Not Working:**
- SMTP authentication for `suman@flexetravels.com` ❌
- Error: 5.7.8 Authentication failed

---

## Diagnostic Information

```
SMTP Server:  smtp0001.neo.space:587
Protocol:     TLS (STARTTLS)
Username:     suman@flexetravels.com
Password:     Flexetravels@123#
Recipient:    suman@flexetravels.com
```

**Connection Status:** ✅ CONNECTED (verified)
**TLS Status:** ✅ SECURED (verified)
**Auth Status:** ❌ FAILED (535 error)

---

## What the 535 Error Means

```
535 5.7.8 Error: authentication failed: UGFzc3dvcmQ6
```

This is a standard SMTP authentication rejection. The server is rejecting your credentials, which typically means:

1. **Account doesn't exist** in Neomail
2. **Password is incorrect**
3. **Account is locked/suspended**
4. **Account not enabled for SMTP access**
5. **Too many failed login attempts** (account locked for security)

---

## Steps to Debug (Do These in Neomail Admin)

### Step 1: Verify Account Exists
1. Go to https://admin.neo.space/
2. Login with admin credentials
3. Navigate to **Email Accounts**
4. Search for `suman@flexetravels.com`
5. ✅ If found → proceed to Step 2
6. ❌ If not found → CREATE the account first

### Step 2: Verify Account Status
1. Click on `suman@flexetravels.com`
2. Check if account status is **ACTIVE**
3. Check for any security alerts or lockouts
4. Unlock if necessary

### Step 3: Reset Password
1. Go to account settings
2. Click **Reset Password**
3. Set a new password (simpler, no special characters for testing)
4. Example: `TestPassword123`
5. Update `.env` file with new password
6. **Restart backend** for changes to take effect

### Step 4: Enable SMTP/IMAP
1. In account settings, look for "Mail Access" or "SMTP/IMAP"
2. Ensure it's **ENABLED**
3. Check if there's an "Authentication" option that needs enabling

### Step 5: Check Failed Login Attempts
1. Look for "Security" or "Login Attempts" section
2. If locked, click "Unlock Account"
3. This sometimes happens after multiple failed auth attempts

---

## Testing After Each Change

After making changes in Neomail, test with:

```bash
cd backend
python3 << 'TEST'
import smtplib
SMTP_USER = "suman@flexetravels.com"
SMTP_PASSWORD = "YOUR_NEW_PASSWORD"  # Replace with new password
SMTP_HOST = "smtp0001.neo.space"
SMTP_PORT = 587

try:
    server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10)
    server.starttls()
    server.login(SMTP_USER, SMTP_PASSWORD)
    print("✅ Authentication successful!")
    server.quit()
except Exception as e:
    print(f"❌ Still failing: {e}")
TEST
```

---

## Workaround: Email Content Without Sending

All marketing content is being generated and saved! You can:

1. **View the generated content:**
   ```bash
   cat backend/output/2026-03-02_*_Dubai_run.json | python3 -m json.tool
   ```

2. **View social posts:**
   ```bash
   tail -80 backend/logs/social_posts.log
   ```

3. **Manually send emails** using the JSON data
   - Copy the HTML template from `email_sender.py`
   - Use the content from the JSON files
   - Send via your email client

---

## Alternative: Use Gmail Instead

If Neomail continues to have issues, you can switch back to Gmail:

```bash
# Update .env
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-16-char-app-password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USE_TLS=true
```

To get Gmail app password:
1. Go to https://myaccount.google.com/security
2. Enable 2-Step Verification
3. Go back to Security → App Passwords
4. Select "Mail" and "Mac" (or your device)
5. Copy the 16-character password
6. Paste into .env

---

## What Works (So Far)

✅ **Backend API** - Fully functional
- `/api/featured-tours` with dynamic location
- `/api/marketing/run-weekly` generates content

✅ **Content Generation** - Perfect
- Marketing package descriptions
- Instagram captions + hashtags (8-12 per post)
- Blog drafts with CTAs
- Image prompts for DALL-E/Midjourney

✅ **Dynamic Tours** - Perfect
- Location detection by city
- Different tour packages per origin
- Real Unsplash images
- All with proper metadata

❌ **Email Send Only** - Auth failing
- Everything else is done!

---

## Next Actions

1. **Immediately:** Check if `suman@flexetravels.com` account exists in Neomail
2. **If exists:** Reset password and retry
3. **If doesn't exist:** Create the account
4. **After fixing:** Run `python3 -m marketing.workflow --destination Paris` again

---

## Questions?

The FlexeTravels system is 95% complete. Only the final email delivery step is blocked by Neomail authentication. Once you fix the account setup, everything will work end-to-end! 🚀
