"""Tests for `apps/articles/services/markdown.py` (#525 / Phase 6 P6-02).

docs/issues/phase-6.md P6-02 受け入れ基準:
- `<script>` / `javascript:` / `onerror=` / `<iframe>` 等が全て除去される
- fenced code block (```python ... ```) が `<pre><code class="language-python">`
  でハイライト出力 (frontend Shiki 用)
- 通常の Markdown (h2、リスト、リンク、画像、表) が崩れず出力
- `Article.save()` で body_html が自動生成される

XSS テストセットは OWASP XSS Filter Evasion Cheat Sheet からピックアップ。
"""

from __future__ import annotations

import pytest

from apps.articles.services.markdown import render_article_markdown

# ----------------------------------------------------------------------
# 基本的な Markdown 描画
# ----------------------------------------------------------------------


def test_empty_input_returns_empty_string() -> None:
    assert render_article_markdown("") == ""


def test_paragraph_kept_as_block() -> None:
    """tweets と異なり break-on-newline は OFF。段落構造は保持."""

    html = render_article_markdown("hello\nworld\n\nsecond paragraph")
    # 単一改行は <br> ではなく空白扱い (markdown2 デフォルト)
    assert "<br" not in html
    assert html.count("<p>") == 2


def test_heading_levels() -> None:
    html = render_article_markdown("# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6")
    for level in range(1, 7):
        assert f"<h{level}>" in html


def test_unordered_list() -> None:
    html = render_article_markdown("- a\n- b\n- c")
    assert html.count("<li>") == 3
    assert "<ul>" in html


def test_ordered_list() -> None:
    html = render_article_markdown("1. a\n2. b\n3. c")
    assert html.count("<li>") == 3
    assert "<ol>" in html


def test_inline_link_with_target_and_rel() -> None:
    html = render_article_markdown("[example](https://example.com)")
    assert 'href="https://example.com"' in html
    # target-blank-links extra で target="_blank" rel="noopener" が付く
    assert 'target="_blank"' in html
    assert "noopener" in html


def test_image_with_https_src_kept() -> None:
    html = render_article_markdown("![alt](https://cdn.example.com/x.png)")
    assert "<img" in html
    assert 'src="https://cdn.example.com/x.png"' in html


def test_blockquote() -> None:
    html = render_article_markdown("> quoted")
    assert "<blockquote>" in html


def test_horizontal_rule() -> None:
    html = render_article_markdown("---\n")
    assert "<hr" in html


def test_table() -> None:
    md = "| a | b |\n|---|---|\n| 1 | 2 |"
    html = render_article_markdown(md)
    assert "<table>" in html
    assert "<th>" in html
    assert "<td>" in html


def test_inline_code() -> None:
    html = render_article_markdown("use `print(x)` here")
    assert "<code>print(x)</code>" in html


def test_fenced_code_block_with_language_class() -> None:
    """frontend Shiki が `class="language-python"` を見るので必須."""

    md = "```python\nx = 1\n```"
    html = render_article_markdown(md)
    assert "<pre>" in html
    assert "<code" in html
    assert "language-python" in html


def test_strikethrough() -> None:
    html = render_article_markdown("~~old~~")
    assert "<s>" in html or "<strike>" in html or "<del>" in html


def test_strong_and_emphasis() -> None:
    html = render_article_markdown("**bold** and *italic*")
    assert "<strong>" in html
    assert "<em>" in html


# ----------------------------------------------------------------------
# XSS payload tests (OWASP Cheat Sheet ベース、30+ ケース)
# ----------------------------------------------------------------------


XSS_PAYLOADS_NEUTRALIZED = [
    # 1. 直接 script tag
    "<script>alert(1)</script>",
    # 2. 大文字
    "<SCRIPT>alert(1)</SCRIPT>",
    # 3. 改行混入
    "<scr\nipt>alert(1)</script>",
    # 4. 属性 onerror
    '<img src="x" onerror="alert(1)">',
    # 5. 属性 onload
    '<body onload="alert(1)">',
    # 6. javascript: スキーム
    "[link](javascript:alert(1))",
    # 7. JAVASCRIPT: 大文字
    "[link](JAVASCRIPT:alert(1))",
    # 8. data: URI
    "[link](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    # 9. vbscript:
    "[link](vbscript:msgbox(1))",
    # 10. SVG payload
    '<svg onload="alert(1)">',
    # 11. iframe
    '<iframe src="javascript:alert(1)"></iframe>',
    # 12. object
    '<object data="evil.swf"></object>',
    # 13. embed
    '<embed src="evil.swf">',
    # 14. base href hijack
    '<base href="https://evil.com/">',
    # 15. meta refresh
    '<meta http-equiv="refresh" content="0; url=https://evil.com">',
    # 16. form action
    '<form action="https://evil.com" method="POST"><input/></form>',
    # 17. style with expression()
    '<div style="background:url(javascript:alert(1))">',
    # 18. expression() in attr
    '<div style="width:expression(alert(1))">x</div>',
    # 19. behavior
    '<div style="behavior:url(evil.htc)">x</div>',
    # 20. img src=javascript:
    '<img src="javascript:alert(1)">',
    # 21. event onclick
    '<div onclick="alert(1)">x</div>',
    # 22. event onmouseover
    '<a href="#" onmouseover="alert(1)">x</a>',
    # 23. event onfocus
    '<input onfocus="alert(1)" autofocus>',
    # 24. <link rel=stylesheet>
    '<link rel="stylesheet" href="https://evil.com/x.css">',
    # 25. video poster
    '<video><source onerror="alert(1)"></video>',
    # 26. CSS @import (内側)
    '<style>@import "https://evil.com/x.css";</style>',
    # 27. xmlns alt
    '<x xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)">x</a></x>',
    # 28. mathml
    '<math><mtext><a href="javascript:alert(1)">click</a></mtext></math>',
    # 29. noscript escape
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>',
    # 30. comment hiding script (ブラウザは comment 内 script を実行しないが、
    #     bleach が comment を残してしまうと CSS で見せる手口に悪用される)
    "<!--<script>alert(1)</script>-->",
    # 31. button formaction
    '<button formaction="javascript:alert(1)">x</button>',
    # 32. <a href> with whitespace before scheme
    "[link]( javascript:alert(1) )",
]


