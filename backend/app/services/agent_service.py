"""Service wrapper that wires qwen-agent with custom tools."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import logging

from qwen_agent.agents.react_chat import ReActChat
from qwen_agent.tools.mcp_manager import MCPManager

from ..config import get_settings
from ..rag.vector_store import VectorStore
from ..tools import DuckDuckGoSearchTool, LocalRagTool, PollinationsImageTool

logger = logging.getLogger(__name__)


def _strip_code_fence(value: str) -> str:
    """Remove ```json fences that the model might emit."""

    value = value.strip()
    if value.startswith("```") and value.endswith("```"):
        value = re.sub(r"^```[a-zA-Z0-9]*\n", "", value)
        value = value.rsplit("```", 1)[0]
    return value.strip()


def _maybe_json_parse(value: Union[str, Dict[str, Any]]) -> Union[str, Dict[str, Any]]:
    if not isinstance(value, str):
        return value
    cleaned = _strip_code_fence(value)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return value


class InstrumentedReActChat(ReActChat):
    """ReAct agent that records tool inputs and outputs for the API response."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.tool_events: List[Dict[str, Any]] = []

    def _call_tool(self, tool_name: str, tool_args: Union[str, dict] = "{}", **kwargs):
        result = super()._call_tool(tool_name, tool_args, **kwargs)

        parsed_input = _maybe_json_parse(tool_args)
        parsed_output: Union[str, Dict[str, Any], List[Dict[str, Any]]]
        if isinstance(result, list):
            parsed_output = [getattr(item, "model_dump", lambda: item)() for item in result]
        else:
            parsed_output = _maybe_json_parse(result)

        self.tool_events.append(
            {
                "tool_name": tool_name,
                "arguments": parsed_input,
                "result": parsed_output,
            }
        )
        return result


class AgentService:
    """High level façade around qwen-agent."""

    def __init__(self, kb_path: Optional[Path] = None):
        settings = get_settings()

        kb_file = kb_path or Path(__file__).resolve().parents[2] / "data" / "knowledge_base.json"
        vector_store = VectorStore(kb_file)

        self.tools = [
            PollinationsImageTool(),
            DuckDuckGoSearchTool(),
            LocalRagTool(vector_store, default_top_k=settings.rag_top_k),
        ]
        self.tools.extend(self._load_mcp_tools(settings))

        self.base_prompt = (
            "You are a helpful Qwen assistant that can call tools and reply in Chinese or English. "
            "Answer clearly and stay concise unless extended detail is requested. When using tool outputs, cite them "
            "explicitly when appropriate."
        )
        self.deep_thinking_prompt = (
            self.base_prompt
            + " The deep thinking switch is enabled, so take time to reason step-by-step and share a brief summary of "
              "your reasoning before the final answer when helpful."
        )
        self.llm_config: Dict[str, Any] = {
            "model": settings.llm_model_name,
            "model_type": settings.llm_model_type,
        }
        model_type = settings.llm_model_type.lower()
        if model_type == "oai":
            if settings.llm_api_base:
                self.llm_config["api_base"] = settings.llm_api_base
            if settings.llm_api_key:
                self.llm_config["api_key"] = settings.llm_api_key
        elif model_type == "qwen_dashscope" and settings.dashscope_api_key:
            self.llm_config["api_key"] = settings.dashscope_api_key

    def _load_mcp_tools(self, settings) -> List[Any]:
        """Load MCP server definitions and build tool wrappers."""

        raw_config: Optional[Dict[str, Any]] = None

        if settings.mcp_inline_config:
            try:
                raw_config = json.loads(settings.mcp_inline_config)
            except json.JSONDecodeError as exc:
                logger.warning("Invalid MCP_SERVERS_JSON: %s", exc)
        elif settings.mcp_config_path:
            config_path = Path(settings.mcp_config_path).expanduser()
            if not config_path.is_absolute():
                config_path = (Path.cwd() / config_path).resolve()
            if config_path.exists():
                try:
                    with config_path.open("r", encoding="utf-8") as fh:
                        raw_config = json.load(fh)
                except Exception as exc:  # pragma: no cover - configuration IO guard
                    logger.warning("Failed to load MCP config file %s: %s", config_path, exc)
            else:
                logger.warning("MCP config path does not exist: %s", config_path)

        if not raw_config:
            return []

        try:
            manager = MCPManager()
            return manager.initConfig(raw_config)
        except Exception as exc:  # pragma: no cover - initialization guard
            logger.warning("Unable to initialize MCP servers: %s", exc)
            return []

    def _tool_allowed(self, tool: Any, options: Optional[Dict[str, Any]]) -> bool:
        if not options:
            return True

        if not options.get("allow_web_search", True) and isinstance(tool, DuckDuckGoSearchTool):
            return False

        if not options.get("allow_image_tool", True) and isinstance(tool, PollinationsImageTool):
            return False

        return True

    def run_conversation(
        self,
        messages: List[Dict[str, Any]],
        lang: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Execute a single turn of conversation with the agent."""

        system_prompt = self.deep_thinking_prompt if options and options.get("deep_thinking") else self.base_prompt
        selected_tools = [tool for tool in self.tools if self._tool_allowed(tool, options)]

        agent = InstrumentedReActChat(
            function_list=selected_tools,
            llm=self.llm_config,
            system_message=system_prompt,
            name="QwenAgent",
        )

        # Ensure content is always a string to keep the demo simple.
        normalized_messages: List[Dict[str, Any]] = []
        for message in messages:
            content = message.get("content", "")
            if isinstance(content, list):
                content = json.dumps(content, ensure_ascii=False)
            normalized_messages.append({"role": message["role"], "content": content})

        final_messages = agent.run_nonstream(normalized_messages, lang=lang or "zh")

        formatted_replies = [
            {
                "role": msg["role"],
                "content": msg.get("content", ""),
            }
            for msg in final_messages
        ]

        return {
            "replies": formatted_replies,
            "tool_events": agent.tool_events,
        }
