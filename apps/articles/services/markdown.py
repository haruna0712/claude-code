"""Article 用 Markdown → HTML サニタイザ (#525 / Phase 6 P6-02).

docs/issues/phase-6.md P6-02 + SPEC §12 通り。

apps/tweets/rendering.py との関係:
    - bleach allowlist (`settings.MARKDOWN_BLEACH_*`) は記事 / ツイート共通。
    - markdown2 の extras だけ記事用に変える:
        * `break-on-newline` は **使わない** (記事は段落構造を保持するため、
          単一改行を <br> に変換しない)
    - protocol-relative URL の除去 + linkify rel 強制は同じ pattern を踏襲。

公開 API:
    - `render_article_markdown(source: str) -> str`

セキュリティ:
    - `<script>` `<iframe>` `<object>` `javascript:` `data:` は bleach で除去
    - `//evil.com/x` (protocol-relative) は post-process で属性ごと除去
    - `<a>` には `rel="nofollow noopener noreferrer"` + `target="_blank"` 強制
    - XSS テストセット (test_markdown.py) で OWASP Cheat Sheet 30+ ペイロードを検証
"""

from __future__ import annotations

import re
from typing import Any

import bleach
import markdown2
from django.conf import settings

# 記事用 markdown2 extras。tweets と異なり break-on-newline は使わず段落保持。
# - fenced-code-blocks: ```lang\n...\n``` を <pre><code> に変換
# - highlightjs-lang:   ↑ の出力に `class="language-xxx"` を付与 (frontend Shiki 用)
# - code-friendly:      `_` で囲ったテキストを強調にしない (変数名保持)
# - tables:             パイプ記法のテーブル
# - strike:             ~~text~~ → <s>text</s>
# - target-blank-links: 外部 <a> に target="_blank" rel="noopener" 付与
# - footnotes:          記事は脚注を許可 (ツイートでは不要)
# - cuddled-lists:      リスト間に空行が無いケースもパース
_MARKDOWN_EXTRAS: dict[str, Any] = {
    "fenced-code-blocks": {},
    "highlightjs-lang": None,
    "code-friendly": None,
    "tables": None,
    "strike": None,
    "target-blank-links": None,
    "footnotes": None,
    "cuddled-lists": None,
}

# linkify が <a> に強制付与する rel 値。XSS / open-redirect 防御の最低ライン。
_LINKIFY_REL_VALUES = ("nofollow", "noopener", "noreferrer")

# bleach allowlist は通っても `src="//evil"` のような protocol-relative URL は
# 素通りしてしまう (apps/tweets/rendering.py と同じ問題)。後段で属性ごと除去。
_PROTOCOL_RELATIVE_ATTR_RE = re.compile(
    r'\s(src|href)="//[^"]*"',
    re.IGNORECASE,
)


def _strip_protocol_relative_urls(html: str) -> str:
    """`src="//..."` / `href="//..."` 属性を除去する."""

    if not html:
        return html
    return _PROTOCOL_RELATIVE_ATTR_RE.sub("", html)


def _linkify_callback(attrs: dict, new: bool = False) -> dict:
    """linkify した <a> に target/rel を強制付与する."""

    href_key = (None, "href")
    if attrs.get(href_key) is None:
        # bleach 内部で 一時的に href が無いケースが起こるため安全側へ
        return attrs
    attrs[(None, "target")] = "_blank"
    attrs[(None, "rel")] = " ".join(_LINKIFY_REL_VALUES)
    return attrs


def _build_markdown() -> markdown2.Markdown:
    """markdown2.Markdown インスタンス生成 (footnotes 連番が混ざらないよう毎回新規)."""

    return markdown2.Markdown(extras=_MARKDOWN_EXTRAS)


def render_article_markdown(source: str) -> str:
    """Article body の Markdown をサニタイズ済 HTML に変換する.

    パイプライン:
        1. markdown2 で HTML 化 (extras: 段落、コードブロック、表、脚注)
        2. bleach.clean で settings.MARKDOWN_BLEACH_* 準拠の allowlist
        3. protocol-relative URL を post-process で除去
        4. bleach.linkify で URL を <a target="_blank" rel="..."> に
    """

    if not source:
        return ""

    converter = _build_markdown()
    rendered_html = converter.convert(source)

    sanitized = bleach.clean(
        rendered_html,
        tags=settings.MARKDOWN_BLEACH_ALLOWED_TAGS,
        attributes=settings.MARKDOWN_BLEACH_ALLOWED_ATTRS,
        protocols=settings.MARKDOWN_BLEACH_ALLOWED_PROTOCOLS,
        strip=True,  # 不許可タグは中身だけ残し外枠除去
        strip_comments=True,
    )

    sanitized = _strip_protocol_relative_urls(sanitized)

    linkified = bleach.linkify(
        sanitized,
        callbacks=[_linkify_callback],
        skip_tags=["pre", "code"],  # コード内 URL は自動リンクしない
    )

    return linkified
