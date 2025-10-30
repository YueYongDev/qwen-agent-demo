"""FastAPI entrypoint exposing the conversational demo endpoints."""

from __future__ import annotations

import json
from typing import Iterable

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import get_settings
from .models import ChatMessage, ChatRequest, ChatResponse, ModelsResponse
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


@app.get("/api/models", response_model=ModelsResponse)
def list_models() -> ModelsResponse:
    return ModelsResponse(models=agent_service.get_models())


def _get_client_ip(request: Request) -> str:
    # X-Forwarded-For may contain multiple IPs, left-most is the original client
    xff = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    xri = request.headers.get("x-real-ip") or request.headers.get("X-Real-IP")
    if xri:
        return xri.strip()
    c = getattr(request, "client", None)
    return getattr(c, "host", "") or ""


@app.post("/api/chat", response_model=ChatResponse)
def chat_endpoint(payload: ChatRequest, request: Request) -> ChatResponse:
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    try:
        client_ip = _get_client_ip(request)
        # 打印请求入参（调试）
        print(json.dumps({
            "route": "/api/chat",
            "client_ip": client_ip,
            "lang": payload.lang,
            "options": payload.options.model_dump(),
            "messages_len": len(payload.messages),
        }, ensure_ascii=False))
        result = agent_service.run_conversation(
            messages=[msg.model_dump() for msg in payload.messages],
            lang=payload.lang,
            options=payload.options.model_dump(),
            client_ip=client_ip,
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
def chat_stream_endpoint(payload: ChatRequest, request: Request) -> StreamingResponse:
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")

    def event_stream() -> Iterable[str]:
        try:
            client_ip = _get_client_ip(request)
            # 打印请求入参（调试）
            print(json.dumps({
                "route": "/api/chat/stream",
                "client_ip": client_ip,
                "lang": payload.lang,
                "options": payload.options.model_dump(),
                "messages_len": len(payload.messages),
            }, ensure_ascii=False))
            result = agent_service.run_conversation(
                messages=[msg.model_dump() for msg in payload.messages],
                lang=payload.lang,
                options=payload.options.model_dump(),
                client_ip=client_ip,
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