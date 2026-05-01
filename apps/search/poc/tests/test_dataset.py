"""PoC dataset / queries の妥当性 unit test (P2-01).

実機ベンチ自体は CI で走らせないので、ここでは "scaffold が import 可能で
合成データの分布が要件通り" であることだけ確認する。
"""

from __future__ import annotations

import pytest

from apps.search.poc.dataset import (
    CATEGORY_RATIOS,
    DEFAULT_SIZE,
    build_dataset,
)
from apps.search.poc.queries import (
    ALL_QUERIES,
    CODE_FRAGMENTS,
    EN_TERMS,
    JP_NOUNS,
    JP_PHRASES,
)


def test_default_dataset_size_matches_default():
    tweets = build_dataset()
    assert len(tweets) == DEFAULT_SIZE


def test_dataset_distribution_matches_ratios():
    tweets = build_dataset(size=1_000)
    counts = {category: 0 for category in CATEGORY_RATIOS}
    for tweet in tweets:
        counts[tweet.category] += 1

    for category, ratio in CATEGORY_RATIOS.items():
        expected = int(1_000 * ratio)
        assert (
            counts[category] == expected
        ), f"{category} expected {expected} got {counts[category]}"


def test_dataset_is_deterministic_with_same_seed():
    a = build_dataset(size=100, seed=7)
    b = build_dataset(size=100, seed=7)
    assert [t.body for t in a] == [t.body for t in b]


def test_dataset_differs_with_different_seed():
    a = build_dataset(size=100, seed=1)
    b = build_dataset(size=100, seed=2)
    # 100 件のうち少なくとも 1 件は異なるはず
    assert any(x.body != y.body for x, y in zip(a, b, strict=False))


@pytest.mark.parametrize(
    "bucket,expected_min",
    [
        (JP_NOUNS, 15),
        (EN_TERMS, 15),
        (JP_PHRASES, 10),
        (CODE_FRAGMENTS, 10),
    ],
)
def test_query_bucket_size(bucket, expected_min):
    assert len(bucket) >= expected_min


def test_total_query_count_is_50():
    assert len(ALL_QUERIES) == 50


def test_each_query_has_expected_categories():
    for q in ALL_QUERIES:
        assert q.expected_categories, f"empty expected_categories: {q.text}"
