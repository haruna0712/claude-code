"""Cursor pagination helper for timeline endpoints (Issue #200).

Phase 2 段階の cursor は Tweet ID 単独 (base64 url-safe エンコード) で十分。
クライアント側は不透明な文字列として扱い、サーバ側だけが decode する。

将来 (created_at, id) のタプルが必要になったら ``encode_cursor`` /
``decode_cursor`` の入出力を Pydantic / dataclass に拡張する。
"""

from __future__ import annotations

import base64
from dataclasses import dataclass


@dataclass(frozen=True)
class Cursor:
    """ID-only cursor. SPEC §5.4 でのカーソル方式の最小実装."""

    id: int


def encode_cursor(tweet_id: int) -> str:
    """``tweet_id`` を url-safe base64 で encode する.

    数値そのままだと簡単に URL から推測できるが、これは「順序情報の隠蔽」
    ではなく「不透明性によりクライアントが ID 順を前提にしないため」の
    シリアライゼーション。セキュリティ目的の暗号化ではない。
    """
    raw = str(tweet_id).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(token: str | None) -> Cursor | None:
    """``token`` を ``Cursor`` に戻す. 不正値は ``None`` を返す."""
    if not token:
        return None
    try:
        # 末尾 padding を補完して decode
        padding = "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode((token + padding).encode("ascii"))
        return Cursor(id=int(raw.decode("utf-8")))
    except (ValueError, TypeError):
        return None
