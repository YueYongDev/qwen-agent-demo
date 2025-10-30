"""FastAPI entrypoint exposing the conversational demo endpoints."""

from __future__ import annotations

import json
from typing import Iterable

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import get_settings
from .models import ChatMessage, ChatRequest, ChatResponse
from .services.agent_service import AgentService

settings = get_settings()
agent_service = AgentService()

app = FastAPI(
    title="Qwen Agent Demo",
    description="Conversational backend powered by qwen-agent with custom tools.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/chat", response_model=ChatResponse)
def chat_endpoint(payload: ChatRequest) -> ChatResponse:
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    try:
        result = agent_service.run_conversation(
            messages=[msg.model_dump() for msg in payload.messages],
            lang=payload.lang,
            options=payload.options.model_dump(),
        )
    except Exception as exc:  # pragma: no cover - safeguard for demo
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return ChatResponse(
        replies=[ChatMessage(**message) for message in result["replies"]],
        tool_events=result["tool_events"],
    )


def _chunk_content(value: str, size: int = 48) -> Iterable[str]:
    for index in range(0, len(value), size):
        yield value[index : index + size]


@app.post("/api/chat/stream")
def chat_stream_endpoint(payload: ChatRequest) -> StreamingResponse:
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    def event_stream() -> Iterable[str]:
        try:
            result = agent_service.run_conversation(
                messages=[msg.model_dump() for msg in payload.messages],
                lang=payload.lang,
                options=payload.options.model_dump(),
            )

            assistant_messages = [
                ChatMessage(**message)
                for message in result["replies"]
                if message.get("role") == "assistant"
            ]

            for message in assistant_messages:
                content = message.content or ""
                if not content:
                    continue
                for chunk in _chunk_content(content):
                    data = json.dumps({"type": "chunk", "delta": chunk}, ensure_ascii=False)
                    yield f"data: {data}\n\n"

            tool_events = result.get("tool_events", [])
            if tool_events:
                data = json.dumps({"type": "tools", "tool_events": tool_events}, ensure_ascii=False)
                yield f"data: {data}\n\n"

            yield "data: [DONE]\n\n"
        except Exception as exc:  # pragma: no cover - safeguard for demo
            detail = json.dumps(
                {"type": "error", "detail": str(exc)},
                ensure_ascii=False,
            )
            yield f"data: {detail}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
