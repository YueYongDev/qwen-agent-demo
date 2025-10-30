"""Tool for image generation via the Pollinations public API."""

from __future__ import annotations

import base64
from typing import Any, Dict, Union
from urllib.parse import quote_plus

import requests

from qwen_agent.tools.base import BaseTool


class PollinationsImageTool(BaseTool):
    """Generate images for a prompt using the Pollinations service."""

    name = "image_generator"
    description = (
        "Generate an image for the user prompt. Returns a public URL and "
        "optionally an inline Base64 thumbnail for previews."
    )
    parameters: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": "Detailed image prompt describing the scene to create."
            },
            "aspect_ratio": {
                "type": "string",
                "description": "Aspect ratio formatted as WIDTH:HEIGHT, e.g. 1:1 or 16:9.",
                "default": "1:1"
            },
            "return_preview": {
                "type": "boolean",
                "description": "Whether to return a Base64 encoded thumbnail of the image.",
                "default": False
            }
        },
        "required": ["prompt"]
    }

    def call(self, params: Union[str, dict], **kwargs) -> Dict[str, Any]:
        data = self._verify_json_format_args(params)
        prompt = data["prompt"].strip()
        if not prompt:
            raise ValueError("Prompt must not be empty.")

        aspect_ratio = data.get("aspect_ratio", "1:1").strip() or "1:1"
        ratio_parts = aspect_ratio.split(":")
        try:
            width_ratio = float(ratio_parts[0])
            height_ratio = float(ratio_parts[1])
        except (IndexError, ValueError):
            width_ratio, height_ratio = 1.0, 1.0

        base_size = 768
        width = max(128, min(int(base_size * width_ratio), 1024))
        height = max(128, min(int(base_size * height_ratio), 1024))

        url = (
            "https://image.pollinations.ai/prompt/"
            f"{quote_plus(prompt)}?width={width}&height={height}"
        )

        result: Dict[str, Any] = {
            "prompt": prompt,
            "image_url": url,
            "width": width,
            "height": height,
        }

        if data.get("return_preview", False):
            response = requests.get(url, timeout=60)
            response.raise_for_status()
            preview_b64 = base64.b64encode(response.content).decode("utf-8")
            result["preview_base64"] = preview_b64

        return result
