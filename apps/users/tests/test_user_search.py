"""ユーザー検索 API (#480) のテスト.

GET /api/v1/users/?q=<prefix>&limit=N
- 認証必須 (anonymous → 401)
- handle (username) の前方一致 (case-insensitive)
- 自分自身は除外
- is_active=False は除外
- limit 既定 10、上限 50
- limit=0 / 空 q では空配列 (lookup を空打ちさせない安全弁)
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

User = get_user_model()


@pytest.fixture
def search_url() -> str:
    return reverse("users-search")


def make_user(*, username: str, email: str = "", is_active: bool = True):
    return User.objects.create_user(
        username=username,
        email=email or f"{username}@example.com",
        password="testpass123",  # pragma: allowlist secret
        first_name="F",
        last_name="L",
        is_active=is_active,
    )


@pytest.mark.django_db
def test_search_requires_auth(search_url: str) -> None:
    client = APIClient()
    resp = client.get(f"{search_url}?q=abc")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_search_prefix_match_excludes_self(search_url: str) -> None:
    me = make_user(username="alice")
    make_user(username="alex")
    make_user(username="aaron")
    make_user(username="bob")

    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.get(f"{search_url}?q=al")
    assert resp.status_code == status.HTTP_200_OK
    handles = sorted(u["username"] for u in resp.json()["results"])
    # alex のみ (alice = self は除外、aaron は a だけど "al" で前方一致しない)
    assert handles == ["alex"]


@pytest.mark.django_db
def test_search_excludes_inactive(search_url: str) -> None:
    me = make_user(username="zara")
    make_user(username="ghost", is_active=False)

    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.get(f"{search_url}?q=gho")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["results"] == []


@pytest.mark.django_db
def test_search_case_insensitive(search_url: str) -> None:
    me = make_user(username="me1")
    make_user(username="Bobby")

    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.get(f"{search_url}?q=BOB")
    handles = [u["username"] for u in resp.json()["results"]]
    assert "Bobby" in handles


@pytest.mark.django_db
def test_search_empty_q_returns_empty(search_url: str) -> None:
    me = make_user(username="me2")
    make_user(username="alice2")

    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.get(f"{search_url}?q=")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["results"] == []


@pytest.mark.django_db
def test_search_limit_default_10(search_url: str) -> None:
    me = make_user(username="searcher")
    for i in range(15):
        make_user(username=f"target_{i:02d}")

    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.get(f"{search_url}?q=target")
    body = resp.json()
    assert resp.status_code == status.HTTP_200_OK
    assert len(body["results"]) == 10


@pytest.mark.django_db
def test_search_limit_capped_at_50(search_url: str) -> None:
    me = make_user(username="searcher2")
    for i in range(60):
        make_user(username=f"prefixb_{i:02d}")

    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.get(f"{search_url}?q=prefixb&limit=999")
    body = resp.json()
    assert len(body["results"]) <= 50


@pytest.mark.django_db
def test_search_response_shape(search_url: str) -> None:
    me = make_user(username="seeker")
    make_user(username="alpha")

    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.get(f"{search_url}?q=alpha")
    body = resp.json()
    assert "results" in body
    assert isinstance(body["results"], list)
    if body["results"]:
        first = body["results"][0]
        # 必要 field のみ (PII を漏らさない)
        for key in ("user_id", "username", "first_name", "last_name", "avatar"):
            assert key in first
        # email / is_active / is_premium などは出さない
        assert "email" not in first
        assert "is_active" not in first
