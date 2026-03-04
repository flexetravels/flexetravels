"""
FlexeTravels — Duffel Booking Tool
Create flight orders (PNR) via Duffel API.
Supports test mode with live_mode: false.
NOTE: For full production booking flow, may require separate passenger creation endpoint
"""

import json
import logging
import uuid
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

import requests
from config import DUFFEL_API_KEY, HAS_DUFFEL

logger = logging.getLogger(__name__)

# Duffel API base URL
DUFFEL_BASE_URL = "https://api.duffel.com"


class DuffelBookingTool:
    """Create flight orders (PNR) using Duffel API."""

    name = "duffel_booking"
    description = "Create a confirmed flight booking (PNR) via Duffel API with passenger details."

    def __init__(self):
        self.api_key = DUFFEL_API_KEY
        self.base_url = DUFFEL_BASE_URL
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Duffel-Version": "v2",
            "Accept-Encoding": "gzip",
            "User-Agent": "FlexeTravels/1.0",
            "Content-Type": "application/json",
        }

    def _run(
        self,
        offer_id: str,
        passenger_name: str,
        passenger_email: str,
        passenger_phone: str = "+441234567890",
        passenger_dob: str = "1990-01-01",
        passenger_title: str = "mr",
        amount: str = "0.00",
    ) -> str:
        """
        Create a booking (order/PNR) on Duffel API.

        Args:
            offer_id: ID of the flight offer (from search results)
            passenger_name: Full name (e.g., "John Doe")
            passenger_email: Email address
            passenger_phone: Phone number in E.164 format (e.g., "+441234567890")
            passenger_dob: Date of birth YYYY-MM-DD (for adults)
            passenger_title: Title (mr, ms, mrs, etc.)
            amount: Payment amount (0.00 for test mode)

        Returns:
            JSON string with booking confirmation, PNR, and order ID
        """

        if not HAS_DUFFEL:
            return json.dumps({
                "status": "error",
                "message": "Duffel API credentials not configured",
            })

        try:
            result = self._create_order(
                offer_id=offer_id,
                passenger_name=passenger_name,
                passenger_email=passenger_email,
                passenger_phone=passenger_phone,
                passenger_dob=passenger_dob,
                passenger_title=passenger_title,
                amount=amount,
            )
            return json.dumps(result)

        except Exception as e:
            logger.error(f"Duffel booking error: {e}", exc_info=True)
            return json.dumps({
                "status": "error",
                "message": f"Booking failed: {str(e)}",
            })

    def _create_order(
        self,
        offer_id: str,
        passenger_name: str,
        passenger_email: str,
        passenger_phone: str,
        passenger_dob: str,
        passenger_title: str,
        amount: str,
    ) -> dict:
        """Create an order (booking) on Duffel API."""
        try:
            # Parse passenger name
            name_parts = passenger_name.strip().split()
            first_name = name_parts[0] if name_parts else "Passenger"
            last_name = " ".join(name_parts[1:]) if len(name_parts) > 1 else "Traveler"

            # Use UUID for passenger ID (required by Duffel API)
            passenger_id = str(uuid.uuid4())

            # Build order payload (Duffel v2 API format)
            # Note: Removed "type": "instant" as it's not part of the v2 API spec
            order_payload = {
                "data": {
                    "selected_offers": [offer_id],  # Array of offer IDs to book
                    "passengers": [
                        {
                            "id": passenger_id,  # UUID for passenger reference
                            "type": "adult",
                            "title": passenger_title.lower(),
                            "given_name": first_name,
                            "family_name": last_name,
                            "gender": "M",  # M or F
                            "born_on": passenger_dob,
                            "email": passenger_email,
                            "phone_number": passenger_phone,
                        }
                    ],
                    "contact": {
                        "email": passenger_email,
                        "phone_number": passenger_phone,
                    },
                    "payments": [
                        {
                            "type": "balance",
                            "amount": amount,
                            "currency": "USD",
                        }
                    ],
                }
            }

            logger.info(f"Creating Duffel order for offer {offer_id}")

            # Create the order
            response = requests.post(
                f"{self.base_url}/air/orders",
                json=order_payload,
                headers=self.headers,
                timeout=15,
            )

            if response.status_code not in [200, 201]:
                error_text = response.text
                error_json = {}
                error_messages = []

                try:
                    error_json = response.json()
                    # Extract error messages from Duffel errors array
                    if "errors" in error_json and isinstance(error_json["errors"], list):
                        for err in error_json["errors"]:
                            if isinstance(err, dict):
                                # Get error type (usually the actual error code)
                                error_type = err.get("type", "")
                                # Get human-readable message
                                message = err.get("message", "")
                                title = err.get("title", "")

                                if error_type:
                                    error_messages.append(f"{error_type}: {message or title}")
                                elif message:
                                    error_messages.append(message)
                                elif title:
                                    error_messages.append(title)
                except Exception as e:
                    logger.error(f"Error parsing Duffel errors: {e}")

                logger.warning(
                    f"Duffel order creation failed: {response.status_code} - {error_text[:500]}"
                )

                # Use extracted messages or fall back to raw error
                if error_messages:
                    error_details = "\n".join(error_messages)
                elif error_json.get("errors"):
                    error_details = json.dumps(error_json.get("errors"), indent=2)
                else:
                    error_details = error_text

                return {
                    "status": "api_error",
                    "error_code": response.status_code,
                    "message": f"Duffel API error: {response.status_code}",
                    "details": error_details,
                }

            order_data = response.json().get("data", {})

            # Parse carrier references (PNR)
            carrier_references = order_data.get("carrier_references", [])
            pnr_codes = [ref.get("reference") for ref in carrier_references if ref.get("reference")]

            # Build response
            booking = {
                "status": "pending",
                "provider": "duffel",
                "order_id": order_data.get("id"),
                "pnr": pnr_codes[0] if pnr_codes else "N/A",
                "all_prns": pnr_codes,
                "passenger_name": passenger_name,
                "passenger_email": passenger_email,
                "live_mode": order_data.get("live_mode"),
                "type": order_data.get("type"),
                "passengers_count": order_data.get("passengers_count"),
                "slices_count": len(order_data.get("slices", [])),
                "total_amount": order_data.get("total_amount"),
                "total_currency": order_data.get("total_currency"),
                "created_at": order_data.get("created_at"),
                "confirmed_at": order_data.get("confirmed_at"),
                "message": "✅ Order created successfully in test mode. Status: PENDING.",
                "next_steps": [
                    "PNR is valid for 24 hours in test mode",
                    "Check Duffel dashboard at https://duffel.com/dashboard for full order details",
                    "In production, complete payment to confirm the booking",
                ],
            }

            logger.info(f"Order created: {booking.get('order_id')} - PNR: {booking.get('pnr')}")
            return booking

        except requests.exceptions.Timeout:
            return {
                "status": "timeout",
                "message": "Duffel API request timed out",
            }
        except Exception as e:
            logger.error(f"Duffel order creation error: {e}")
            return {
                "status": "error",
                "message": str(e),
            }


# Factory function
def get_duffel_booking_tool() -> DuffelBookingTool:
    """Get Duffel booking tool instance."""
    return DuffelBookingTool()
