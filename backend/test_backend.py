"""Quick test script for the FlexeTravels Claude AI backend."""

import os
import sys
from dotenv import load_dotenv

sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from crew.travel_crew import TravelOrchestrator

def main():
    load_dotenv()

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key or api_key == "your_anthropic_api_key_here":
        print("Error: ANTHROPIC_API_KEY is missing in .env")
        print("Get your key at: https://console.anthropic.com/")
        return

    print("Initializing Claude AI Agent System...")

    try:
        crew = TravelOrchestrator()
        print("Orchestrator initialized successfully.\n")

        user_input = "Plan a 3-day budget trip to Paris for 2 people in May"
        print(f"Running Research Phase for: '{user_input}'\n")

        research_result = crew.run_research(user_input)
        print("--- RESEARCH OUTPUT ---")
        print(research_result[:800] + "..." if len(research_result) > 800 else research_result)

        print("\nRunning Operations Phase...")
        operations_result = crew.run_operations(research_result)
        print("\n--- OPERATIONS OUTPUT ---")
        print(operations_result[:800] + "..." if len(operations_result) > 800 else operations_result)

        print("\nFull Pipeline Execution Completed!")

    except Exception as e:
        print(f"\nExecution Failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
