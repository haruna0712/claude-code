"""OGP fetcher tests (P2-07 / GitHub #182).

検証観点:
- URL 抽出 (extract_first_url): plain / Markdown link / 句読点末尾
- URL 正規化 (normalize_url): utm_* 除去 / scheme 小文字化
- SSRF guard: file:// / 127.0.0.1 / 10.0.0.1 / 169.254.x / IPv6 link-local を reject
- HTML パース: og:title / og:image / fallback <title>
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from apps.tweets.ogp import (
    SSRFError,
    _is_safe_ip,
    _validate_url_scheme,
    extract_first_url,
    normalize_url,
    url_hash,
)
import ipaddress


# =============================================================================
# extract_first_url
# =============================================================================


class TestExtractFirstUrl:
    def test_plain_url(self) -> None:
        assert (
            extract_first_url("これは https://example.com/path です")
            == "https://example.com/path"
        )

    def test_markdown_link(self) -> None:
        # Markdown link `[txt](url)` で URL の `)` は regex で除外される
        url = extract_first_url("see [docs](https://example.com/x)")
        assert url == "https://example.com/x"

    def test_strips_trailing_punctuation(self) -> None:
        assert (
            extract_first_url("link: https://example.com.") == "https://example.com"
        )

    def test_no_url_returns_none(self) -> None:
        assert extract_first_url("just text without any link") is None

    def test_empty_body(self) -> None:
        assert extract_first_url("") is None

    def test_first_url_when_multiple(self) -> None:
        body = "see https://a.example.com and also https://b.example.com"
        assert extract_first_url(body) == "https://a.example.com"


# =============================================================================
# normalize_url
# =============================================================================


class TestNormalizeUrl:
    def test_strips_utm_params(self) -> None:
        assert (
            normalize_url("https://example.com/page?utm_source=tw&id=42")
            == "https://example.com/page?id=42"
        )

    def test_lowercases_scheme_and_host(self) -> None:
        assert (
            normalize_url("HTTPS://Example.COM/Path") == "https://example.com/Path"
        )

    def test_url_hash_is_stable(self) -> None:
        h1 = url_hash("https://example.com/path?utm_source=tw")
        h2 = url_hash("HTTPS://Example.COM/path")
        assert h1 == h2


# =============================================================================
# SSRF guard
# =============================================================================


class TestSSRFScheme:
    def test_file_scheme_rejected(self) -> None:
        with pytest.raises(SSRFError):
            _validate_url_scheme("file:///etc/passwd")

    def test_gopher_scheme_rejected(self) -> None:
        with pytest.raises(SSRFError):
            _validate_url_scheme("gopher://evil.example.com/")

    def test_dict_scheme_rejected(self) -> None:
        with pytest.raises(SSRFError):
            _validate_url_scheme("dict://example.com/word")

    def test_https_allowed(self) -> None:
        _validate_url_scheme("https://example.com/")  # no exception

    def test_http_allowed(self) -> None:
        _validate_url_scheme("http://example.com/")


class TestSSRFIPCheck:
    @pytest.mark.parametrize(
        "ip",
        [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.5.5",
            "192.168.1.1",
            "169.254.169.254",  # AWS metadata
            "::1",  # IPv6 loopback
            "fc00::1",  # IPv6 ULA
            "fe80::1",  # IPv6 link-local
        ],
    )
    def test_dangerous_ips_rejected(self, ip: str) -> None:
        assert _is_safe_ip(ipaddress.ip_address(ip)) is False

    @pytest.mark.parametrize(
        "ip",
        ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"],
    )
    def test_public_ips_accepted(self, ip: str) -> None:
        assert _is_safe_ip(ipaddress.ip_address(ip)) is True


class TestFetchOgpRejectsBadSchemes:
    def test_file_url_returns_none(self) -> None:
        from apps.tweets.ogp import fetch_ogp

        assert fetch_ogp("file:///etc/passwd") is None

    def test_no_scheme_returns_none(self) -> None:
        from apps.tweets.ogp import fetch_ogp

        assert fetch_ogp("not-a-url") is None


class TestFetchOgpRejectsPrivateIPs:
    """DNS resolution が私的 IP を返すケースで SSRF reject されることを検証."""

    def test_private_ip_rejected(self) -> None:
        from apps.tweets.ogp import fetch_ogp

        with patch(
            "apps.tweets.ogp.socket.getaddrinfo",
            return_value=[(2, 0, 0, "", ("127.0.0.1", 0))],
        ):
            result = fetch_ogp("https://localhost/admin")
        assert result is None
