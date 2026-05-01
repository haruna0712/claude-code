"""Tests for the search query parser (P2-12 / Issue #206)."""

from __future__ import annotations

from datetime import date

from apps.search.parser import parse_search_query


class TestKeywordOnly:
    def test_empty_returns_empty_struct(self):
        p = parse_search_query("")
        assert p.keywords == ""
        assert p.tags == []
        assert p.from_handle is None
        assert p.type is None
        assert p.has == []

    def test_plain_keywords_pass_through(self):
        p = parse_search_query("python rust ruby")
        assert p.keywords == "python rust ruby"


class TestTag:
    def test_single_tag(self):
        p = parse_search_query("hello tag:django")
        assert p.tags == ["django"]
        assert p.keywords == "hello"

    def test_multiple_tags(self):
        p = parse_search_query("tag:django tag:python")
        assert p.tags == ["django", "python"]
        assert p.keywords == ""

    def test_strips_leading_hash_and_lowercases(self):
        p = parse_search_query("tag:#Django")
        assert p.tags == ["django"]


class TestFromHandle:
    def test_handle(self):
        p = parse_search_query("from:alice")
        assert p.from_handle == "alice"

    def test_handle_with_at_prefix(self):
        p = parse_search_query("from:@alice")
        assert p.from_handle == "alice"

    def test_invalid_handle_dropped(self):
        # ハイフンや記号を含む handle は regex 不適合で drop される
        p = parse_search_query("from:bad-handle!")
        assert p.from_handle is None


class TestDateRange:
    def test_since(self):
        p = parse_search_query("since:2026-01-15")
        assert p.since == date(2026, 1, 15)

    def test_until(self):
        p = parse_search_query("until:2026-12-31")
        assert p.until == date(2026, 12, 31)

    def test_invalid_date_dropped(self):
        p = parse_search_query("since:2026-13-99")
        assert p.since is None

    def test_garbage_date_dropped(self):
        p = parse_search_query("since:yesterday")
        assert p.since is None


class TestType:
    def test_valid_type(self):
        for kind in ("original", "reply", "repost", "quote"):
            p = parse_search_query(f"type:{kind}")
            assert p.type == kind

    def test_invalid_type_dropped(self):
        p = parse_search_query("type:foo")
        assert p.type is None


class TestHas:
    def test_image(self):
        p = parse_search_query("has:image")
        assert p.has == ["image"]

    def test_code(self):
        p = parse_search_query("has:code")
        assert p.has == ["code"]

    def test_dedup(self):
        p = parse_search_query("has:image has:image has:code")
        assert p.has == ["image", "code"]

    def test_invalid_has_dropped(self):
        p = parse_search_query("has:link")
        assert p.has == []


class TestComposite:
    def test_full_query(self):
        p = parse_search_query(
            "python tag:django from:alice since:2026-01-01 until:2026-12-31 type:reply has:image"
        )
        assert p.keywords == "python"
        assert p.tags == ["django"]
        assert p.from_handle == "alice"
        assert p.since == date(2026, 1, 1)
        assert p.until == date(2026, 12, 31)
        assert p.type == "reply"
        assert p.has == ["image"]

    def test_unknown_operator_kept_as_keyword(self):
        p = parse_search_query("hello unknown:foo world")
        # unknown:foo は token として keywords に残る
        assert "unknown:foo" in p.keywords.split()
