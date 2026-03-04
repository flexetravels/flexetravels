"""
FlexeTravels — FastAPI Backend Server
Production-ready REST API powering the AI travel agency.
Replaces Streamlit with a proper API server for the frontend.
"""

import json
import uuid
import logging
from datetime import datetime
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

import sys
sys.path.insert(0, str(Path(__file__).parent))

from config import (
    ANTHROPIC_API_KEY, CLAUDE_MODEL, CLAUDE_MAX_TOKENS, CLAUDE_TEMPERATURE,
    HAS_CLAUDE, HAS_AMADEUS, HAS_DUFFEL, ACTIVE_TRAVEL_API,
    ALLOWED_ORIGINS, API_HOST, API_PORT,
    get_status, validate_required_keys
)

# ── Logging ────────────────────────────────────────────────
from pathlib import Path
logs_dir = Path(__file__).parent / "logs"
logs_dir.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(logs_dir / "flexetravels.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("flexetravels")

# ── FastAPI App ────────────────────────────────────────────
app = FastAPI(
    title="FlexeTravels AI API",
    description="AI-powered travel planning and booking API powered by Claude",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory session store (use Redis in production) ──────
sessions: dict = {}

CHAT_SYSTEM_PROMPT = """You are FlexeBot, the AI travel assistant for FlexeTravels — a premium AI-powered travel agency.

You help users plan dream vacations using REAL, live pricing from our travel API system (Amadeus + Google Flights/Hotels fallback). NEVER invent prices or itineraries.

## CRITICAL RULES
- NEVER quote a price without calling a tool first.
- NEVER mention Google Flights, Kayak, or external booking websites to the user.
- NEVER invent flights, hotels, or prices. Only present what tools return.
- Tools automatically use the best available data source — present results confidently regardless of which source was used.

## REQUIRED INFO FOR SEARCH
You MUST collect these BEFORE calling tools:
1. **Origin city** — IATA airport code (e.g., YVR, JFK, LAX, CDG)
2. **Destination city** — IATA airport code (e.g., BKK, NRT, DXB, DPS)
3. **Departure & return dates** — YYYY-MM-DD format
4. **Number of adults** — for the trip
5. **Total budget** — (optional, helps filter results)

Common IATA codes: NYC (JFK/LGA/EWR), Paris (CDG), London (LHR), Tokyo (NRT/HND), Las Vegas (LAS), Bali (DPS), Bangkok (BKK), Dubai (DXB), Singapore (SIN), Sydney (SYD)

## CONVERSATION FLOW
1. Greet warmly, ask about their dream trip
2. Collect the 5 details above (ask clarifying questions if vague)
3. When you have all required info → call ALL 3 tools simultaneously:
   - amadeus_flights_search (origin, destination, departure_date, return_date, adults, max_price if budget given)
   - amadeus_hotels_search (city_code, check_in_date, check_out_date, adults, max_price_per_night if budget given)
   - amadeus_experiences_search (destination city name, max_price_per_person if budget given)
4. Present results with actual prices from the tool responses
5. If a tool returns 0 results or an error:
   - Still show results from tools that DID work (e.g. show flights even if hotels failed)
   - For hotels: suggest trying the same city with slightly different dates
   - For flights: suggest ±1-2 days flexibility or nearby airports
   - Offer to re-search with adjusted parameters
6. Suggest an itinerary based on the results you have

## PRESENTING RESULTS
**Flights:**
1. **[Airline Name]** — $[price per person]
   [Departure time] → [Arrival time] | [Duration] | [# stops]

**Hotels:**
1. **[Hotel Name]** — $[price per night] (Rating: [stars])
   Check-in: [date] → Check-out: [date]

**Activities & Experiences:**
1. **[Activity Name]** — $[price per person]
   [Description]

**Cost Summary:**
- Flights: $X × [adults] = $X
- Hotels: $X × [nights] nights = $X
- Experiences: $X × [adults] = $X
- **Total Trip: $X**

## IF TOOLS RETURN NO RESULTS
- Flights: "I couldn't find flights for those exact dates — would you like me to try [date ±2 days]?"
- Hotels: "Let me try a slightly different date range for hotels" then retry with check_in ±1 day
- Both fail: Apologize briefly, suggest adjusting dates or destination, offer to retry
- NEVER invent alternatives. Only search, then present what's returned.

TONE: Friendly, confident, helpful. Use markdown for formatting. Keep responses under 400 words unless showing search results."""


# ── Request/Response Models ────────────────────────────────

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    session_id: Optional[str] = None

class ChatResponse(BaseModel):
    response: str
    session_id: str
    phase: str = "chat"

class PlanTripRequest(BaseModel):
    description: str = Field(..., min_length=10, max_length=3000)
    session_id: Optional[str] = None

class PlanTripResponse(BaseModel):
    plan: str
    session_id: str
    phase: str = "research_complete"

class BookTripRequest(BaseModel):
    session_id: str
    approved: bool = True

class BookTripResponse(BaseModel):
    result: str
    session_id: str
    phase: str = "booking_complete"


# ── Amadeus Verification Models ──────────────────────────────

class AmadeusFlightSearch(BaseModel):
    origin: str = Field(..., min_length=3, max_length=3, description="IATA airport code, e.g. JFK")
    destination: str = Field(..., min_length=3, max_length=3, description="IATA airport code, e.g. NRT")
    departure_date: str = Field(..., description="YYYY-MM-DD")
    return_date: Optional[str] = Field(None, description="YYYY-MM-DD (optional for one-way)")
    adults: int = Field(1, ge=1, le=9)

class AmadeusHotelSearch(BaseModel):
    city_code: str = Field(..., min_length=3, max_length=3, description="IATA city code, e.g. LAS, PAR, LON")
    check_in_date: Optional[str] = Field(None, description="Check-in date YYYY-MM-DD (optional, defaults to today)")
    check_out_date: Optional[str] = Field(None, description="Check-out date YYYY-MM-DD (optional, defaults to 5 days from check-in)")
    adults: int = Field(1, ge=1, le=9, description="Number of adults")
    rooms: int = Field(1, ge=1, le=5, description="Number of rooms")

class AmadeusItineraryRequest(BaseModel):
    origin: str = Field(..., min_length=3, max_length=3)
    destination: str = Field(..., min_length=3, max_length=3)
    departure_date: str
    return_date: Optional[str] = None
    adults: int = Field(1, ge=1, le=9)
    check_in_date: Optional[str] = None
    check_out_date: Optional[str] = None


class DuffelBookingRequest(BaseModel):
    offer_id: str = Field(..., description="Flight offer ID from search results")
    passenger_title: str = Field(default="mr", description="Title (mr, mrs, ms, miss, dr, etc.)")
    passenger_name: str = Field(..., description="Full passenger name (e.g., John Doe)")
    passenger_email: str = Field(..., description="Passenger email address")
    passenger_phone: str = Field(default="+1555123456", description="Phone number with country code")
    passenger_dob: str = Field(default="1990-01-01", description="Date of birth YYYY-MM-DD")


# ── Session Management ─────────────────────────────────────

def get_or_create_session(session_id: Optional[str] = None) -> dict:
    """Get existing session or create new one."""
    if session_id and session_id in sessions:
        return sessions[session_id]

    new_id = str(uuid.uuid4())[:8]
    sessions[new_id] = {
        "id": new_id,
        "messages": [],
        "phase": "chat",
        "orchestrator": None,
        "created_at": datetime.now().isoformat(),
    }
    # Clean old sessions (keep last 100)
    if len(sessions) > 100:
        oldest_keys = sorted(sessions.keys(), key=lambda k: sessions[k]["created_at"])[:20]
        for k in oldest_keys:
            del sessions[k]

    return sessions[new_id]


def _get_chat_tools():
    """Build Claude tool schemas based on ACTIVE_TRAVEL_API setting."""
    tools = []

    # Add tools for the active API provider
    if ACTIVE_TRAVEL_API == "duffel" and HAS_DUFFEL:
        # Duffel tools (global coverage, better hotels)
        tools.append({
            "name": "duffel_flights_search",
            "description": (
                "Search real-time flight offers via Duffel API with global airline coverage. "
                "No mock data. Returns structured JSON with available flights and pricing. "
                "Searches both outbound and return flights if return_date provided."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "origin": {
                        "type": "string",
                        "description": "IATA airport code for departure (e.g., YVR, JFK, LAX, CDG). Required."
                    },
                    "destination": {
                        "type": "string",
                        "description": "IATA airport code for arrival (e.g., LAS, NRT, FCO, DXB). Required."
                    },
                    "departure_date": {
                        "type": "string",
                        "description": "Departure date in YYYY-MM-DD format. Required."
                    },
                    "return_date": {
                        "type": "string",
                        "description": "Return date in YYYY-MM-DD format for round-trip. Optional for one-way."
                    },
                    "adults": {
                        "type": "integer",
                        "description": "Number of adult passengers (1-9). Default: 1."
                    },
                    "max_price": {
                        "type": "integer",
                        "description": "Maximum total price in USD (for all passengers). 0 = no limit. Optional."
                    },
                    "non_stop": {
                        "type": "boolean",
                        "description": "True for direct flights only. Default: false."
                    },
                    "travel_class": {
                        "type": "string",
                        "enum": ["economy", "premium_economy", "business", "first"],
                        "description": "Cabin class. Default: economy."
                    }
                },
                "required": ["origin", "destination", "departure_date"]
            }
        })
        tools.append({
            "name": "amadeus_hotels_search",
            "description": (
                "Search hotel availability and live pricing with global coverage. "
                "Returns real prices per night and total stay cost. Works for any city worldwide with automatic SerpAPI fallback for unsupported cities."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "city_code": {
                        "type": "string",
                        "description": "City name or IATA city code (e.g., NYC, LAX, PAR, LON, TYO, Bangkok). Required."
                    },
                    "check_in_date": {
                        "type": "string",
                        "description": "Check-in date in YYYY-MM-DD format. Required."
                    },
                    "check_out_date": {
                        "type": "string",
                        "description": "Check-out date in YYYY-MM-DD format. Required."
                    },
                    "adults": {
                        "type": "integer",
                        "description": "Number of adults. Default: 1."
                    },
                    "rooms": {
                        "type": "integer",
                        "description": "Number of rooms needed. Default: 1."
                    },
                    "max_price_per_night": {
                        "type": "integer",
                        "description": "Maximum price per night in USD. 0 = no limit. Optional."
                    }
                },
                "required": ["city_code", "check_in_date", "check_out_date"]
            }
        })

        tools.append({
            "name": "amadeus_experiences_search",
            "description": (
                "Search Amadeus tours and activities at a destination. "
                "Returns activities with pricing, ratings, duration, and booking links."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "city_name": {
                        "type": "string",
                        "description": "City name (e.g., 'Las Vegas', 'Paris', 'Tokyo', 'London'). Required."
                    },
                    "max_price_per_person": {
                        "type": "number",
                        "description": "Maximum price per person in USD. 0 = no limit. Optional."
                    },
                    "radius_km": {
                        "type": "integer",
                        "description": "Search radius in kilometers (1-50). Default: 20."
                    }
                },
                "required": ["city_name"]
            }
        })
    else:
        # Default: Amadeus tools
        tools = [
            {
                "name": "amadeus_flights_search",
                "description": (
                    "Search real-time Amadeus flight offers. No mock data. Returns structured JSON with available flights and pricing. "
                    "Searches both outbound and return flights if return_date provided."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "origin": {
                            "type": "string",
                            "description": "IATA airport code for departure (e.g., YVR, JFK, LAX, CDG). Required."
                        },
                        "destination": {
                            "type": "string",
                            "description": "IATA airport code for arrival (e.g., LAS, NRT, FCO, DXB). Required."
                        },
                        "departure_date": {
                            "type": "string",
                            "description": "Departure date in YYYY-MM-DD format. Required."
                        },
                        "return_date": {
                            "type": "string",
                            "description": "Return date in YYYY-MM-DD format for round-trip. Optional for one-way."
                        },
                        "adults": {
                            "type": "integer",
                            "description": "Number of adult passengers (1-9). Default: 1."
                        },
                        "max_price": {
                            "type": "integer",
                            "description": "Maximum total price in USD (for all passengers). 0 = no limit. Optional."
                        },
                        "non_stop": {
                            "type": "boolean",
                            "description": "True for direct flights only. Default: false."
                        },
                        "travel_class": {
                            "type": "string",
                            "enum": ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"],
                            "description": "Cabin class. Default: ECONOMY."
                        }
                    },
                    "required": ["origin", "destination", "departure_date"]
                }
            },
            {
                "name": "amadeus_hotels_search",
                "description": (
                    "Search Amadeus hotel availability and live pricing (2-step: hotel IDs from city, then pricing). "
                    "Returns real prices per night and total stay cost. Filters by star rating if specified."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "city_code": {
                            "type": "string",
                            "description": "IATA city code (3 letters, e.g., LAS for Las Vegas, PAR for Paris, LON for London). Required."
                        },
                        "check_in_date": {
                            "type": "string",
                            "description": "Check-in date in YYYY-MM-DD format. Required."
                        },
                        "check_out_date": {
                            "type": "string",
                            "description": "Check-out date in YYYY-MM-DD format. Required."
                        },
                        "adults": {
                            "type": "integer",
                            "description": "Number of adults per room. Default: 1."
                        },
                        "rooms": {
                            "type": "integer",
                            "description": "Number of rooms needed. Default: 1."
                        },
                        "max_price_per_night": {
                            "type": "integer",
                            "description": "Maximum price per night in USD. 0 = no limit. Optional."
                        },
                        "min_star_rating": {
                            "type": "integer",
                            "description": "Minimum star rating (0-5). 0 = no filter. Optional."
                        }
                    },
                    "required": ["city_code", "check_in_date", "check_out_date"]
                }
            },
            {
                "name": "amadeus_experiences_search",
                "description": (
                    "Search Amadeus tours and activities at a destination (2-step: get city coordinates, then fetch activities). "
                    "Returns activities with pricing, ratings, duration, and booking links."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "city_name": {
                            "type": "string",
                            "description": "City name (e.g., 'Las Vegas', 'Paris', 'Tokyo', 'London'). Required."
                        },
                        "max_price_per_person": {
                            "type": "number",
                            "description": "Maximum price per person in USD. 0 = no limit. Optional."
                        },
                        "radius_km": {
                            "type": "integer",
                            "description": "Search radius in kilometers (1-50). Default: 20."
                        }
                    },
                    "required": ["city_name"]
                }
            }
        ]

    return tools


