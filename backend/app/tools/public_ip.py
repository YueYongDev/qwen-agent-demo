"""Tool to retrieve the server's public IP address."""

from __future__ import annotations

from typing import Any, Dict, Union

import requests
from qwen_agent.tools.base import BaseTool


class PublicIpTool(BaseTool):
    """Return the server public IP address via common providers."""

    name = "public_ip"
    description = (
        "Get the server's public IP address using a public API provider. "
        "Returns the IP and the provider used. Note: This is the backend server IP."
    )
    parameters: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "provider": {
                "type": "string",
                "description": "Provider to use: 'ipify', 'ifconfig', or 'ipinfo'. Defaults to 'ipify'.",
                "default": "ipify",
            }
        },
        "required": [],
    }

    def call(self, params: Union[str, dict], **kwargs) -> Dict[str, Any]:
        data = self._verify_json_format_args(params)
        provider = str(data.get("provider", "ipify")).strip().lower()

        def _ipify() -> Dict[str, Any]:
            resp = requests.get("https://api.ipify.org?format=json", timeout=8)
            resp.raise_for_status()
            payload = resp.json()
            ip = payload.get("ip")
            if not ip:
                raise RuntimeError("ipify returned no IP")
            return {"ip": ip, "provider": "ipify"}

        def _ifconfig() -> Dict[str, Any]:
            resp = requests.get("https://ifconfig.me/ip", timeout=8)
            resp.raise_for_status()
            ip = resp.text.strip()
            if not ip:
                raise RuntimeError("ifconfig.me returned no IP")
            return {"ip": ip, "provider": "ifconfig.me"}

        def _ipinfo() -> Dict[str, Any]:
            resp = requests.get("https://ipinfo.io/json", timeout=8)
            resp.raise_for_status()
            payload = resp.json()
            ip = payload.get("ip")
            if not ip:
                raise RuntimeError("ipinfo returned no IP")
            return {"ip": ip, "provider": "ipinfo"}

        try:
            if provider == "ifconfig":
                return _ifconfig()
            elif provider == "ipinfo":
                return _ipinfo()
            else:
                return _ipify()
        except Exception:
            # Fallback chain: ipify -> ifconfig -> ipinfo
            for fn in (_ifconfig, _ipinfo, _ipify):
                try:
                    return fn()
                except Exception:
                    continue
            return {"error": "public_ip_unavailable", "provider": provider}