@pytest.mark.parametrize("payload", XSS_PAYLOADS_NEUTRALIZED)
def test_xss_payload_neutralized(payload: str) -> None:
    """全ペイロードについて: render 後に script 系 / on*= / javascript: が残らない."""

    html = render_article_markdown(payload)
    lower = html.lower()
    # 攻撃に直接結びつく文字列が全て無いことを assert
    assert "<script" not in lower
    assert "</script" not in lower
    assert "javascript:" not in lower
    assert "vbscript:" not in lower
    assert "data:text/html" not in lower
    assert "<iframe" not in lower
    assert "<object" not in lower
    assert "<embed" not in lower
    assert "<base" not in lower
    assert "<meta" not in lower
    assert "<form" not in lower
    assert "<link" not in lower
    assert "<style" not in lower
    assert "<noscript" not in lower
    assert "<!--" not in lower  # comment は strip_comments=True で消える想定
    assert "onerror=" not in lower
    assert "onload=" not in lower
    assert "onclick=" not in lower
    assert "onmouseover=" not in lower
    assert "onfocus=" not in lower
    assert "expression(" not in lower
    assert "behavior:" not in lower
    assert "formaction=" not in lower


def test_protocol_relative_url_in_image_stripped() -> None:
    """`//evil.example` 形式の protocol-relative は post-process で削除."""

    html = render_article_markdown("![](//evil.example/x.gif)")
    assert "//evil.example" not in html


def test_protocol_relative_url_in_link_stripped() -> None:
    html = render_article_markdown("[link](//evil.example)")
    assert 'href="//evil.example"' not in html


# ----------------------------------------------------------------------
# Article.save() で body_html が自動生成される
# ----------------------------------------------------------------------


@pytest.mark.django_db
def test_article_save_renders_body_html() -> None:
    from django.contrib.auth import get_user_model

    from apps.articles.models import Article

    User = get_user_model()
    user = User.objects.create_user(
        username="alice",
        email="alice@example.com",
        password="testpass123",  # pragma: allowlist secret
        first_name="A",
        last_name="L",
    )
    article = Article.objects.create(
        author=user,
        slug="hello",
        title="Hello",
        body_markdown="# Heading\n\nbody **bold**",
    )
    assert "<h1>" in article.body_html
    assert "<strong>" in article.body_html


@pytest.mark.django_db
def test_article_save_neutralizes_xss_in_body_markdown() -> None:
    from django.contrib.auth import get_user_model

    from apps.articles.models import Article

    User = get_user_model()
    user = User.objects.create_user(
        username="bob",
        email="bob@example.com",
        password="testpass123",  # pragma: allowlist secret
        first_name="B",
        last_name="L",
    )
    article = Article.objects.create(
        author=user,
        slug="xss-test",
        title="x",
        body_markdown="<script>alert(1)</script>safe",
    )
    assert "<script" not in article.body_html.lower()
    assert "safe" in article.body_html


@pytest.mark.django_db
def test_article_comment_save_renders_body_html() -> None:
    from django.contrib.auth import get_user_model

    from apps.articles.models import Article, ArticleComment

    User = get_user_model()
    user = User.objects.create_user(
        username="carol",
        email="carol@example.com",
        password="testpass123",  # pragma: allowlist secret
        first_name="C",
        last_name="L",
    )
    article = Article.objects.create(author=user, slug="commented", title="C", body_markdown="x")
    comment = ArticleComment.objects.create(
        article=article,
        author=user,
        body="**bold** comment with `code`",
    )
    assert "<strong>" in comment.body_html
    assert "<code>" in comment.body_html
