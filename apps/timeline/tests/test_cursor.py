"""Tests for cursor encoding helpers (#200)."""

from __future__ import annotations

from apps.timeline.cursor import Cursor, decode_cursor, encode_cursor


class TestEncodeDecode:
    def test_round_trip(self):
        for tid in (1, 42, 1_000_000, 2**31 - 1):
            assert decode_cursor(encode_cursor(tid)) == Cursor(id=tid)

    def test_decode_returns_none_for_empty(self):
        assert decode_cursor("") is None
        assert decode_cursor(None) is None

    def test_decode_returns_none_for_garbage(self):
        assert decode_cursor("not-base64-!!@@") is None
        assert decode_cursor("aGVsbG8=") is None  # decodes to "hello", non-int

    def test_encoded_cursor_is_url_safe(self):
        token = encode_cursor(123_456_789)
        # base64 url-safe character class only
        assert all(c.isalnum() or c in "-_" for c in token)

    def test_encoded_cursor_strips_padding(self):
        token = encode_cursor(7)
        assert "=" not in token
