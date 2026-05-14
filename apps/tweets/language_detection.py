"""Tweet 本文の言語自動検出 (Phase 13 P13-01)。

`langdetect` (Google CLD2 port、 BSD、 offline) を使う。 短文 / URL のみ /
絵文字のみは検出困難なので None を返して翻訳 button を出さない判定材料にする。

spec: docs/specs/auto-translate-spec.md §4.1
"""

from __future__ import annotations

import re

from langdetect import DetectorFactory, LangDetectException, detect

# langdetect は確率的検出で seed 依存。 同じ入力で常に同じ結果を返すよう seed
# 固定 (test stability + ユーザーが投稿と編集で言語が flicker するのを防ぐ)。
DetectorFactory.seed = 0

# 言語判定対象とする最小文字数。 これより短いと langdetect が NoLanguage feature
# の error を投げるので、 事前に弾く。
_MIN_DETECTABLE_LENGTH = 4

# URL / mention / hashtag / 絵文字を除いた「自然言語らしい」 文字列を残す regex。
_URL_RE = re.compile(r"https?://\S+")
_MENTION_RE = re.compile(r"@[A-Za-z0-9_]+")
_HASHTAG_RE = re.compile(r"#\S+")
# 絵文字を含む supplementary plane (BMP 超え) と一部記号を除外。
# 完璧な絵文字 regex は重いので、 ascii / kana / hangul / cjk を「残す」 approach に。
_NATURAL_TEXT_RE = re.compile(
    r"[ -~"  # ASCII printable
    r"À-ɏ"  # Latin Extended
    r"぀-ゟ"  # Hiragana
    r"゠-ヿ"  # Katakana
    r"㐀-䶿"  # CJK Extension A
    r"一-鿿"  # CJK Unified
    r"가-힯"  # Hangul Syllables
    r"Ͱ-Ͽ"  # Greek
    r"Ѐ-ӿ"  # Cyrillic
    r"֐-׿"  # Hebrew
    r"؀-ۿ"  # Arabic
    r"฀-๿"  # Thai
    r"\s]+",
)


def _strip_noise(text: str) -> str:
    """URL / mention / hashtag を除いて、 自然言語っぽい char だけ残す。"""
    text = _URL_RE.sub(" ", text)
    text = _MENTION_RE.sub(" ", text)
    text = _HASHTAG_RE.sub(" ", text)
    parts = _NATURAL_TEXT_RE.findall(text)
    return "".join(parts).strip()


def detect_language(body: str) -> str | None:
    """ツイート本文から言語コードを推定。 検出不能なら None。

    返す形式: ISO 639-1 (例: ja / en / ko)、 中国語のみ "zh-cn" / "zh-tw" のような
    BCP-47 ぽい langdetect 特有の形式。 frontend には文字列でそのまま渡す。
    """

    if not body:
        return None
    natural = _strip_noise(body)
    if len(natural) < _MIN_DETECTABLE_LENGTH:
        return None
    try:
        return detect(natural)
    except LangDetectException:
        # langdetect は「言語特徴なし」 で例外を投げる (純記号 / 数字のみ等)
        return None
