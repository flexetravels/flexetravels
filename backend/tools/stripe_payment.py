"""
FlexeTravels — Stripe Payment Tool
Creates a Stripe checkout session for the travel package.
Falls back to a mock payment link if API keys are missing.
"""

import json
from tenacity import retry, stop_after_attempt, wait_exponential

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from config import STRIPE_SECRET_KEY, HAS_STRIPE, MAX_RETRIES, RETRY_DELAY, RETRY_MAX_DELAY


class StripePaymentTool:
    name: str = "stripe_payment"
    description: str = (
        "Create a Stripe checkout session for payment. "
        "Arguments: amount (float), currency (str), description (str), customer_email (str)."
    )

    def _run(self, amount: float, currency: str, description: str, customer_email: str) -> str:
        """
        Create a payment link.
        """
        if HAS_STRIPE:
            try:
                result = self._create_checkout_session(amount, currency, description, customer_email)
                return json.dumps(result, indent=2)
            except Exception as e:
                return json.dumps({
                    "status": "error",
                    "message": f"Stripe API Error: {str(e)}. Using mock link.",
                    "payment_url": "https://checkout.stripe.com/pay/mock_fallback"
                })
        else:
            return json.dumps({
                "status": "created (mock)",
                "payment_url": f"https://checkout.stripe.com/pay/mock_{int(amount)}_{currency}",
                "amount": amount,
                "currency": currency,
                "note": "This is a simulated payment link."
            }, indent=2)

    @retry(stop=stop_after_attempt(MAX_RETRIES), wait=wait_exponential(multiplier=RETRY_DELAY, max=RETRY_MAX_DELAY))
    def _create_checkout_session(self, amount: float, currency: str, description: str, customer_email: str) -> dict:
        """Create a live Stripe Checkout Session."""
        import stripe
        stripe.api_key = STRIPE_SECRET_KEY

        session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{
                'price_data': {
                    'currency': currency,
                    'product_data': {
                        'name': description,
                    },
                    'unit_amount': int(amount * 100),  # Amount in cents
                },
                'quantity': 1,
            }],
            mode='payment',
            success_url='http://localhost:3000/?payment=success',
            cancel_url='http://localhost:3000/?payment=canceled',
            customer_email=customer_email,
        )

        return {
            "status": "created",
            "payment_url": session.url,
            "session_id": session.id
        }