def _execute_chat_tool(tool_name: str, tool_input: dict, session_id: str = "") -> str:
    """Execute a tool call from the chat agent. Routes to Amadeus or Duffel tools based on config."""
    try:
        # Handle Duffel tools
        if tool_name == "duffel_flights_search":
            from tools.duffel_flights import DuffelFlightsTool
            tool = DuffelFlightsTool()
            return tool._run(
                origin=tool_input.get("origin", "").upper(),
                destination=tool_input.get("destination", "").upper(),
                departure_date=tool_input.get("departure_date", ""),
                adults=tool_input.get("adults", 1),
                return_date=tool_input.get("return_date", ""),
                max_price=tool_input.get("max_price", 0),
                non_stop=tool_input.get("non_stop", False),
                travel_class=tool_input.get("travel_class", "economy").lower(),
            )


        # Handle Amadeus tools
        elif tool_name == "amadeus_flights_search":
            from tools.amadeus_flights import AmadeusFlightsTool
            tool = AmadeusFlightsTool()
            return tool._run(
                origin=tool_input.get("origin", "").upper(),
                destination=tool_input.get("destination", "").upper(),
                departure_date=tool_input.get("departure_date", ""),
                adults=tool_input.get("adults", 1),
                return_date=tool_input.get("return_date", ""),
                max_price=tool_input.get("max_price", 0),
                non_stop=tool_input.get("non_stop", False),
                travel_class=tool_input.get("travel_class", "ECONOMY"),
            )

        elif tool_name == "amadeus_hotels_search":
            from tools.amadeus_hotels import AmadeusHotelsTool
            tool = AmadeusHotelsTool()
            return tool._run(
                city_code=tool_input.get("city_code", "").upper(),
                check_in_date=tool_input.get("check_in_date", ""),
                check_out_date=tool_input.get("check_out_date", ""),
                adults=tool_input.get("adults", 1),
                rooms=tool_input.get("rooms", 1),
                max_price_per_night=tool_input.get("max_price_per_night", 0),
                min_star_rating=tool_input.get("min_star_rating", 0),
            )

        elif tool_name == "amadeus_experiences_search":
            from tools.amadeus_experiences import AmadeusExperiencesTool
            tool = AmadeusExperiencesTool()
            return tool._run(
                city_name=tool_input.get("city_name", ""),
                max_price_per_person=tool_input.get("max_price_per_person", 0),
                radius_km=tool_input.get("radius_km", 20),
            )

        else:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})

    except Exception as e:
        logger.error(f"Tool {tool_name} error: {e}")
        return json.dumps({"error": str(e)})


