"""Tool that wraps DuckDuckGo web search."""

from __future__ import annotations

from typing import Any, Dict, List, Union

from duckduckgo_search import DDGS

from qwen_agent.tools.base import BaseTool


class DuckDuckGoSearchTool(BaseTool):
    """Perform a web search and return concise organic results."""

    name = "web_search"
    description = (
        "Use DuckDuckGo web search to gather recent information. Best suited "
        "for facts, news and general knowledge questions."
    )
    parameters: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query string."
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of results to return (1-5).",
                "default": 3
            },
            "region": {
                "type": "string",
                "description": "Optional region code, e.g. 'wt-wt', 'us-en' or 'cn-zh'.",
                "default": "wt-wt"
            }
        },
        "required": ["query"]
    }

    def call(self, params: Union[str, dict], **kwargs) -> Dict[str, Any]:
        data = self._verify_json_format_args(params)
        query = data["query"].strip()
        if not query:
            raise ValueError("Search query must not be empty.")

        max_results = int(data.get("max_results", 3))
        max_results = max(1, min(max_results, 5))
        region = data.get("region", "wt-wt")

        with DDGS() as ddgs:
            results_iter = ddgs.text(query, region=region, max_results=max_results)
            results: List[Dict[str, Any]] = []
            for item in results_iter:
                results.append(
                    {
                        "title": item.get("title"),
                        "href": item.get("href"),
                        "body": item.get("body"),
                    }
                )

        return {"query": query, "results": results}
