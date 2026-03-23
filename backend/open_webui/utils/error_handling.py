from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException


def _truncate_text(text: str, limit: int = 2000) -> str:
    if not isinstance(text, str):
        text = str(text)
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit] + "...(truncated)"


def _apply_prefix(detail: str, prefix: str | None) -> str:
    if not prefix:
        return detail

    normalized = detail.strip()
    if normalized.lower().startswith(f"{prefix.lower()}:"):
        return normalized

    return f"{prefix}: {normalized}"


def extract_error_detail(value: Any, *, limit: int = 2000) -> str | None:
    if value is None:
        return None

    if isinstance(value, HTTPException):
        return extract_error_detail(value.detail, limit=limit)

    if isinstance(value, str):
        text = value.strip()
        return _truncate_text(text, limit) if text else None

    if isinstance(value, BaseException):
        text = str(value).strip()
        return _truncate_text(text, limit) if text else None

    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            detail = extract_error_detail(item, limit=limit)
            if detail and detail not in parts:
                parts.append(detail)
        return "; ".join(parts) if parts else None

    if isinstance(value, dict):
        msg = value.get("msg")
        loc = value.get("loc")
        if isinstance(msg, str) and msg.strip():
            if isinstance(loc, (list, tuple)):
                loc_text = ".".join(str(part) for part in loc if part is not None)
                if loc_text:
                    return _truncate_text(f"{loc_text}: {msg.strip()}", limit)
            return _truncate_text(msg.strip(), limit)

        error = value.get("error")
        if error is not None:
            detail = extract_error_detail(error, limit=limit)
            if detail:
                return detail

        for key in ("detail", "message", "error_description", "title"):
            detail = extract_error_detail(value.get(key), limit=limit)
            if detail:
                return detail

        try:
            text = json.dumps(value, ensure_ascii=False, default=str)
        except Exception:
            text = str(value)

        text = _truncate_text(text, limit)
        return text if text else None

    text = str(value).strip()
    return _truncate_text(text, limit) if text else None


def build_error_detail(
    *candidates: Any,
    default: str | None = None,
    prefix: str | None = None,
    limit: int = 2000,
) -> str:
    for candidate in candidates:
        detail = extract_error_detail(candidate, limit=limit)
        if detail:
            return _apply_prefix(detail, prefix)

    fallback = default or "Connection to upstream server failed"
    return _apply_prefix(fallback, prefix)


async def read_aiohttp_error_payload(response: Any) -> Any:
    if response is None:
        return None

    try:
        return await response.json(content_type=None)
    except Exception:
        try:
            return await response.text()
        except Exception:
            return getattr(response, "reason", None)


def read_requests_error_payload(response: Any) -> Any:
    if response is None:
        return None

    try:
        return response.json()
    except Exception:
        return getattr(response, "text", None) or getattr(response, "reason", None)
