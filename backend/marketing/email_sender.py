"""
FlexeTravels — Marketing Email Sender
Sends rich HTML emails via SMTP (Gmail, Neomail, or any SMTP server).
Uses Python stdlib only (no extra packages).
"""

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import SMTP_USER, SMTP_PASSWORD, SMTP_HOST, SMTP_PORT, SMTP_USE_TLS, HAS_EMAIL

logger = logging.getLogger(__name__)


def send_html_email(subject: str, html: str, plain: str, recipient: str) -> bool:
    """
    Send an HTML email via SMTP (Gmail, Neomail, or any SMTP server).

    Args:
        subject: Email subject line
        html: Full HTML body
        plain: Plain-text fallback body
        recipient: Recipient email address

    Returns:
        True if sent successfully, False otherwise
    """
    if not HAS_EMAIL:
        logger.warning("SMTP credentials not configured — email not sent. Check SMTP_USER and SMTP_PASSWORD in .env")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"FlexeTravels Marketing <{SMTP_USER}>"
        msg["To"] = recipient

        msg.attach(MIMEText(plain, "plain"))
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            if SMTP_USE_TLS:
                server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_USER, recipient, msg.as_string())

        logger.info(f"Marketing email sent to {recipient} via {SMTP_HOST}:{SMTP_PORT}: {subject}")
        return True

    except Exception as e:
        logger.error(f"Failed to send marketing email via {SMTP_HOST}:{SMTP_PORT}: {e}")
        return False


def build_marketing_html(destination: str, package: dict, posts: list, blog: dict) -> tuple[str, str]:
    """Build the HTML + plain text email body for the weekly marketing run."""
    from tools.unsplash_images import get_destination_image

    pkg_name = package.get("name", destination)
    pkg_desc = package.get("description", "")
    pkg_price = package.get("price", "")
    pkg_duration = package.get("duration", "")
    pkg_highlights = package.get("highlights", [])

    # Get hero image for destination
    dest_image = get_destination_image(destination)
    hero_img_url = dest_image.get("url", "https://images.unsplash.com/photo-1488085061851-d223a4463480?w=800&h=400&fit=crop")

    highlights_html = "".join(f"<li>{h}</li>" for h in pkg_highlights)
    highlights_plain = "\n".join(f"• {h}" for h in pkg_highlights)

    posts_html = ""
    posts_plain = ""
    for i, post in enumerate(posts[:4], 1):
        caption = post.get("caption", "")
        hashtags = post.get("hashtags", "")
        post_theme = post.get("post_theme", "Travel")

        # Try to get a thematic image from Unsplash
        theme_lower = post_theme.lower()
        search_term = f"{theme_lower} {destination}" if theme_lower not in ["sunset", "sunrise"] else theme_lower
        theme_image = get_destination_image(search_term)
        img_url = theme_image.get("url", hero_img_url)

        posts_html += f"""
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:16px 0;">
          <img src="{img_url}" alt="{post_theme}" style="width:100%;height:280px;object-fit:cover;display:block;">
          <div style="padding:16px;">
            <p style="margin:0 0 8px;font-weight:600;color:#4f46e5;font-size:0.9em;">📸 {post_theme} Post #{i}</p>
            <p style="margin:0 0 8px;color:#1e293b;font-weight:500;font-size:0.95em;">{caption}</p>
            <p style="margin:0;color:#64748b;font-size:0.8em;">{hashtags}</p>
          </div>
        </div>"""
        posts_plain += f"\n── Post {i}: {post_theme} ──\n{caption}\n{hashtags}\n"

    blog_title = blog.get("title", "")
    blog_intro = blog.get("intro", "")
    blog_cta = blog.get("cta", "")

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FlexeTravels Weekly Marketing — {destination}</title></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f1f5f9;margin:0;padding:0;">
<div style="max-width:680px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);padding:32px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:1.6rem;font-weight:700;">✈️ FlexeTravels</h1>
    <p style="color:#94a3b8;margin:8px 0 0;font-size:0.9rem;">Weekly Marketing Package</p>
  </div>

  <!-- Destination Hero Image -->
  <img src="{hero_img_url}" alt="{destination}" style="width:100%;height:300px;object-fit:cover;display:block;">

  <!-- Destination Hero -->
  <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:24px 32px;">
    <h2 style="color:#fff;margin:0;font-size:1.6rem;">🎯 This Week: {destination}</h2>
    <p style="color:#c7d2fe;margin:8px 0 0;font-size:0.95rem;">Perfect Package · 4 Viral Posts · Ready-to-Publish Blog</p>
  </div>

  <div style="padding:32px;">

    <!-- Package -->
    <div style="background:linear-gradient(135deg,#f8fafc,#f1f5f9);padding:20px;border-radius:8px;border-left:4px solid #6366f1;margin-bottom:20px;">
      <h3 style="color:#0f172a;margin:0 0 12px;font-size:1.2rem;">✨ Featured Package: {pkg_name}</h3>
      <p style="color:#475569;margin:0 0 12px;line-height:1.6;">{pkg_desc}</p>
      {'<p style="color:#dc2626;font-weight:700;font-size:1.1em;margin:0 0 8px;">💰 ' + pkg_price + '</p>' if pkg_price else ''}
      {'<p style="color:#64748b;font-weight:500;">⏱️ Duration: ' + pkg_duration + '</p>' if pkg_duration else ''}
      {f'<ul style="color:#475569;padding:12px 0 0 20px;margin:0;">{highlights_html}</ul>' if highlights_html else ''}
    </div>

    <!-- Instagram Posts -->
    <h3 style="color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin-top:32px;">📱 Instagram Posts</h3>
    {posts_html}

    <!-- Blog -->
    <h3 style="color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin-top:32px;">📝 Blog Draft</h3>
    <div style="background:#fafafa;padding:16px;border-radius:8px;">
      <p style="font-weight:600;color:#1e293b;margin:0 0 8px;">{blog_title}</p>
      <p style="color:#475569;margin:0 0 8px;">{blog_intro}</p>
      <p style="color:#6366f1;font-style:italic;margin:0;">{blog_cta}</p>
    </div>

    <!-- Action Checklist -->
    <h3 style="color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin-top:32px;">✅ Your Action Checklist</h3>
    <ul style="color:#475569;line-height:1.8;">
      <li>Generate images using the prompts above (Midjourney / DALL-E / Canva)</li>
      <li>Review and personalise each Instagram caption</li>
      <li>Schedule posts in Buffer (Mon, Wed, Fri, Sun)</li>
      <li>Publish or schedule the blog draft</li>
      <li>Pin the featured tour to the website's hero section</li>
    </ul>

  </div>

  <!-- Footer -->
  <div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
    <p style="color:#94a3b8;font-size:0.8rem;margin:0;">
      FlexeTravels AI — Automated Marketing System<br>
      <a href="http://localhost:3000" style="color:#6366f1;">Visit FlexeTravels</a>
    </p>
  </div>

</div>
</body>
</html>"""

    plain = f"""FlexeTravels Weekly Marketing — {destination}
{'='*50}

FEATURED PACKAGE: {pkg_name}
{pkg_desc}
{pkg_price}
{highlights_plain}

INSTAGRAM POSTS
{posts_plain}

BLOG DRAFT
Title: {blog_title}
{blog_intro}
{blog_cta}

ACTION CHECKLIST
• Generate images using the prompts above
• Review and personalise each caption
• Schedule posts in Buffer
• Publish the blog draft
• Pin the featured tour to the website
"""
    return html, plain