def get_chat_response(session: dict, user_message: str) -> str:
    """Get a response from Claude with Amadeus tool access for live searches."""
    if not HAS_CLAUDE:
        return _fallback_response(user_message)

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

        # Build conversation messages (keep last 16 for context)
        messages = []
        for msg in session["messages"][-16:]:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": user_message})

        tools = _get_chat_tools()
        max_tool_rounds = 6  # Allow up to 6 tool calls per user message

        # Inject current date so Claude uses the right year for date parsing
        today = datetime.now().strftime("%Y-%m-%d")
        system_with_date = f"Today's date is {today}. When users mention months without specifying a year, always use {datetime.now().year} (or {datetime.now().year + 1} if the date has already passed this year).\n\n{CHAT_SYSTEM_PROMPT}"

        for _ in range(max_tool_rounds):
            response = client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=CLAUDE_MAX_TOKENS,
                temperature=CLAUDE_TEMPERATURE,
                system=system_with_date,
                tools=tools,
                messages=messages,
            )

            # If Claude wants to use tools, execute them and continue the loop
            if response.stop_reason == "tool_use":
                # Add assistant's response (contains tool_use blocks)
                messages.append({"role": "assistant", "content": response.content})

                # Execute each tool call and collect results
                tool_results = []
                for block in response.content:
                    if block.type == "tool_use":
                        logger.info(f"Chat tool call: {block.name}({json.dumps(block.input)[:200]})")
                        result = _execute_chat_tool(block.name, block.input, session["id"])
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result,
                        })

                # Feed tool results back to Claude
                messages.append({"role": "user", "content": tool_results})
                continue

            # Claude is done — extract the text response
            text_parts = []
            for block in response.content:
                if hasattr(block, "text"):
                    text_parts.append(block.text)

            return "\n".join(text_parts) if text_parts else "I'd love to help you plan a trip! Where are you dreaming of going?"

        # Exhausted tool rounds
        return "I've finished searching. Let me know if you'd like to refine the results!"

    except Exception as e:
        logger.error(f"Claude API error: {e}")
        return f"I'm experiencing a temporary issue. {_fallback_response(user_message)}"


