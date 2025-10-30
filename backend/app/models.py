"""Pydantic models shared across the API layer."""

from __future__ import annotations

from typing import List, Literal, Optional, Union, Dict, Any

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatOptions(BaseModel):
    deep_thinking: bool = Field(
        default=False,
        description="When true, the agent should perform more deliberate reasoning.",
    )
    allow_web_search: bool = Field(
        default=True,
        description="When false, the agent must avoid calling web search tools.",
    )
    allow_image_tool: bool = Field(
        default=True,
        description="When false, the agent must avoid calling image generation tools.",
    )
    enable_search: bool = Field(
        default=False,
        description="Enable provider-native web search via extra_body when supported.",
    )
    search_options: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Provider-native search_options override passed via extra_body.",
    )


class ChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(default_factory=list)
    lang: Optional[Literal["en", "zh"]] = Field(
        default=None,
        description="Optional language hint forwarded to the agent.",
    )
    options: ChatOptions = Field(
        default_factory=ChatOptions,
        description="Conversation switches that influence the agent behaviour.",
    )


class ToolEvent(BaseModel):
    tool_name: str
    arguments: Union[str, dict]
    result: Union[str, dict, list]


class ChatResponse(BaseModel):
    replies: List[ChatMessage]
    tool_events: List[ToolEvent] = Field(default_factory=list)

# 新增：模型能力与列表响应的数据结构
class ModelInfo(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    supports_thinking: bool = False
    provider_model: Optional[str] = None

class ModelsResponse(BaseModel):
    models: List[ModelInfo] = Field(default_factory=list)