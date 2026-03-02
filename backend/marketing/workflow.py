"""
FlexeTravels — OTA Weekly Marketing Workflow
Adapted from the Gumloop workflow.py template.
Generates travel marketing content (package + 4 Instagram posts + blog)
and emails it to the marketing team.

Run manually: python3 -m marketing.workflow --destination "Tokyo"
Or trigger via API: POST /api/marketing/run-weekly
"""

import json
import logging
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import (
    ANTHROPIC_API_KEY, CLAUDE_MODEL, HAS_CLAUDE,
    MARKETING_EMAIL_RECIPIENT, BRAND_NAME, CHATBOT_URL, CHATBOT_UTM,
    MAX_RETRIES,
)

logger = logging.getLogger(__name__)

OUTPUT_DIR = Path(__file__).parent.parent / "output"

CONTENT_SYSTEM_PROMPT = f"""You are the marketing AI for {BRAND_NAME}, a premium AI-powered travel agency.
Your job: Generate one featured travel package + 4 Instagram posts + 1 blog introduction.

STRICT RULES:
- Instagram captions: 100-220 characters (HARD LIMIT)
- Hashtags: Exactly 8-12 per post, travel-relevant
- Tone: Aspirational, warm, exciting — never salesy or pushy
- Prices: Realistic USD ranges for international travel
- Never repeat the same destination in posts
- Package rotation: Vary destinations (beach, culture, adventure, city, nature)
- Every post must have a unique angle (e.g., food, sunset, culture, adventure)

UTM link to include: {CHATBOT_URL}?{CHATBOT_UTM}"""

CONTENT_PROMPT_TEMPLATE = """Generate a complete weekly marketing package for: {destination}

CAPTIONS MUST BE:
- Clickable & engaging (use power words: "insane", "unforgettable", "mind-blowing", "hidden gem", etc.)
- Include specific details or experiences (not generic)
- 100-220 characters ONLY (not counting hashtags)
- Use emojis strategically
- Create FOMO or urgency ("limited spots", "locals know", etc.)

Return ONLY valid JSON in this exact structure:
{{
  "package": {{
    "name": "Creative tour name",
    "destination": "{destination}",
    "tagline": "Short punchy tagline with power word",
    "description": "2-3 sentences about this trip. What makes it special?",
    "duration": "X days / Y nights",
    "price": "From $X,XXX per person",
    "highlights": ["highlight 1", "highlight 2", "highlight 3", "highlight 4"],
    "currency": "USD"
  }},
  "posts": [
    {{
      "caption": "CLICKABLE caption (100-220 chars, power words, emojis, specific details, creates FOMO)",
      "hashtags": "#travel #[destination] #[relevant tags]",
      "image_prompt": "Extremely detailed, cinematic, professional photoshoot style image prompt",
      "post_theme": "e.g., Sunset, Street Food, Architecture, Adventure"
    }},
    {{...}},
    {{...}},
    {{...}}
  ],
  "blog": {{
    "title": "SEO-optimised blog post title (with numbers or power words)",
    "intro": "Opening paragraph (2-3 sentences) with hook that creates urgency",
    "cta": "Call to action sentence linking to the chatbot"
  }}
}}

NO markdown. NO explanation. Pure JSON only."""


