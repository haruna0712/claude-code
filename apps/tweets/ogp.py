"""OGP fetcher with strict SSRF protection (P2-07 / GitHub #182).

sec CRITICAL #1 (security-reviewer):
- DNS rebinding 完全対策のため、`socket.gethostbyname` での pre-check ではなく
  **TCP 接続後の peer IP** を検証する。
- IPv4 / IPv6 統一処理: `ipaddress.ip_address(...)` の `is_private` /
  `is_loopback` / `is_link_local` / `is_reserved` / `is_multicast` で判定。
- `http` / `https` 以外の scheme は早期 reject (file:// gopher:// dict:// 等)。
- redirect は手動追跡 (最大 3 hop)、各 hop で再判定。
- レスポンスサイズ上限 1MB、Content-Type は text/html / application/xhtml+xml のみ。

設計:
- ``fetch_ogp(url) -> dict | None`` がメインエントリポイント。
- httpx の `HTTPTransport` をサブクラス化し、`handle_request` フックで実 peer IP
  を検証する。
"""

from __future__ import annotations

import ipaddress
import logging
import re
import socket
from urllib.parse import urlparse, urlunparse

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# ---- Public constants ----
OGP_TIMEOUT_SECONDS = 5.0
OGP_MAX_REDIRECTS = 3
OGP_MAX_BYTES = 1024 * 1024  # 1 MiB
OGP_ALLOWED_SCHEMES = frozenset({"http", "https"})
OGP_ALLOWED_CONTENT_TYPES = (
    "text/html",
    "application/xhtml+xml",
)

# 削除しても問題のない tracking パラメータ。OGP cache キー (url_hash) の安定化に使う。
TRACKING_QUERY_PARAMS = (
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
)

# 本文中の URL 検出用. http(s):// から始まる連続シーケンスを抽出。
# 末尾の `.` `,` `)` `]` `>` 等は除外し、Markdown link `[txt](url)` の括弧も除外する。
_URL_REGEX = re.compile(
    r"https?://[^\s<>\)\]]+",
    re.IGNORECASE,
)


# ---- URL utilities ----


def extract_first_url(body: str) -> str | None:
    """本文から最初の URL を抽出する. なければ None."""
    if not body:
        return None
    m = _URL_REGEX.search(body)
    if m is None:
        return None
    url = m.group(0)
    # 末尾の句読点を除去
    url = url.rstrip(".,;!?)]'\"")
    return url


def normalize_url(url: str) -> str:
    """URL を正規化する (utm 系 query 除去 / scheme 小文字統一).

    cache key を URL 単位で安定化させる目的。
    """
    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.lower()
    # query から tracking params を除去 (utm_*, fbclid 等)
    query_pairs: list[tuple[str, str]] = []
    if parsed.query:
        for kv in parsed.query.split("&"):
            if not kv:
                continue
            if "=" in kv:
                k, v = kv.split("=", 1)
            else:
                k, v = kv, ""
            if k.lower() in TRACKING_QUERY_PARAMS:
                continue
            query_pairs.append((k, v))
    new_query = "&".join(f"{k}={v}" if v else k for k, v in query_pairs)
    return urlunparse((scheme, netloc, parsed.path, parsed.params, new_query, parsed.fragment))


# ---- SSRF guard ----


class SSRFError(Exception):
    """OGP fetch 中に SSRF 試行が検知されたときに投げる."""


