"""SearchView API tests (#808).

GET /api/v1/search/ permission gating: anon は 401、 logged-in は 200。
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.follows.tests._factories import make_user


@pytest.mark.django_db(transaction=True)
def test_search_anon_returns_401() -> None:
    """#808: anon (未認証) は /api/v1/search/ を叩けない (401)."""
    client = APIClient()
    response = client.get("/api/v1/search/?q=django")
    assert response.status_code == 401


@pytest.mark.django_db(transaction=True)
def test_search_logged_in_returns_200() -> None:
    """logged-in は従来通り 200 (空クエリでも results=[] / count=0 で返す)."""
    user = make_user()
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/v1/search/?q=django")
    assert response.status_code == 200
    body = response.json()
    assert "query" in body
    assert "results" in body
    assert "count" in body


@pytest.mark.django_db(transaction=True)
def test_search_anon_blocked_regardless_of_query() -> None:
    """q なし / 不正 q でも anon は 401 (実行前に permission で弾く)."""
    client = APIClient()
    # q 空
    assert client.get("/api/v1/search/").status_code == 401
    # q ありだが anon
    assert client.get("/api/v1/search/?q=anything").status_code == 401
