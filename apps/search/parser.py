"""Search query parser (P2-12 / Issue #206).

Parses queries like ``python tag:django from:alice since:2026-01-01 has:image``
into a structured ``ParsedQuery``: free-text keywords + a dict of operators.

Supported operators:
    tag:<name>          # restrict to tweets carrying the tag (multiple allowed)
    from:<handle>       # restrict to tweets whose author handle matches
    since:<YYYY-MM-DD>  # created_at >= midnight JST
    until:<YYYY-MM-DD>  # created_at <  next-day midnight JST
    type:<kind>         # original | reply | repost | quote
    has:<kind>          # image | code

Unknown operator names and malformed values are silently dropped — the goal is
to never throw on user input. Validation is the caller's job (``services.py``).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime

# operator名 → 値のリスト (tag/has/type は複数可、from/since/until は最後勝ち)
_OPERATOR_NAMES = {"tag", "from", "since", "until", "type", "has"}
_OPERATOR_RE = re.compile(r"^(?P<key>[a-z]+):(?P<value>.+)$")
_HANDLE_RE = re.compile(r"^[A-Za-z0-9_]{1,32}$")
_TYPE_VALUES = {"original", "reply", "repost", "quote"}
_HAS_VALUES = {"image", "code"}


@dataclass
class ParsedQuery:
    keywords: str = ""
    tags: list[str] = field(default_factory=list)
    from_handle: str | None = None
    since: date | None = None
    until: date | None = None
    type: str | None = None
    has: list[str] = field(default_factory=list)


def _parse_date(value: str) -> date | None:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def parse_search_query(raw: str) -> ParsedQuery:
    """Split ``raw`` into operators + keyword tokens.

    Whitespace is the only token boundary; quoted strings are not yet
    supported (a follow-up can add ``"phrase search"`` if demand emerges).
    """
    parsed = ParsedQuery()
    keyword_tokens: list[str] = []

    for token in (raw or "").split():
        match = _OPERATOR_RE.match(token)
        if match is None:
            keyword_tokens.append(token)
            continue

        key = match.group("key").lower()
        value = match.group("value")

        if key not in _OPERATOR_NAMES:
            # Unknown operator — keep the literal in keywords so users still
            # get *some* result instead of a silent miss.
            keyword_tokens.append(token)
            continue

        if key == "tag" and value:
            parsed.tags.append(value.lstrip("#").lower())
        elif key == "from":
            handle = value.lstrip("@")
            if _HANDLE_RE.match(handle):
                parsed.from_handle = handle
        elif key == "since":
            d = _parse_date(value)
            if d is not None:
                parsed.since = d
        elif key == "until":
            d = _parse_date(value)
            if d is not None:
                parsed.until = d
        elif key == "type":
            v = value.lower()
            if v in _TYPE_VALUES:
                parsed.type = v
        elif key == "has":
            v = value.lower()
            if v in _HAS_VALUES and v not in parsed.has:
                parsed.has.append(v)

    parsed.keywords = " ".join(keyword_tokens).strip()
    return parsed
