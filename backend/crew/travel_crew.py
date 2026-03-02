"""
FlexeTravels — Claude AI Orchestrator
Manages the two-phase pipeline: Research -> Operations.
"""

import sys
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from agents.research_agent import create_research_agent
from agents.operations_agent import create_operations_agent

logger = logging.getLogger(__name__)


class TravelOrchestrator:
    """Orchestrates the Research and Operations agents."""

    def __init__(self):
        self.research_agent = None
        self.operations_agent = None
        self.current_plan = None

    def _ensure_research_agent(self):
        if self.research_agent is None:
            self.research_agent = create_research_agent()

    def _ensure_operations_agent(self):
        if self.operations_agent is None:
            self.operations_agent = create_operations_agent()

    def run_research(self, user_input: str) -> str:
        """Execute the research phase."""
        logger.info(f"Starting research for: {user_input[:100]}")
        self._ensure_research_agent()

        plan = self.research_agent.run(user_input)
        self.current_plan = plan
        return plan

    def run_operations(self, approved_plan: str = None) -> str:
        """Execute the operations phase."""
        plan_to_execute = approved_plan or self.current_plan
        if not plan_to_execute:
            return "No approved plan to execute. Please run research first."

        logger.info("Starting operations phase...")
        self._ensure_operations_agent()

        result = self.operations_agent.run(
            f"Execute this approved travel plan. Process payment, book flights/hotels, "
            f"send confirmation email, and schedule a social post.\n\n"
            f"APPROVED PLAN:\n{plan_to_execute}"
        )
        return result

    def reset(self):
        """Reset all agents and state."""
        if self.research_agent:
            self.research_agent.reset()
        if self.operations_agent:
            self.operations_agent.reset()
        self.current_plan = None
