"""Tool to perform web search and return brief summaries of top results."""
import json
import os
from typing import List, Dict, Any, Optional, Union

import requests
from bs4 import BeautifulSoup
from qwen_agent.tools.base import BaseTool


class WebSearchTool(BaseTool):
    """Perform web search and return brief summaries of top results."""

    name = "web_search"
    description = "Perform web search and return brief summaries of top results."

    parameters = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query string.",
            },
            "num_results": {
                "type": "integer",
                "description": "Number of results to fetch (1-10).",
                "default": 3
            },
            "fetch_content": {
                "type": "boolean",
                "description": "Whether to fetch page content and summarize.",
                "default": True
            },
            "gl": {
                "type": "string",
                "description": "Geolocation/country code for Google (e.g., us, hk).",
                "default": "us"
            }
        },
        "required": ["query"]
    }

    def call(self, params: Union[str, dict], **kwargs) -> Dict[str, Any]:
        data = self._verify_json_format_args(params)
        
        query: str = data.get("query", "").strip()
        num_results: int = int(data.get("num_results", 3))
        fetch_content: bool = bool(data.get("fetch_content", True))
        gl: str = str(data.get("gl", "us")).strip() or "us"
        num_results = max(1, min(10, num_results))
        
        if not query:
            return {"error": "query is required"}

        # 获取 serper_api_key，优先从环境变量获取，然后从数据中获取
        serper_api_key = os.getenv("SERPER_API_KEY", "9063463622d013ac5f0317619bfbdbf730ae7d4b")
        if not serper_api_key or serper_api_key == "":
            return {"error": "missing SERPER_API_KEY in environment or .env"}

        try:
            resp = requests.post(
                "https://google.serper.dev/search",
                headers={
                    "X-API-KEY": serper_api_key,
                    "Content-Type": "application/json"
                },
                json={"q": query, "gl": gl},
                timeout=10
            )
            if not resp.ok:
                return {
                    "error": f"serper error: {resp.status_code} {resp.text}"
                }
            data_response = resp.json()
            organic = data_response.get("organic", [])
        except Exception as e:
            return {"error": f"serper request error: {e}"}

        results: List[Dict[str, Any]] = []
        headers = {"User-Agent": "Mozilla/5.0 Chrome/119 Safari/537.36"}
        
        for r in organic[:num_results]:
            url = r.get("link") or r.get("url") or ""
            title = r.get("title") or ""
            snippet_api = r.get("snippet") or ""
            item: Dict[str, Any] = {"url": url, "title": title, "snippet": snippet_api}

            if fetch_content and url:
                try:
                    page = requests.get(url, headers=headers, timeout=8)
                    if page.ok and "text/html" in page.headers.get("Content-Type", ""):
                        soup = BeautifulSoup(page.text, "html.parser")
                        page_title = soup.title.string.strip() if soup.title and soup.title.string else title
                        text = soup.get_text(" ", strip=True)
                        snippet_page = (text[:800] + "...") if len(text) > 800 else text
                        item.update({"title": page_title, "snippet": snippet_page})
                except Exception as e:
                    # 记录错误但不中断处理
                    print(f"Error fetching content from {url}: {e}")
                    pass

            results.append(item)

        return {"results": results}