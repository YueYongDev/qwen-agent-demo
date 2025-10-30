"""Tool to get the current time with optional timezone and unix epoch."""

from __future__ import annotations

from typing import Any, Dict, Union
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo  # Python 3.9+
except Exception:
    ZoneInfo = None

from qwen_agent.tools.base import BaseTool


class CurrentTimeTool(BaseTool):
    """Return the current time, useful for scheduling and timestamping."""

    name = "current_time"
    description = (
        "Get the current time. Returns ISO timestamp in the requested timezone "
        "and optionally the unix epoch seconds."
    )
    parameters: Dict[str, Any] = {
        "type": "object",
        "properties": {
            "timezone": {
                "type": "string",
                "description": "IANA timezone like 'UTC' or 'Asia/Shanghai'. Defaults to 'UTC'.",
                "default": "UTC",
            },
            "return_unix": {
                "type": "boolean",
                "description": "Include unix epoch seconds in the result.",
                "default": True,
            },
        },
        "required": [],
    }

    def call(self, params: Union[str, dict], **kwargs) -> Dict[str, Any]:
        data = self._verify_json_format_args(params)

        tz_name = str(data.get("timezone", "UTC")).strip() or "UTC"
        tzinfo = timezone.utc
        if ZoneInfo is not None:
            try:
                tzinfo = ZoneInfo(tz_name)
            except Exception:
                tz_name = "UTC"
                tzinfo = timezone.utc

        now = datetime.now(tzinfo)
        result: Dict[str, Any] = {
            "timezone": tz_name,
            "datetime_iso": now.isoformat(timespec="seconds"),
            "utc_offset": now.strftime("%z"),
        }
        if bool(data.get("return_unix", True)):
            result["unix_epoch"] = int(now.timestamp())
        return result