def _fallback_response(user_input: str) -> str:
    """Fallback responses when Claude API is unavailable."""
    lower = user_input.lower()

    if any(w in lower for w in ["hi", "hello", "hey", "start"]):
        return ("Welcome to **FlexeTravels**! I'm FlexeBot, your AI travel planner.\n\n"
                "Tell me about your dream trip! For example:\n"
                "- *'Plan a 7-day trip to Tokyo for 2 people, budget $2000'*\n"
                "- *'I want a luxury beach vacation in Bali'*\n\n"
                "What destination are you dreaming about?")

    if any(w in lower for w in ["japan", "tokyo", "kyoto"]):
        return ("Japan is incredible! Our **Discover Japan** tour covers Tokyo, Kyoto, Osaka, "
                "and Hiroshima over 14 days for **$3,850/person**. Cherry blossom season (March-April) "
                "is magical!\n\nWant me to create a custom package for you?")

    if any(w in lower for w in ["italy", "rome", "venice"]):
        return ("Italy is a traveler's dream! **Highlights of Italy** - 10 days through Rome, Florence, "
                "Venice, and the Amalfi Coast. Currently **$2,490** (was $3,200) - 22% off!\n\n"
                "Shall I customize this for your dates?")

    if any(w in lower for w in ["bali", "indonesia"]):
        return ("Bali is paradise! **Bali & Beyond** - 8 days covering Ubud, Seminyak, Nusa Penida, "
                "and the Gili Islands for just **$1,690** (was $2,100) - 20% off!\n\n"
                "Want details or a custom itinerary?")

    if any(w in lower for w in ["deal", "cheap", "budget", "price"]):
        return ("Here are today's best AI-curated deals:\n\n"
                "- **Bali & Beyond** — $1,690 (was $2,100) — 20% off!\n"
                "- **Highlights of Italy** — $2,490 (was $3,200) — 22% off!\n"
                "- **Mexico Explorer** — $1,890 — New trip special!\n\n"
                "Want me to find something specific for your budget?")

    return ("I'd love to help you plan an amazing trip! Tell me:\n\n"
            "1. Where do you want to go?\n"
            "2. How many days?\n"
            "3. What's your budget?\n\n"
            "I'll find the best deals and create a personalized itinerary!")