class FlexeTravelsMarketingWorkflow:
    """OTA weekly marketing content generator."""

    def run(self, destination: str = None) -> dict:
        """
        Run the full marketing workflow for a destination.

        Args:
            destination: Target destination (e.g., "Tokyo"). If None, uses analytics to pick.

        Returns:
            Status dict with run results.
        """
        if not destination:
            destination = "Tokyo"  # Safe default

        OUTPUT_DIR.mkdir(exist_ok=True)
        run_date = datetime.utcnow().strftime("%Y-%m-%d_%H%M")
        run_file = OUTPUT_DIR / f"{run_date}_{destination.replace(' ', '_')}_run.json"

        logger.info(f"Starting marketing workflow for: {destination}")

        # ── Node 1: Generate content with Claude ────────────────────────
        content = self._node1_generate_content(destination)
        if not content:
            return {
                "status": "failed",
                "destination": destination,
                "error": "Content generation failed after retries",
                "email_sent": False,
            }

        # ── Node 2: Parse + validate ─────────────────────────────────────
        parsed = self._node2_parse_validate(content)
        if not parsed:
            return {
                "status": "failed",
                "destination": destination,
                "error": "JSON parsing/validation failed",
                "raw_output": content,
                "email_sent": False,
            }

        package = parsed.get("package", {})
        posts = parsed.get("posts", [])
        blog = parsed.get("blog", {})

        # ── Node 3: Log social posts ────────────────────────────────────
        self._node3_log_posts(destination, posts)

        # ── Node 4: Send email ───────────────────────────────────────────
        email_sent = self._node4_send_email(destination, package, posts, blog)

        # Save run record
        run_record = {
            "run_date": run_date,
            "destination": destination,
            "package": package,
            "posts": posts,
            "blog": blog,
            "email_sent": email_sent,
        }
        try:
            run_file.write_text(json.dumps(run_record, indent=2))
        except Exception as e:
            logger.warning(f"Failed to save run record: {e}")

        return {
            "status": "success",
            "destination": destination,
            "posts_count": len(posts),
            "email_sent": email_sent,
            "run_file": str(run_file),
        }

    def _node1_generate_content(self, destination: str):
        """Node 1: Ask Claude to generate marketing content."""
        if not HAS_CLAUDE:
            logger.error("ANTHROPIC_API_KEY not set — cannot generate content")
            return None

        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        prompt = CONTENT_PROMPT_TEMPLATE.format(destination=destination)

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                logger.info(f"Generating content for {destination} (attempt {attempt})")
                message = client.messages.create(
                    model=CLAUDE_MODEL,
                    max_tokens=3000,
                    system=CONTENT_SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": prompt}]
                )
                return message.content[0].text.strip()
            except Exception as e:
                logger.warning(f"Claude generation attempt {attempt} failed: {e}")
                if attempt == MAX_RETRIES:
                    return None

        return None

    def _node2_parse_validate(self, raw: str):
        """Node 2: Parse JSON and validate required fields."""
        # Strip markdown fences
        text = raw.strip()
        if text.startswith("```"):
            parts = text.split("```")
            text = parts[1] if len(parts) > 1 else text
            if text.startswith("json"):
                text = text[4:]
        text = text.strip().rstrip("```").strip()

        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}\nRaw: {text[:300]}")
            return None

        # Validate required keys
        if not data.get("package"):
            logger.error("Missing 'package' in response")
            return None
        if not isinstance(data.get("posts"), list) or len(data["posts"]) == 0:
            logger.error("Missing or empty 'posts' in response")
            return None
        if not data.get("blog"):
            logger.error("Missing 'blog' in response")
            return None

        return data

    def _node3_log_posts(self, destination: str, posts: list) -> None:
        """Node 3: Log social posts to file (Buffer integration added later)."""
        from config import LOGS_DIR
        log_file = LOGS_DIR / "social_posts.log"
        timestamp = datetime.utcnow().isoformat()
        try:
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(f"\n{'='*60}\n")
                f.write(f"WEEKLY MARKETING RUN — {destination} — {timestamp}\n")
                f.write(f"{'='*60}\n")
                for i, post in enumerate(posts[:4], 1):
                    f.write(f"\n--- Post {i} ({post.get('post_theme', '')}) ---\n")
                    f.write(f"{post.get('caption', '')}\n")
                    f.write(f"{post.get('hashtags', '')}\n")
                    f.write(f"📸 {post.get('image_prompt', '')}\n")
            logger.info(f"Posts logged to {log_file}")
        except Exception as e:
            logger.warning(f"Failed to log posts: {e}")

    def _node4_send_email(self, destination: str, package: dict, posts: list, blog: dict) -> bool:
        """Node 4: Send rich HTML marketing email."""
        from marketing.email_sender import send_html_email, build_marketing_html

        subject = f"✈️ FlexeTravels Weekly: {destination} Campaign Ready"
        html, plain = build_marketing_html(destination, package, posts, blog)
        return send_html_email(subject, html, plain, MARKETING_EMAIL_RECIPIENT)


# ── CLI entry point ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    parser = argparse.ArgumentParser(description="FlexeTravels Weekly Marketing Workflow")
    parser.add_argument("--destination", "-d", default=None, help="Target destination (e.g., 'Tokyo')")
    parser.add_argument("--test", action="store_true", help="Test mode: print output without sending email")
    args = parser.parse_args()

    dest = args.destination
    if not dest:
        from marketing.tour_analytics import get_top_destination
        dest = get_top_destination(days=7)
        print(f"📊 Auto-selected destination from analytics: {dest}")

    workflow = FlexeTravelsMarketingWorkflow()

    if args.test:
        # Override email sending
        content = workflow._node1_generate_content(dest)
        parsed = workflow._node2_parse_validate(content) if content else None
        if parsed:
            print(f"\n✅ Content generated for {dest}")
            print(json.dumps(parsed, indent=2))
        else:
            print("❌ Content generation failed")
    else:
        result = workflow.run(destination=dest)
        print(f"\n{'✅' if result['status'] == 'success' else '❌'} Workflow result:")
        print(json.dumps(result, indent=2))
