"""Tool to get approximate geolocation of the server by IP."""

from __future__ import annotations

from typing import Any, Dict, Union

import requests
from qwen_agent.tools.base import BaseTool


class GeoLocationTool(BaseTool):
    """Return server-side geolocation using public IP lookup."""

    name = "geo_location"
    description = (
        "Get the user's approximate geographic location by IP. "
        "If an IP is provided (via parameter or context), use it; otherwise fallback to server IP. "
        "Returns city, region, country, coordinates and timezone."
    )
    parameters: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "provider": {
                "type": "string",
                "description": "Provider to use: 'ip-api' or 'ipinfo'. Defaults to 'ip-api'.",
                "default": "ip-api",
            },
            "ip": {
                "type": "string",
                "description": "Target IPv4/IPv6 to locate. If omitted, the tool may use a context-provided client_ip or fallback to server IP."
            }
        },
        "required": [],
    }

    def call(self, params: Union[str, dict], **kwargs) -> Dict[str, Any]:
        data = self._verify_json_format_args(params)
        provider = str(data.get("provider", "ip-api")).strip().lower()
        # 优先级：显式参数 > 运行时 kwargs > 初始化 cfg > 无 -> 回退到服务默认（服务器IP）
        target_ip = (str(data.get("ip", "")).strip()
                     or str(kwargs.get("client_ip", "")).strip()
                     or str((getattr(self, "cfg", {}) or {}).get("client_ip", "")).strip()
                    ) or None

        def _call_ip_api() -> Dict[str, Any]:
            base = "http://ip-api.com/json"
            url = f"{base}/{target_ip}" if target_ip else f"{base}/"
            url = f"{url}?fields=status,message,country,countryCode,region,regionName,city,lat,lon,timezone,query,isp,org"
            resp = requests.get(
                url,
                timeout=10,
            )
            resp.raise_for_status()
            payload = resp.json()
            if payload.get("status") != "success":
                raise RuntimeError(payload.get("message") or "ip-api lookup failed")
            return {
                "ip": payload.get("query"),
                "city": payload.get("city"),
                "region": payload.get("regionName") or payload.get("region"),
                "country": payload.get("country"),
                "country_code": payload.get("countryCode"),
                "latitude": payload.get("lat"),
                "longitude": payload.get("lon"),
                "timezone": payload.get("timezone"),
                "isp": payload.get("isp"),
                "org": payload.get("org"),
                "provider": "ip-api",
                "used_input_ip": target_ip or None,
            }

        def _call_ipinfo() -> Dict[str, Any]:
            url = f"https://ipinfo.io/{target_ip}/json" if target_ip else "https://ipinfo.io/json"
            resp = requests.get(url, timeout=10)
            resp.raise_for_status()
            payload = resp.json()
            loc = str(payload.get("loc") or "")
            lat, lon = None, None
            try:
                lat_str, lon_str = loc.split(",")
                lat, lon = float(lat_str), float(lon_str)
            except Exception:
                pass
            return {
                "ip": payload.get("ip"),
                "city": payload.get("city"),
                "region": payload.get("region"),
                "country": payload.get("country"),
                "country_code": payload.get("country"),
                "latitude": lat,
                "longitude": lon,
                "timezone": payload.get("timezone"),
                "org": payload.get("org"),
                "provider": "ipinfo",
                "used_input_ip": target_ip or None,
            }

        try:
            return _call_ipinfo() if provider == "ipinfo" else _call_ip_api()
        except Exception as exc:
            try:
                # Fallback to the other provider
                return _call_ip_api() if provider == "ipinfo" else _call_ipinfo()
            except Exception as exc2:
                return {
                    "error": "geolocation_unavailable",
                    "detail": str(exc2),
                    "provider": provider,
                    "used_input_ip": target_ip or None,
                }