# ── API Endpoints ──────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    """Health check endpoint with service status."""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        **get_status(),
    }


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Main chat endpoint - conversational AI travel assistant."""
    session = get_or_create_session(request.session_id)

    # Get AI response
    ai_response = get_chat_response(session, request.message)

    # Store in session
    session["messages"].append({"role": "user", "content": request.message})
    session["messages"].append({"role": "assistant", "content": ai_response})

    return ChatResponse(
        response=ai_response,
        session_id=session["id"],
        phase=session["phase"],
    )


@app.post("/api/plan-trip", response_model=PlanTripResponse)
async def plan_trip(request: PlanTripRequest):
    """Full AI trip planning - activates the Research Agent with tool use."""
    if not HAS_CLAUDE:
        raise HTTPException(status_code=503, detail="AI service unavailable - ANTHROPIC_API_KEY not configured")

    session = get_or_create_session(request.session_id)
    session["phase"] = "researching"

    try:
        from crew.travel_crew import TravelOrchestrator

        if session["orchestrator"] is None:
            session["orchestrator"] = TravelOrchestrator()

        plan = session["orchestrator"].run_research(request.description)
        session["phase"] = "research_complete"

        session["messages"].append({"role": "user", "content": f"[PLAN REQUEST] {request.description}"})
        session["messages"].append({"role": "assistant", "content": plan})

        return PlanTripResponse(
            plan=plan,
            session_id=session["id"],
            phase="research_complete",
        )

    except Exception as e:
        logger.error(f"Planning error: {e}")
        session["phase"] = "error"
        raise HTTPException(status_code=500, detail=f"Planning failed: {str(e)}")


@app.post("/api/book-trip", response_model=BookTripResponse)
async def book_trip(request: BookTripRequest):
    """Execute booking for an approved plan."""
    if not HAS_CLAUDE:
        raise HTTPException(status_code=503, detail="AI service unavailable")

    session = sessions.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.get("orchestrator") or not session["orchestrator"].current_plan:
        raise HTTPException(status_code=400, detail="No plan to book. Run /api/plan-trip first.")

    session["phase"] = "booking"

    try:
        result = session["orchestrator"].run_operations()
        session["phase"] = "complete"

        session["messages"].append({"role": "assistant", "content": result})

        return BookTripResponse(
            result=result,
            session_id=session["id"],
            phase="booking_complete",
        )

    except Exception as e:
        logger.error(f"Booking error: {e}")
        session["phase"] = "error"
        raise HTTPException(status_code=500, detail=f"Booking failed: {str(e)}")


@app.post("/api/reset")
async def reset_session(session_id: str = None):
    """Reset a session."""
    if session_id and session_id in sessions:
        orch = sessions[session_id].get("orchestrator")
        if orch:
            orch.reset()
        del sessions[session_id]
    return {"status": "reset", "session_id": session_id}


@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    """Get session info."""
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "id": session["id"],
        "phase": session["phase"],
        "message_count": len(session["messages"]),
        "created_at": session["created_at"],
    }


# ── Amadeus Verification & Direct Search Endpoints ────────

@app.get("/api/amadeus/status")
async def amadeus_status():
    """Check Amadeus API connection status and test authentication."""
    from config import HAS_AMADEUS, AMADEUS_API_KEY, AMADEUS_API_SECRET

    status = {
        "configured": HAS_AMADEUS,
        "api_key_set": bool(AMADEUS_API_KEY),
        "api_secret_set": bool(AMADEUS_API_SECRET),
    }

    if HAS_AMADEUS:
        try:
            from amadeus import Client
            amadeus = Client(
                client_id=AMADEUS_API_KEY,
                client_secret=AMADEUS_API_SECRET,
            )
            # Test auth by fetching a known airport
            test = amadeus.reference_data.locations.get(
                keyword="JFK",
                subType="AIRPORT",
            )
            status["connection"] = "live"
            status["auth"] = "success"
            status["test_result"] = f"Found {len(test.data)} locations for JFK"

            # Detect sandbox vs production from the base URL
            base_url = getattr(amadeus, '_base_url', '') or str(getattr(amadeus, 'host', ''))
            if 'test' in str(base_url).lower() or 'api.amadeus.com' not in str(getattr(amadeus, 'host', 'test')):
                status["environment"] = "test"
                status["environment_note"] = "Amadeus Test Sandbox — returns sample data, not real market prices"
            else:
                status["environment"] = "production"
                status["environment_note"] = "Amadeus Production — returns live market prices"
        except Exception as e:
            status["connection"] = "failed"
            status["auth"] = "error"
            status["error"] = str(e)
    else:
        status["connection"] = "not_configured"

    return status


@app.post("/api/amadeus/flights")
async def search_flights_direct(request: AmadeusFlightSearch):
    """Direct Amadeus flight search — uses new tool with real pricing."""
    from tools.amadeus_flights import AmadeusFlightsTool

    tool = AmadeusFlightsTool()
    raw_result = tool._run(
        origin=request.origin.upper(),
        destination=request.destination.upper(),
        departure_date=request.departure_date,
        return_date=request.return_date or "",
        adults=request.adults,
    )

    import json as _json
    parsed = _json.loads(raw_result)

    # Determine source — pass through from tool result (supports Amadeus + SerpAPI fallback)
    source = parsed.get("source", "amadeus_live_api") if parsed.get("status") == "success" else "api_error"

    return {
        "source": source,
        "query": {
            "origin": request.origin.upper(),
            "destination": request.destination.upper(),
            "departure_date": request.departure_date,
            "return_date": request.return_date,
            "adults": request.adults,
        },
        "data": parsed,
    }


@app.post("/api/duffel/flights")
async def search_duffel_flights(request: AmadeusFlightSearch):
    """Direct Duffel flight search — global coverage, real pricing."""
    from tools.duffel_flights import DuffelFlightsTool
    import json as _json

    tool = DuffelFlightsTool()
    raw_result = tool._run(
        origin=request.origin.upper(),
        destination=request.destination.upper(),
        departure_date=request.departure_date,
        return_date=request.return_date or "",
        adults=request.adults,
    )

    parsed = _json.loads(raw_result)
    source = "duffel_live_api" if parsed.get("status") == "success" else "api_error"

    return {
        "source": source,
        "query": {
            "origin": request.origin.upper(),
            "destination": request.destination.upper(),
            "departure_date": request.departure_date,
            "return_date": request.return_date,
            "adults": request.adults,
        },
        "data": parsed,
    }

@app.post("/api/amadeus/hotels")
async def search_hotels_direct(request: AmadeusHotelSearch):
    """Direct Amadeus hotel search — uses new tool with real pricing."""
    from tools.amadeus_hotels import AmadeusHotelsTool
    from datetime import datetime, timedelta

    # Default to 5-night stay if dates not specified
    check_in = request.check_in_date if hasattr(request, 'check_in_date') and request.check_in_date else datetime.now().strftime("%Y-%m-%d")
    check_out = request.check_out_date if hasattr(request, 'check_out_date') and request.check_out_date else (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d")

    tool = AmadeusHotelsTool()
    raw_result = tool._run(
        city_code=request.city_code.upper(),
        check_in_date=check_in,
        check_out_date=check_out,
    )

    import json as _json
    parsed = _json.loads(raw_result)

    # Pass through source from tool result (supports Amadeus + SerpAPI fallback)
    source = parsed.get("source", "amadeus_live_api") if parsed.get("status") == "success" else "api_error"

    return {
        "source": source,
        "query": {"city_code": request.city_code.upper(), "check_in": check_in, "check_out": check_out},
        "data": parsed,
    }


@app.post("/api/amadeus/itinerary")
async def build_itinerary(request: AmadeusItineraryRequest):
    """Full itinerary search — flights + hotels + cost breakdown from Amadeus."""
    from tools.amadeus_flights import AmadeusFlightsTool
    from tools.amadeus_hotels import AmadeusHotelsTool
    import json as _json
    from datetime import datetime as dt, timedelta

    flights_tool = AmadeusFlightsTool()
    hotels_tool = AmadeusHotelsTool()

    # Search flights
    flights_raw = flights_tool._run(
        origin=request.origin.upper(),
        destination=request.destination.upper(),
        departure_date=request.departure_date,
        return_date=request.return_date or "",
        adults=request.adults,
    )
    flights_data = _json.loads(flights_raw)

    # Determine hotel check-in/check-out dates
    if request.check_in_date and request.check_out_date:
        check_in = request.check_in_date
        check_out = request.check_out_date
    elif request.departure_date and request.return_date:
        check_in = request.departure_date
        check_out = request.return_date
    else:
        check_in = dt.now().strftime("%Y-%m-%d")
        check_out = (dt.now() + timedelta(days=5)).strftime("%Y-%m-%d")

    # Search hotels
    hotels_raw = hotels_tool._run(
        city_code=request.destination.upper()[:3],
        check_in_date=check_in,
        check_out_date=check_out,
        adults=request.adults,
    )
    hotels_data = _json.loads(hotels_raw)

    # Determine data source (new tools return "success" status for live API)
    flights_list = flights_data.get("flights", [])
    hotels_list = hotels_data.get("hotels", [])

    flights_source = "amadeus_live_api" if flights_data.get("status") == "success" else "api_error"
    hotels_source = "amadeus_live_api" if hotels_data.get("status") == "success" else "api_error"

    # Calculate costs (new tools use price_total for flights, price_per_night for hotels)
    cheapest_flight = min(flights_list, key=lambda f: f.get("price_total", f.get("price", 99999))) if flights_list else None
    cheapest_hotel = min(hotels_list, key=lambda h: h.get("price_per_night", 99999)) if hotels_list else None

    # Calculate nights
    nights = 1
    try:
        d1 = dt.strptime(check_in, "%Y-%m-%d")
        d2 = dt.strptime(check_out, "%Y-%m-%d")
        nights = max((d2 - d1).days, 1)
    except ValueError:
        nights = 1

    cost_breakdown = {}
    if cheapest_flight:
        # New tools use price_total, old tools used price
        price_total = cheapest_flight.get("price_total", cheapest_flight.get("price", 0))
        cost_breakdown["flight_total"] = price_total
        cost_breakdown["flight_per_person"] = round(price_total / max(request.adults, 1), 2)
        cost_breakdown["flight_airline"] = cheapest_flight.get("airline", "")
    if cheapest_hotel:
        ppn = cheapest_hotel.get("price_per_night", 0)
        cost_breakdown["hotel_per_night"] = ppn
        cost_breakdown["hotel_total"] = round(ppn * nights, 2)
        cost_breakdown["hotel_name"] = cheapest_hotel.get("name", "")
        cost_breakdown["nights"] = nights

    grand_total = cost_breakdown.get("flight_total", 0) + cost_breakdown.get("hotel_total", 0)
    cost_breakdown["grand_total"] = round(grand_total, 2)
    cost_breakdown["currency"] = "USD"

    return {
        "query": {
            "origin": request.origin.upper(),
            "destination": request.destination.upper(),
            "departure_date": request.departure_date,
            "return_date": request.return_date,
            "adults": request.adults,
            "nights": nights,
        },
        "sources": {
            "flights": flights_source,
            "hotels": hotels_source,
        },
        "flights": flights_list,
        "hotels": hotels_list,
        "cost_breakdown": cost_breakdown,
    }


@app.post("/api/amadeus/clear-cache")
async def clear_amadeus_cache():
    """Clear the Amadeus response cache to force fresh API calls."""
    from utils.cache import clear_cache
    count = clear_cache()
    return {"status": "cleared", "files_removed": count}

@app.post("/api/duffel/booking")
async def create_duffel_booking(request: DuffelBookingRequest):
    """Create a flight booking (order/PNR) on Duffel API — Test Mode."""
    from tools.duffel_booking import DuffelBookingTool

    tool = DuffelBookingTool()
    raw_result = tool._run(
        offer_id=request.offer_id,
        passenger_name=request.passenger_name,
        passenger_email=request.passenger_email,
        passenger_phone=request.passenger_phone,
        passenger_dob=request.passenger_dob,
        passenger_title=request.passenger_title,
    )

    import json as _json
    result = _json.loads(raw_result)

    # If booking failed, return error response with proper HTTP status
    if result.get("status") != "pending":
        error_code = result.get("error_code", 400)
        return JSONResponse(
            status_code=error_code,
            content={
                "status": result.get("status", "error"),
                "booking": result,
                "message": result.get("message", ""),
                "details": result.get("details", ""),
            }
        )

    return {
        "status": "success",
        "booking": result,
        "message": result.get("message", ""),
    }



# ── Dynamic Featured Tours ──────────────────────────────────

@app.get("/api/featured-tours")
async def get_featured_tours(request: Request, count: int = 6, test_city: str = None):
    """
    Return personalised tour packages based on visitor's IP location.
    Uses Amadeus Travel Analytics + Claude AI + Unsplash images.

    Query parameters:
    - count: Number of tours (default 6)
    - test_city: Override IP detection for testing (e.g., ?test_city=London)
    """
    from tools.ip_geolocation import get_location_from_ip
    from tools.trending_destinations import get_trending_tours
    from marketing.tour_analytics import record_tour_impression

    # Resolve client IP (handles proxies / load balancers)
    forwarded = request.headers.get("X-Forwarded-For", "")
    ip = forwarded.split(",")[0].strip() if forwarded else request.client.host

    # For testing: allow override with test_city parameter
    if test_city:
        from tools.ip_geolocation import _resolve_iata
        # Map test city to location
        iata = _resolve_iata(test_city, "US")
        location = {
            "city": test_city,
            "country": "Various",
            "country_code": "XX",
            "iata_code": iata,
            "lat": 0,
            "lon": 0,
        }
        logger.info(f"Featured tours (TEST MODE: {test_city}) → IATA: {iata}")
    else:
        location = get_location_from_ip(ip)
        logger.info(f"Featured tours request from IP {ip} → {location.get('city')}, {location.get('iata_code')}")

    tours = get_trending_tours(
        origin_iata=location.get("iata_code", "JFK"),
        user_city=location.get("city", ""),
        count=count,
    )

    # Record impressions for analytics / weekly marketing selection
    for t in tours:
        record_tour_impression(
            destination=t.get("destination", ""),
            origin_city=location.get("city", ""),
        )

    return {"location": location, "tours": tours, "count": len(tours)}


@app.get("/api/travel-styles")
async def get_travel_styles(request: Request):
    """
    Return 6 travel style cards with destination suggestions relevant to user's location.
    Uses IP geolocation to determine region, then maps to curated destinations per style.
    """
    from tools.ip_geolocation import get_location_from_ip
    from tools.travel_styles import get_travel_style_suggestions

    forwarded = request.headers.get("X-Forwarded-For", "")
    ip = forwarded.split(",")[0].strip() if forwarded else request.client.host

    location = get_location_from_ip(ip)
    logger.info(f"Travel styles request from {location.get('city')}, {location.get('country_code')}")

    styles = get_travel_style_suggestions(
        city=location.get("city", ""),
        country_code=location.get("country_code", "US"),
    )

    return {"location": location, "styles": styles}


@app.post("/api/marketing/run-weekly")
async def run_weekly_marketing(destination: str = None):
    """
    Trigger the weekly marketing workflow.
    Auto-picks the most-featured destination from the last 7 days of analytics,
    generates content with Claude, and emails it to the marketing team.
    """
    from marketing.workflow import FlexeTravelsMarketingWorkflow
    from marketing.tour_analytics import get_top_destination, get_analytics_summary

    if not destination:
        destination = get_top_destination(days=7)

    logger.info(f"Running weekly marketing workflow for: {destination}")
    workflow = FlexeTravelsMarketingWorkflow()
    result = workflow.run(destination=destination)

    # Include analytics summary in response
    result["analytics"] = get_analytics_summary(days=7)
    return result


@app.get("/api/marketing/analytics")
async def get_marketing_analytics(days: int = 7):
    """Return tour impression analytics for the last N days."""
    from marketing.tour_analytics import get_analytics_summary
    return get_analytics_summary(days=days)


# ── Run Server ─────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    warnings = validate_required_keys()
    if warnings:
        for w in warnings:
            logger.warning(w)

    logger.info(f"Starting FlexeTravels API on {API_HOST}:{API_PORT}")
    logger.info(f"AI Engine: {'Claude (' + CLAUDE_MODEL + ')' if HAS_CLAUDE else 'Fallback mode'}")

    uvicorn.run(
        "main:app",
        host=API_HOST,
        port=API_PORT,
        reload=True,
        log_level="info",
    )
