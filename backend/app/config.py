"""
Application configuration utilities.

Loads environment variables (including values from a local ``.env`` file) and
exposes a cached ``get_settings`` helper so the rest of the codebase can access
runtime configuration in a consistent fashion.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import List, Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field

# Load environment variables from a local .env file if present.
load_dotenv()


class Settings(BaseModel):
    """Strongly-typed application configuration."""

    dashscope_api_key: Optional[str] = Field(
        default_factory=lambda: os.getenv("DASHSCOPE_API_KEY"),
        description="API key for DashScope powered Qwen models.",
    )
    llm_model_name: str = Field(
        default=os.getenv("LLM_MODEL_NAME", os.getenv("QWEN_MODEL_NAME", "qwen3")),
        description="Default Qwen model name.",
    )
    llm_model_type: str = Field(
        default=os.getenv("LLM_MODEL_TYPE", os.getenv("QWEN_MODEL_TYPE", "oai")),
        description="Model backend type expected by qwen-agent.",
    )
    llm_api_base: Optional[str] = Field(
        default=os.getenv("LLM_API_BASE", os.getenv("OLLAMA_API_BASE", "http://localhost:11434/v1")),
        description="Base URL for OpenAI-compatible endpoints (used for Ollama).",
    )
    llm_api_key: Optional[str] = Field(
        default_factory=lambda: os.getenv("LLM_API_KEY"),
        description="API key passed to OpenAI-compatible models when required.",
    )
    allow_origins: List[str] = Field(
        default_factory=lambda: os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:5173").split(","),
        description="Comma-separated list of origins allowed by CORS configuration.",
    )
    rag_top_k: int = Field(
        default=int(os.getenv("RAG_TOP_K", "3")),
        description="Number of knowledge base chunks returned by the RAG tool.",
    )
    mcp_config_path: Optional[str] = Field(
        default=os.getenv("MCP_CONFIG_PATH"),
        description="Path to an MCP server configuration JSON file.",
    )
    mcp_inline_config: Optional[str] = Field(
        default=os.getenv("MCP_SERVERS_JSON"),
        description="Raw JSON string describing MCP servers (alternative to file).",
    )


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings."""

    return Settings()
