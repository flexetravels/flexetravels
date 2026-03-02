"""
FlexeTravels — Claude AI Agent Wrapper
Uses Anthropic's Claude API with tool use for agentic travel planning.
Token-efficient: compact prompts, result truncation, conversation summarization.
"""

import json
import logging
import inspect
from typing import Any

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from config import (
    ANTHROPIC_API_KEY, CLAUDE_MODEL, CLAUDE_MAX_TOKENS,
    CLAUDE_TEMPERATURE, MAX_AGENT_ITERATIONS, MAX_TOOL_RESULT_TOKENS
)

logger = logging.getLogger(__name__)


def _truncate(text: str, max_chars: int = 3000) -> str:
    """Truncate text to save tokens while preserving useful content."""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + f"\n... [truncated, {len(text) - max_chars} chars omitted]"


def _build_tool_schema(tool) -> dict:
    """Convert a tool object into Claude's tool schema format."""
    name = tool.name.replace(" ", "_").replace("-", "_")
    desc = tool.description

    sig = inspect.signature(tool._run)
    properties = {}
    required = []

    for param_name, param in sig.parameters.items():
        if param_name == "self":
            continue

        param_type = "string"
        annotation = param.annotation
        if annotation == float:
            param_type = "number"
        elif annotation == int:
            param_type = "integer"
        elif annotation == bool:
            param_type = "boolean"
        elif annotation == list:
            param_type = "array"

        prop = {"type": param_type}
        if param_type == "array":
            prop["items"] = {"type": "string"}

        properties[param_name] = prop

        if param.default is inspect.Parameter.empty:
            required.append(param_name)

    return {
        "name": name,
        "description": desc,
        "input_schema": {
            "type": "object",
            "properties": properties,
            "required": required,
        }
    }


class ClaudeAgent:
    """Agentic wrapper around Claude API with tool use support."""

    def __init__(self, system_instruction: str, tools: list = None):
        if not ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY not found in environment variables")

        import anthropic
        self.client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        self.system_instruction = system_instruction
        self.tools = tools or []
        self.tool_map = {}
        self.tool_schemas = []
        self.conversation_history = []

        for tool in self.tools:
            schema = _build_tool_schema(tool)
            self.tool_schemas.append(schema)
            self.tool_map[schema["name"]] = tool

    def _execute_tool(self, tool_name: str, tool_input: dict) -> str:
        """Execute a tool and return truncated result."""
        tool = self.tool_map.get(tool_name)
        if not tool:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})

        try:
            result = tool._run(**tool_input)
            return _truncate(result, MAX_TOOL_RESULT_TOKENS)
        except Exception as e:
            logger.error(f"Tool {tool_name} error: {e}")
            return json.dumps({"error": str(e)})

    def run(self, user_input: str) -> str:
        """Send a message and handle the full agentic tool-use loop."""
        self.conversation_history.append({
            "role": "user",
            "content": user_input
        })

        for iteration in range(MAX_AGENT_ITERATIONS):
            try:
                response = self.client.messages.create(
                    model=CLAUDE_MODEL,
                    max_tokens=CLAUDE_MAX_TOKENS,
                    temperature=CLAUDE_TEMPERATURE,
                    system=self.system_instruction,
                    tools=self.tool_schemas if self.tool_schemas else [],
                    messages=self.conversation_history,
                )
            except Exception as e:
                logger.error(f"Claude API error: {e}")
                return f"I encountered an issue connecting to the AI service: {str(e)}"

            if response.stop_reason == "tool_use":
                self.conversation_history.append({
                    "role": "assistant",
                    "content": response.content
                })

                tool_results = []
                for block in response.content:
                    if block.type == "tool_use":
                        logger.info(f"Tool call: {block.name}({json.dumps(block.input)[:200]})")
                        result = self._execute_tool(block.name, block.input)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": result,
                        })

                self.conversation_history.append({
                    "role": "user",
                    "content": tool_results
                })
                continue

            # Claude is done - extract text response
            text_parts = []
            for block in response.content:
                if hasattr(block, "text"):
                    text_parts.append(block.text)

            final_response = "\n".join(text_parts) if text_parts else "I've completed the analysis."

            self.conversation_history.append({
                "role": "assistant",
                "content": final_response
            })

            return final_response

        return "I've reached my processing limit. Here's what I have so far - please try a more specific request."

    def chat(self, user_input: str) -> str:
        """Simple chat without tool use - for quick responses."""
        messages = self.conversation_history + [{"role": "user", "content": user_input}]

        try:
            response = self.client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=CLAUDE_MAX_TOKENS,
                temperature=CLAUDE_TEMPERATURE,
                system=self.system_instruction,
                messages=messages,
            )

            text_parts = []
            for block in response.content:
                if hasattr(block, "text"):
                    text_parts.append(block.text)

            result = "\n".join(text_parts) if text_parts else ""

            self.conversation_history.append({"role": "user", "content": user_input})
            self.conversation_history.append({"role": "assistant", "content": result})

            # Keep conversation history compact
            if len(self.conversation_history) > 20:
                self.conversation_history = self.conversation_history[-16:]

            return result

        except Exception as e:
            logger.error(f"Claude chat error: {e}")
            return f"I'm having trouble connecting right now: {str(e)}"

    def reset(self):
        """Clear conversation history."""
        self.conversation_history = []
