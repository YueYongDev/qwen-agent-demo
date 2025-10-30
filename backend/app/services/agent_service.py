"""Service wrapper that wires qwen-agent with custom tools."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import logging

# 替换：引入 Assistant，若不可用则回退到 FnCallAgent，最后回退到 ReActChat 以保证运行
try:
    from qwen_agent.agents.assistant import Assistant  # 优先使用 Assistant 模式
except Exception:
    try:
        from qwen_agent.agents.fncall_agent import FnCallAgent as Assistant  # 回退到函数调用代理
    except Exception:
        from qwen_agent.agents.react_chat import ReActChat as Assistant  # 最后回退，确保不宕机
from qwen_agent.tools.mcp_manager import MCPManager

from ..config import get_settings
from ..rag.vector_store import VectorStore
from ..tools import LocalRagTool, PollinationsImageTool, CurrentTimeTool, GeoLocationTool, PublicIpTool
from ..models import ModelInfo

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

# 新增：日志脱敏工具，避免将密钥直接写入日志
def _redact_sensitive(obj: Any) -> Any:
    sensitive_keys = {"api_key", "apikey", "authorization", "access_token", "accesstoken", "token"}
    if isinstance(obj, dict):
        result: Dict[str, Any] = {}
        for k, v in obj.items():
            if str(k).lower() in sensitive_keys:
                result[k] = "***"
            else:
                result[k] = _redact_sensitive(v)
        return result
    if isinstance(obj, list):
        return [_redact_sensitive(v) for v in obj]
    return obj


# Assistant 模式代理，记录工具输入与输出
class InstrumentedAssistant(Assistant):
    """Assistant-mode agent that records tool inputs and outputs for the API response."""

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
        self.vector_store = vector_store

        self.tools = [
            PollinationsImageTool(),
            LocalRagTool(vector_store, default_top_k=settings.rag_top_k),
            CurrentTimeTool(),
            GeoLocationTool(),
            PublicIpTool(),
        ]
        self.tools.extend(self._load_mcp_tools(settings))

        # 更新：Assistant 风格提示词（不强调 ReAct/工具链路）
        self.base_prompt = (
            "You are a helpful Qwen assistant. Reply in Chinese or English as appropriate. "
            "Answer clearly and stay concise unless extended detail is requested. "
            "When you reference factual info or external data, be transparent about sources. "
            "Do not include chain-of-thought markers (e.g., Thought, Action, Observation, Final Answer). "
            "Provide final answers directly."
        )
        self.deep_thinking_prompt = (
            "You are a helpful Qwen assistant. The deep thinking mode is enabled. "
            "Think carefully, and when helpful, provide a short reasoning summary before the final answer. "
            "Avoid revealing internal step-by-step reasoning traces; keep the response focused and useful."
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

        # 新增：加载模型能力配置（JSON 文件或内联）
        self.models_config: Optional[List[Dict[str, Any]]] = self._load_models_config(settings)

        # 新增：默认联网搜索开关与选项
        self.default_enable_search: bool = bool(getattr(settings, "enable_search", False))
        self.default_search_options: Optional[Dict[str, Any]] = None
        inline_opts = getattr(settings, "search_options_inline", None)
        if inline_opts:
            try:
                self.default_search_options = json.loads(inline_opts)
            except json.JSONDecodeError as exc:
                logger.warning("Invalid SEARCH_OPTIONS_JSON: %s", exc)

        # 新增：内联 generate_cfg
        self.inline_generate_cfg: Optional[Dict[str, Any]] = None
        inline_gen = getattr(settings, "llm_generate_cfg_inline", None)
        if inline_gen:
            try:
                parsed = json.loads(inline_gen)
                if isinstance(parsed, dict):
                    self.inline_generate_cfg = parsed
                else:
                    logger.warning("LLM_GENERATE_CFG_JSON must be a JSON object.")
            except json.JSONDecodeError as exc:
                logger.warning("Invalid LLM_GENERATE_CFG_JSON: %s", exc)

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


        if not options.get("allow_image_tool", True) and isinstance(tool, PollinationsImageTool):
            return False

        return True

    def _is_dashscope(self) -> bool:
        """Detect whether current llm config targets DashScope (native or OpenAI-compatible)."""
        model_type = str(self.llm_config.get("model_type", "")).lower()
        api_base = str(self.llm_config.get("api_base", "")).lower()
        return ("dashscope" in api_base) or (model_type in ("qwen_dashscope", "dashscope"))

    def _load_models_config(self, settings) -> Optional[List[Dict[str, Any]]]:
        """Load models capability definitions from a JSON file or inline JSON.

        Supports two formats:
        - Inline JSON (MODELS_JSON): either a list of models or an object with 'models' key.
        - File JSON (MODELS_CONFIG_PATH): same schema as above.

        Returns:
            A list of dicts (each describing a model), or None if not configured/invalid.
        """
        raw: Optional[Dict[str, Any]] = None

        # Prefer inline JSON when provided
        if settings.models_inline_config:
            try:
                raw = json.loads(settings.models_inline_config)
            except json.JSONDecodeError:
                logger.warning("Invalid MODELS_JSON content; falling back to file or defaults.")

        # Fallback to file path when provided and inline missing/invalid
        if not raw and settings.models_config_path:
            config_path = Path(settings.models_config_path).expanduser()
            if not config_path.is_absolute():
                config_path = (Path.cwd() / config_path).resolve()
            if config_path.exists():
                try:
                    with config_path.open("r", encoding="utf-8") as fh:
                        raw = json.load(fh)
                except Exception as exc:
                    logger.warning("Failed to read models config %s: %s", config_path, exc)
            else:
                logger.warning("Models config path does not exist: %s", config_path)

        if not raw:
            return None

        # Accept either {"models": [...]} or a bare list [...]
        models_obj = raw.get("models") if isinstance(raw, dict) else raw
        if isinstance(models_obj, list):
            # ensure elements are dict-like
            parsed: List[Dict[str, Any]] = []
            for item in models_obj:
                if isinstance(item, dict):
                    parsed.append(item)
                else:
                    logger.warning("Ignoring non-dict model entry in config: %s", type(item))
            return parsed if parsed else None

        logger.warning("Models config has unexpected format; expected list or 'models' key.")
        return None

    def get_models(self) -> List[ModelInfo]:
        """Return available models exclusively from configuration.

        This method reads models from self.models_config and does not fall back to built-in defaults.
        When configuration is missing or invalid, returns an empty list.
        """
        if not self.models_config:
            logger.warning("Models config missing or empty; get_models returns []. Set MODELS_CONFIG_PATH or MODELS_JSON.")
            return []

        result: List[ModelInfo] = []
        for m in self.models_config:
            result.append(
                ModelInfo(
                    id=str(m.get("id") or m.get("model") or m.get("name") or "unknown"),
                    name=str(m.get("name") or m.get("id") or "unknown"),
                    description=m.get("description"),
                    tags=list(m.get("tags") or []),
                    supports_thinking=bool(m.get("supports_thinking", False)),
                    provider_model=m.get("provider_model") or m.get("model"),
                )
            )
        return result

    def run_conversation(
        self,
        messages: List[Dict[str, Any]],
        lang: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
        client_ip: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Execute a single turn of conversation with the agent."""

        system_prompt = self.deep_thinking_prompt if options and options.get("deep_thinking") else self.base_prompt
        # 基于请求动态注入用户 IP：对 GeoLocationTool 用请求 IP 重建实例
        selected_tools: List[Any] = []
        for tool in self.tools:
            if not self._tool_allowed(tool, options):
                continue
            try:
                from ..tools import GeoLocationTool as _GeoLocationTool
            except Exception:
                _GeoLocationTool = None
            if _GeoLocationTool and isinstance(tool, _GeoLocationTool):
                selected_tools.append(_GeoLocationTool(cfg={"client_ip": client_ip} if client_ip else None))
            else:
                selected_tools.append(tool)

        # 基于请求选项与 DashScope 兼容环境，动态注入 enable_thinking / enable_search 到 llm 配置
        llm_params: Dict[str, Any] = dict(self.llm_config)
        extra_body: Dict[str, Any] = dict(llm_params.get("extra_body") or {})

        if options and options.get("deep_thinking") and self._is_dashscope():
            extra_body["enable_thinking"] = True

        if self._is_dashscope():
            want_enable_search = bool(options.get("enable_search")) if options else False
            if not want_enable_search and self.default_enable_search:
                want_enable_search = True
            if want_enable_search:
                extra_body["enable_search"] = True
                # 请求覆盖优先，其次使用默认 SEARCH_OPTIONS_JSON
                override_opts = options.get("search_options") if options else None
                chosen_opts = override_opts if isinstance(override_opts, dict) else self.default_search_options
                if isinstance(chosen_opts, dict) and chosen_opts:
                    extra_body["search_options"] = chosen_opts

        if extra_body:
            llm_params["extra_body"] = extra_body

        # 合并/设置 generate_cfg；thought_in_content 仅由“深度思考”按钮决定且总是布尔值
        generate_cfg: Dict[str, Any] = dict(llm_params.get("generate_cfg") or {})
        if self.inline_generate_cfg:
            generate_cfg.update(self.inline_generate_cfg)
        generate_cfg["thought_in_content"] = bool(options.get("deep_thinking")) if options else False
        if generate_cfg:
            llm_params["generate_cfg"] = generate_cfg

        # 新增：请求时输出 llm_params（脱敏）
        try:
            safe_llm_params = _redact_sensitive(llm_params)
            logger.info("Prepared llm_params: %s", json.dumps(safe_llm_params, ensure_ascii=False))
        except Exception as exc:
            logger.debug("Failed to log llm_params: %s", exc)

        # 替换：使用 Assistant 模式代理而非 ReActChat
        agent = InstrumentedAssistant(
            function_list=selected_tools,
            llm=llm_params,
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