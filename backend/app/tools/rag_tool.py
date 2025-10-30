"""Tool that performs retrieval over the local knowledge base."""

from __future__ import annotations

from typing import Any, Dict, Union

from qwen_agent.tools.base import BaseTool

from ..rag.vector_store import VectorStore


class LocalRagTool(BaseTool):
    """Retrieve relevant passages from the demo knowledge base."""

    name = "knowledge_base_lookup"
    description = (
        "Access the local project knowledge base to ground answers with factual context. "
        "Useful for questions about the demo setup, tooling integrations or DashScope usage."
    )
    parameters: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Natural language question to match against the knowledge base."
            },
            "top_k": {
                "type": "integer",
                "description": "Maximum number of documents to retrieve (1-5).",
                "default": 3
            }
        },
        "required": ["query"]
    }

    def __init__(self, vector_store: VectorStore, default_top_k: int = 3, cfg: Dict[str, Any] | None = None):
        super().__init__(cfg)
        self.vector_store = vector_store
        self.default_top_k = default_top_k

    def call(self, params: Union[str, dict], **kwargs) -> Dict[str, Any]:
        data = self._verify_json_format_args(params)
        query = data["query"].strip()
        if not query:
            raise ValueError("Query must not be empty.")

        top_k = int(data.get("top_k", self.default_top_k))
        top_k = max(1, min(top_k, 5))

        matches = self.vector_store.search(query, top_k=top_k)
        formatted = [
            {
                "id": doc.get("id"),
                "title": doc.get("title"),
                "content": doc.get("content"),
                "score": round(score, 4),
            }
            for doc, score in matches
        ]
        return {"query": query, "results": formatted}
