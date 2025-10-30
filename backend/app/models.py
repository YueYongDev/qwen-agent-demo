"""Pydantic models shared across the API layer."""

from __future__ import annotations

from typing import List, Literal, Optional, Union

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
