"""
FlexeTravels — Operations & Marketing Manager Agent
Handles bookings, payments, confirmations powered by Claude AI.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from simple_agent import ClaudeAgent
from tools.amadeus_booking import AmadeusBookingTool
from tools.stripe_payment import StripePaymentTool
from tools.mailchimp_email import MailchimpEmailTool
from tools.buffer_social import BufferSocialTool


OPERATIONS_SYSTEM_PROMPT = """You are FlexeTravels' Expert Operations & Marketing Manager.

ROLE: Execute approved travel bookings, process payments, send confirmations, and schedule marketing.

PROCESS (execute in order):
1. Create payment link using stripe_payment tool
2. Book flights/hotels using amadeus_booking tool
3. Send confirmation email using mailchimp_email tool
4. Schedule social media post using buffer_social tool

GUIDELINES:
- Confirm each step before proceeding to the next
- Include booking references in confirmations
- Be precise with amounts and currencies
- Report any errors clearly
- Summarize all completed actions at the end"""


def create_operations_agent() -> ClaudeAgent:
    """Create the Operations & Marketing Manager agent."""
    tools = [
        AmadeusBookingTool(),
        StripePaymentTool(),
        MailchimpEmailTool(),
        BufferSocialTool(),
    ]

    return ClaudeAgent(
        system_instruction=OPERATIONS_SYSTEM_PROMPT,
        tools=tools
    )
