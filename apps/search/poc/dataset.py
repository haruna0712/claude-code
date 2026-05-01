"""PoC 用合成ツイートデータセット (P2-01).

1,000 件規模のツイートを Faker で生成。配分は P2-01 issue body の通り:

- 日本語ベタ書き 40%
- 英日混在        30%
- コードブロック含み 20%
- URL 含み        10%

将来 LLM で増幅する場合はこの関数の出力を seed として使う。本 PoC では
deterministic に Faker のみで生成し、ベンチマーク間で同じ corpus を共有する。
"""

from __future__ import annotations

from dataclasses import dataclass

# faker は requirements/base.txt にすでに含まれる前提
# (P0-01 で導入済、TweetFactory でも使う)
from faker import Faker

DEFAULT_SIZE = 1_000
DEFAULT_SEED = 42


@dataclass(frozen=True)
class SyntheticTweet:
    """PoC ベンチマーク入力ツイート."""

    id: int
    body: str
    category: str  # "ja_plain" | "ja_en_mix" | "code_block" | "url"


CATEGORY_RATIOS: dict[str, float] = {
    "ja_plain": 0.40,
    "ja_en_mix": 0.30,
    "code_block": 0.20,
    "url": 0.10,
}


def _make_ja_plain(fake: Faker) -> str:
    return fake.text(max_nb_chars=160)


def _make_ja_en_mix(fake: Faker, fake_en: Faker) -> str:
    head = fake.sentence(nb_words=8)
    tail = fake_en.sentence(nb_words=10)
    return f"{head} {tail}"


def _make_code_block(fake: Faker) -> str:
    fn = fake.pystr(min_chars=4, max_chars=10).lower()
    body = fake.text(max_nb_chars=80)
    return f"{body}\n```python\ndef {fn}(x):\n    return x * 2\n```"


def _make_url(fake: Faker) -> str:
    body = fake.text(max_nb_chars=100)
    return f"{body} {fake.uri()}"


def build_dataset(
    size: int = DEFAULT_SIZE,
    seed: int = DEFAULT_SEED,
) -> list[SyntheticTweet]:
    """Faker でカテゴリ分布通りのツイートを ``size`` 件生成する.

    deterministic: 同じ ``seed`` で常に同じ corpus が得られる。
    """
    fake = Faker("ja_JP")
    fake_en = Faker("en_US")
    Faker.seed(seed)

    out: list[SyntheticTweet] = []
    n = 0
    for category, ratio in CATEGORY_RATIOS.items():
        bucket = int(size * ratio)
        for _ in range(bucket):
            if category == "ja_plain":
                body = _make_ja_plain(fake)
            elif category == "ja_en_mix":
                body = _make_ja_en_mix(fake, fake_en)
            elif category == "code_block":
                body = _make_code_block(fake)
            elif category == "url":
                body = _make_url(fake)
            else:
                # safety fallback — keeps the tuple total deterministic.
                body = fake.text(max_nb_chars=160)
            out.append(SyntheticTweet(id=n, body=body, category=category))
            n += 1

    return out
