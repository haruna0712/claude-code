"""ツイート本文の「見た目の文字数」を数えるユーティリティ (P1-10 / SPEC §3.3)。

SPEC §3.3 に基づき、ツイート本文の 180 字制限を以下のルールで計算する:

- URL (http/https) は一律 ``URL_LENGTH`` (=23) 字に換算する。
- Markdown 記号 (``**``, ``##``, ``-``, ``>``, バッククォート等) はカウントしない。
- コードブロック / インラインコードの「中身」は通常どおりカウントする
  (マーカー (`` ``` ``, `` ` ``) のみ除去する)。
- 改行文字は 1 字として数える。
- 絵文字 1 つの数え方は **Unicode codepoint 数** (``len(str)``) とする
  (grapheme cluster ベースではない点に注意)。
    - Python 標準ライブラリのみで実装するため。grapheme cluster 単位で
      厳密に数える必要が生じたら ``regex`` パッケージ導入を別途検討する。
    - BMP 内の絵文字 (``🎉`` など) は codepoint 1 なので 1 字となり
      SPEC §3.3 の「絵文字 1 つは 1 字」要件を満たす。SKIN TONE 等の ZWJ
      シーケンスは複数 codepoint になる点を docstring に明記しておく。

本モジュールは **Backend 側の実装**。Frontend 側 (P1-16) は TypeScript で
同じロジックを再実装する (``docs/operations/tweet-char-count.md`` 参照)。
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# 公開定数
# ---------------------------------------------------------------------------

#: URL 1 件あたりの換算文字数 (SPEC §3.3)。
URL_LENGTH: int = 23

#: ツイート本文の上限文字数 (SPEC §3)。
TWEET_MAX_CHARS: int = 180


# ---------------------------------------------------------------------------
# 内部 regex
# ---------------------------------------------------------------------------

# URL 抽出: http(s)://... をスペース区切りの 1 トークンとして拾う。
# ただし Markdown リンク構文 ``[label](url)`` と共存するため、
# 閉じ括弧 ``)`` と閉じ角括弧 ``]`` は URL に含めない (そこで切る)。
# これにより ``[label](https://example.com)`` の URL 部分が ``)`` を含まず
# 純粋な URL として抽出される。ツイート本文で URL に生 ``)`` を含める用途は
# 稀だが、必要なら ``<url>`` 形式などで回避する運用前提。
_URL_RE: re.Pattern[str] = re.compile(r"https?://[^\s)\]]+", re.IGNORECASE)

# URL を一時的に 1 文字の placeholder に置き換えてから Markdown 記号除去を
# かける。Markdown 記号除去で誤って URL の `_` / `*` / `~` を削らないため。
# U+0000 (NUL) は通常のテキストに現れないので安全。
_URL_PLACEHOLDER: str = "\x00"

# Markdown 記号 — 各パターンは「マーカーだけ削り、中身は残す」のが基本方針。
# ただし「行頭プレフィクス」 (見出し・リスト・引用) は行頭トークンごと削る。

# 画像 `![alt](url)` — alt だけ残す。url は既に placeholder 化されている。
_IMAGE_RE: re.Pattern[str] = re.compile(r"!\[([^\]]*)\]\([^)]*\)")

# リンク `[label](url)` — label だけ残し、url は placeholder のまま残す。
# Markdown の仕様上 label と url の間に空白は入らない。
_LINK_RE: re.Pattern[str] = re.compile(r"\[([^\]]*)\]\(([^)]*)\)")

# 強調・打ち消し・インラインコード。いずれも「マーカーだけ削る」。
# 非貪欲マッチで最短の対にしておく。
_STRONG_ASTERISK_RE: re.Pattern[str] = re.compile(r"\*\*(.+?)\*\*")
_STRONG_UNDERSCORE_RE: re.Pattern[str] = re.compile(r"__(.+?)__")
_EM_ASTERISK_RE: re.Pattern[str] = re.compile(r"\*(.+?)\*")
_EM_UNDERSCORE_RE: re.Pattern[str] = re.compile(r"_(.+?)_")
_STRIKE_RE: re.Pattern[str] = re.compile(r"~~(.+?)~~")
_INLINE_CODE_RE: re.Pattern[str] = re.compile(r"`([^`]+)`")

# 行頭トークン (見出し・リスト・引用・水平線)。`re.MULTILINE` 前提。
_HEADING_RE: re.Pattern[str] = re.compile(r"^#{1,6}\s+", re.MULTILINE)
_BULLET_RE: re.Pattern[str] = re.compile(r"^\s*[-*+]\s+", re.MULTILINE)
_NUMBERED_RE: re.Pattern[str] = re.compile(r"^\s*\d+\.\s+", re.MULTILINE)
_QUOTE_RE: re.Pattern[str] = re.compile(r"^\s*>+\s*", re.MULTILINE)
_HR_RE: re.Pattern[str] = re.compile(r"^\s*-{3,}\s*$", re.MULTILINE)

# フェンスコード開始・終了行 (``` または ```lang)。行ごと削る。
_FENCE_RE: re.Pattern[str] = re.compile(r"^\s*`{3,}[^\n]*$", re.MULTILINE)


# ---------------------------------------------------------------------------
# 公開関数
# ---------------------------------------------------------------------------


def count_tweet_chars(source: str) -> int:
    """ツイート本文の「見た目の文字数」を返す。

    処理順:

    1. URL (http/https) を抽出し、``URL_LENGTH`` (=23) 文字ぶん予約する。
       URL 本体は placeholder 1 文字に置換しておく。
    2. Markdown 記号を除去する (マーカーのみ除去し、中身は残す)。
    3. 残った placeholder を ``URL_LENGTH`` に展開したのと同じ字数になるよう
       加算する (実際には placeholder 数 × ``URL_LENGTH`` を足し、
       placeholder 自身の文字数 1 を引くことで等価に計算する)。
    4. 最終的な codepoint 数を返す (``len``)。

    :param source: Markdown 原文。``None`` は想定せず、空文字列は 0 を返す。
    :returns: カウント結果 (非負整数)。
    """

    if not source:
        return 0

    # --- 1. URL を placeholder に退避 -----------------------------------
    # placeholder 1 文字あたり「実際は 23 字」と後で換算するため、件数を数える。
    url_matches = _URL_RE.findall(source)
    url_count = len(url_matches)
    text = _URL_RE.sub(_URL_PLACEHOLDER, source)

    # --- 2. Markdown 記号を除去 ----------------------------------------
    # 行頭プレフィクス (削除) — フェンスは Atx 見出しと衝突しないが、
    # 順序としてはフェンス → 見出し → リスト → 引用 → 水平線 の順で処理する。
    text = _FENCE_RE.sub("", text)
    text = _HR_RE.sub("", text)
    text = _HEADING_RE.sub("", text)
    # 番号付きリストは "-* +" 記号との衝突がないので先に落として良い。
    text = _NUMBERED_RE.sub("", text)
    text = _BULLET_RE.sub("", text)
    text = _QUOTE_RE.sub("", text)

    # インライン系 (マーカーだけ削って中身を残す) — 画像 → リンク の順が必須
    # (`!` を先に処理しないと画像がリンクとしてマッチしてしまう)。
    text = _IMAGE_RE.sub(r"\1", text)
    text = _LINK_RE.sub(r"\1", text)

    # 強調系は **/__ を先に落とさないと */_ 1 対で切られてしまうので順序重要。
    text = _STRONG_ASTERISK_RE.sub(r"\1", text)
    text = _STRONG_UNDERSCORE_RE.sub(r"\1", text)
    text = _EM_ASTERISK_RE.sub(r"\1", text)
    text = _EM_UNDERSCORE_RE.sub(r"\1", text)

    text = _STRIKE_RE.sub(r"\1", text)
    text = _INLINE_CODE_RE.sub(r"\1", text)

    # --- 3. URL 分を換算 -----------------------------------------------
    # placeholder は 1 文字として text 内にまだ残っている。これを 23 字扱いに
    # するため、(URL_LENGTH - 1) × url_count を加算する。
    visible_chars = len(text) + (URL_LENGTH - 1) * url_count
    return visible_chars


def is_tweet_within_limit(source: str, limit: int = TWEET_MAX_CHARS) -> bool:
    """見た目の文字数が ``limit`` 以下なら ``True``。

    :param source: Markdown 原文。
    :param limit: 上限文字数。既定は ``TWEET_MAX_CHARS`` (=180)。
    """

    return count_tweet_chars(source) <= limit