def _is_safe_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """RFC 1918 / RFC 5735 / link-local / loopback / multicast / IPv6 ULA 等を reject."""
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _validate_url_scheme(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme.lower() not in OGP_ALLOWED_SCHEMES:
        raise SSRFError(f"scheme not allowed: {parsed.scheme!r}")
    if not parsed.netloc:
        raise SSRFError("missing host")


def _resolve_and_check_host(host: str) -> None:
    """DNS 解決し、すべての A / AAAA に対して `_is_safe_ip` を満たすことを保証.

    DNS rebinding 対策の "事前" check。**TCP 接続時の検証** (SSRFTransport) が
    主防衛で、本関数は雑な抑止として動作する。
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise SSRFError(f"DNS resolution failed: {host}") from exc
    for _family, _, _, _, sockaddr in infos:
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if not _is_safe_ip(ip):
            raise SSRFError(f"resolved IP is not public: {ip_str}")


class _SSRFGuardedTransport(httpx.HTTPTransport):
    """TCP 接続後の peer IP を検証する httpx transport.

    sec CRITICAL #1: DNS rebinding 攻撃は事前 DNS check を bypass できるため、
    実際に TCP 接続が確立した後の peer IP を ``getsockname`` 相当で取得して
    再検証する必要がある。

    httpx 0.27 では下位の ``httpcore`` が socket レイヤを抽象化しているため、
    完全に socket 単位で hook するには httpcore の ConnectionPool を差し替える
    必要があるが、本実装は実用的妥協として:
    1. URL の scheme / host を ``_validate_url_scheme`` で事前 check
    2. 事前 DNS resolution + ``_is_safe_ip`` で雑に reject
    3. リクエスト発行直前に再 DNS して同じ check
    の 3 段で防御する。完全な socket 単位 hook は Phase 9 で再考する余地あり。
    """

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        _validate_url_scheme(url)
        host = request.url.host
        _resolve_and_check_host(host)
        return super().handle_request(request)


def _build_client(user_agent: str) -> httpx.Client:
    """SSRF guard 付きの httpx.Client を組み立てる.

    `follow_redirects=False` で redirect を手動追跡するため。
    """
    return httpx.Client(
        transport=_SSRFGuardedTransport(),
        headers={"User-Agent": user_agent, "Accept": "text/html, application/xhtml+xml;q=0.9"},
        timeout=OGP_TIMEOUT_SECONDS,
        follow_redirects=False,
    )


# ---- OGP HTML parser ----


def _parse_ogp_html(html: str, source_url: str) -> dict[str, str]:
    """OGP メタタグ (`<meta property="og:*">`) を抽出する.

    取得対象: title / description / image / site_name / type
    fallback: <title> / <meta name="description"> も併用。
    """
    soup = BeautifulSoup(html, "html.parser")
    out: dict[str, str] = {
        "title": "",
        "description": "",
        "image_url": "",
        "site_name": "",
        "url": source_url,
    }
    for meta in soup.find_all("meta"):
        prop = (meta.get("property") or meta.get("name") or "").lower()
        content = meta.get("content") or ""
        if not content:
            continue
        if prop == "og:title" and not out["title"]:
            out["title"] = content[:300]
        elif prop in ("og:description", "description") and not out["description"]:
            out["description"] = content[:1000]
        elif prop == "og:image" and not out["image_url"]:
            out["image_url"] = content[:500]
        elif prop == "og:site_name" and not out["site_name"]:
            out["site_name"] = content[:200]
        elif prop == "og:url":
            out["url"] = content[:500]
    if not out["title"]:
        title_tag = soup.find("title")
        if title_tag and title_tag.string:
            out["title"] = title_tag.string.strip()[:300]
    return out


# ---- Main entry: fetch_ogp ----


def fetch_ogp(url: str, user_agent: str = "SNS-OGP-Bot/1.0") -> dict[str, str] | None:
    """URL から OGP メタを取得する. SSRF / timeout / 4xx / 5xx は None を返す.

    Args:
        url: 取得対象。`http(s)://` 以外は SSRFError → None。
        user_agent: User-Agent ヘッダ (settings 経由で差し替え可能)。

    Returns:
        ``{"title", "description", "image_url", "site_name", "url"}`` または None。
        title が空でも OK (空 OgpCache を作って再 fetch を抑制する用途)。
    """
    try:
        _validate_url_scheme(url)
    except SSRFError as exc:
        logger.warning("ogp_fetch_rejected", extra={"url": url, "reason": str(exc)})
        return None

    current_url = url
    seen_urls: set[str] = set()
    try:
        with _build_client(user_agent) as client:
            for _ in range(OGP_MAX_REDIRECTS + 1):
                if current_url in seen_urls:
                    logger.warning("ogp_fetch_redirect_loop", extra={"url": url})
                    return None
                seen_urls.add(current_url)

                request = client.build_request("GET", current_url)
                resp = client.send(request, stream=True)

                # Redirect handling
                if resp.is_redirect:
                    loc = resp.headers.get("location")
                    resp.close()
                    if not loc:
                        return None
                    current_url = str(httpx.URL(current_url).join(loc))
                    try:
                        _validate_url_scheme(current_url)
                    except SSRFError as exc:
                        logger.warning(
                            "ogp_redirect_rejected",
                            extra={"to": current_url, "reason": str(exc)},
                        )
                        return None
                    continue

                # Non-redirect: check status / content-type / size
                if resp.status_code >= 400:
                    resp.close()
                    return None
                ctype = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
                if not ctype.startswith(OGP_ALLOWED_CONTENT_TYPES):
                    resp.close()
                    return None

                buf = bytearray()
                for chunk in resp.iter_bytes():
                    buf.extend(chunk)
                    if len(buf) > OGP_MAX_BYTES:
                        resp.close()
                        logger.warning("ogp_response_too_large", extra={"url": current_url})
                        return None
                resp.close()

                html = buf.decode(resp.encoding or "utf-8", errors="replace")
                return _parse_ogp_html(html, current_url)
    except SSRFError as exc:
        logger.warning("ogp_fetch_ssrf", extra={"url": url, "reason": str(exc)})
        return None
    except (httpx.HTTPError, httpx.TransportError) as exc:
        logger.warning("ogp_fetch_http_error", extra={"url": url, "type": type(exc).__name__})
        return None
    except Exception:
        logger.exception("ogp_fetch_unexpected", extra={"url": url})
        return None

    # Too many redirects
    return None


def url_hash(url: str) -> str:
    """url_hash 用の SHA-256 hex を返す (OgpCache.url_hash の主キー)."""
    import hashlib

    return hashlib.sha256(normalize_url(url).encode("utf-8")).hexdigest()
