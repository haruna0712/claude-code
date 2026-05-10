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

# security-reviewer #542 CRITICAL C-1: markdown2 の blockquote パーサは Python
# 再帰実装で、163+ 段ネストすると RecursionError でワーカーが落ちる。
# body_markdown に長さ + ネスト深さの両ガードをかけて DoS を遮断する。
_MAX_BODY_BYTES = 100_000  # 100KB は SPEC §12 上の長文記事でも十分な上限
_MAX_BLOCKQUOTE_DEPTH = 20  # Zenn / Qiita でも 5 段以上はまず無い、安全に余裕を持たせる
# `> ` 連続行の数を数えるため line head で `^` プレースホルダ
_BLOCKQUOTE_DEPTH_RE = re.compile(r"^(?:>\s*)+", re.MULTILINE)


class MarkdownInputTooLargeError(ValueError):
    """body_markdown が _MAX_BODY_BYTES を超えたとき raise."""


class MarkdownNestingTooDeepError(ValueError):
    """blockquote ネスト深さが _MAX_BLOCKQUOTE_DEPTH を超えたとき raise."""


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
    href = attrs.get(href_key)
    if href is None:
        return attrs
    # security-reviewer #542 MEDIUM M-1: 同ページアンカー (`#xxx`) に
    # target="_blank" を付けると ToC 系のリンクで新タブが開いて UX が崩れる。
    # rel も nofollow 不要なのでスキップ。
    if href.startswith("#"):
        return attrs
    attrs[(None, "target")] = "_blank"
    attrs[(None, "rel")] = " ".join(_LINKIFY_REL_VALUES)
    return attrs


# security-reviewer #542 MEDIUM M-3: <noscript> / <style> / <script> ブロックは
# bleach の strip でタグだけ消すと中身の HTML が残ってしまう。allowlist が
# 将来広がったときに「noscript の中に隠した攻撃」 が顕在化するため、bleach
# 前段でブロック全体を除去する。apps/tweets/rendering.py と同 pattern。
_SCRIPTING_BLOCK_RE = re.compile(
    r"<(script|style|noscript)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)


def _strip_scripting_blocks(html: str) -> str:
    """`<script>` / `<style>` / `<noscript>` を中身ごと除去 (前処理)."""

    if not html:
        return html
    return _SCRIPTING_BLOCK_RE.sub("", html)


def _build_markdown() -> markdown2.Markdown:
    """markdown2.Markdown インスタンス生成 (footnotes 連番が混ざらないよう毎回新規)."""

    return markdown2.Markdown(extras=_MARKDOWN_EXTRAS)


def _enforce_input_limits(source: str) -> None:
    """body_markdown の DoS ガード (security-reviewer #542 CRITICAL C-1).

    - サイズ: 100KB 超は MarkdownInputTooLargeError
    - blockquote ネスト深さ: 20 段超は MarkdownNestingTooDeepError
      (markdown2 の blockquote パーサが Python 再帰で、163+ 段で RecursionError)
    """

    if len(source.encode("utf-8")) > _MAX_BODY_BYTES:
        raise MarkdownInputTooLargeError(
            f"body_markdown のサイズが上限 ({_MAX_BODY_BYTES} bytes) を超えています"
        )
    # `> ` を連続でカウント。各行の最大段数を取得して上限と比較。
    max_depth = 0
    for match in _BLOCKQUOTE_DEPTH_RE.finditer(source):
        depth = match.group(0).count(">")
        if depth > max_depth:
            max_depth = depth
    if max_depth > _MAX_BLOCKQUOTE_DEPTH:
        raise MarkdownNestingTooDeepError(
            f"blockquote ネスト深さが上限 ({_MAX_BLOCKQUOTE_DEPTH}) を超えています"
        )


def render_article_markdown(source: str) -> str:
    """Article body の Markdown をサニタイズ済 HTML に変換する.

    パイプライン:
        0. 入力サイズ + ネスト深さの DoS ガード (CRITICAL C-1)
        1. markdown2 で HTML 化 (extras: 段落、コードブロック、表、脚注)
        2. <script>/<style>/<noscript> ブロックを中身ごと除去 (M-3)
        3. bleach.clean で settings.MARKDOWN_BLEACH_* 準拠の allowlist
        4. protocol-relative URL を post-process で除去
        5. bleach.linkify で URL を <a target="_blank" rel="..."> に

    Raises:
        MarkdownInputTooLargeError / MarkdownNestingTooDeepError:
            ガードに引っかかった場合 (view 層で 400 にハンドリングする想定)
    """

    if not source:
        return ""

    _enforce_input_limits(source)

    converter = _build_markdown()
    rendered_html = converter.convert(source)

    rendered_html = _strip_scripting_blocks(rendered_html)

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
