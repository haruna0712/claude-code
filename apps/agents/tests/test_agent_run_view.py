"""
P14-04: POST /api/v1/agent/run + GET /api/v1/agent/runs/ のテスト。

spec: docs/specs/claude-agent-spec.md §6 §8.1

カバレッジ:
1. 401 未認証
2. 400 prompt 空 / 2000 字超
3. 200 happy path (AgentRunner mock)
4. 503 ANTHROPIC_API_KEY 未設定
5. 422 DraftTooLongError
6. 422 AgentMaxIterationsError
7. 500 一般 anthropic 例外
8. 429 rate limit (agent_run scope 2/day で patch)
9. GET /agent/runs/ 自分の履歴のみ + 新しい順
10. GET /agent/runs/ 他人の AgentRun は見えない
11. GET /agent/runs/ 401 未認証
"""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.agents.models import AgentRun
from apps.agents.runner import AgentMaxIterationsError
from apps.agents.tools import DraftTooLongError

User = get_user_model()


def _make_user(email: str, username: str) -> User:
    return User.objects.create_user(
        email=email,
        username=username,
        first_name="F",
        last_name="L",
        password="StrongPass!1",  # pragma: allowlist secret
    )


def _make_run_mock(user, prompt: str, draft_text: str = "今日は良い天気") -> AgentRun:
    """AgentRunner.run() の戻り値 stub: AgentRun を実際に DB に作る。"""
    return AgentRun.objects.create(
        user=user,
        prompt=prompt,
        draft_text=draft_text,
        tools_called=["compose_tweet_draft"],
        input_tokens=200,
        output_tokens=80,
        cache_read_input_tokens=0,
        cache_creation_input_tokens=0,
        cost_usd=Decimal("0.000600"),
    )


# ---------------------------------------------------------------------------
# POST /agent/run
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAgentRunViewAuth:
    def test_401_unauthenticated(self):
        client = APIClient()
        resp = client.post(reverse("agent-run"), {"prompt": "test"}, format="json")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
class TestAgentRunViewValidation:
    @override_settings(ANTHROPIC_API_KEY="sk-test")  # pragma: allowlist secret
    def test_400_empty_prompt(self):
        user = _make_user("av-empty@example.com", "av_empty")
        client = APIClient()
        client.force_authenticate(user=user)
        resp = client.post(reverse("agent-run"), {"prompt": ""}, format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    @override_settings(ANTHROPIC_API_KEY="sk-test")  # pragma: allowlist secret
    def test_400_prompt_too_long(self):
        user = _make_user("av-long@example.com", "av_long")
        client = APIClient()
        client.force_authenticate(user=user)
        # 2001 chars
        resp = client.post(
            reverse("agent-run"),
            {"prompt": "あ" * 2001},
            format="json",
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestAgentRunViewHappyPath:
    @override_settings(ANTHROPIC_API_KEY="sk-test")  # pragma: allowlist secret
    def test_200_returns_draft(self):
        user = _make_user("av-200@example.com", "av_200")
        client = APIClient()
        client.force_authenticate(user=user)

        # AgentRunner.run() を stub。 AgentRunner 自体は init 通過させる。
        with patch("apps.agents.views.AgentRunner") as MockRunner:
            instance = MagicMock()
            MockRunner.return_value = instance
            instance.run.return_value = _make_run_mock(user, "TL を要約")

            resp = client.post(
                reverse("agent-run"),
                {"prompt": "TL を要約"},
                format="json",
            )

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["draft_text"] == "今日は良い天気"
        assert resp.data["tools_called"] == ["compose_tweet_draft"]
        assert "run_id" in resp.data
        assert "cost_usd" in resp.data


@pytest.mark.django_db
class TestAgentRunViewErrors:
    @override_settings(ANTHROPIC_API_KEY="")
    def test_503_when_anthropic_disabled(self):
        user = _make_user("av-disabled@example.com", "av_disabled")
        client = APIClient()
        client.force_authenticate(user=user)
        # AgentRunner() 自体が AgentDisabledError を raise する
        resp = client.post(
            reverse("agent-run"),
            {"prompt": "test"},
            format="json",
        )
        assert resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
        assert "not configured" in resp.data["detail"].lower()

    @override_settings(ANTHROPIC_API_KEY="sk-test")  # pragma: allowlist secret
    def test_422_when_draft_too_long(self):
        user = _make_user("av-too-long@example.com", "av_too_long")
        client = APIClient()
        client.force_authenticate(user=user)
        with patch("apps.agents.views.AgentRunner") as MockRunner:
            instance = MagicMock()
            MockRunner.return_value = instance
            instance.run.side_effect = DraftTooLongError("141 chars")

            resp = client.post(
                reverse("agent-run"),
                {"prompt": "test"},
                format="json",
            )
        assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        assert "140" in resp.data["detail"]

    @override_settings(ANTHROPIC_API_KEY="sk-test")  # pragma: allowlist secret
    def test_422_when_max_iterations_exceeded(self):
        user = _make_user("av-max@example.com", "av_max")
        client = APIClient()
        client.force_authenticate(user=user)
        with patch("apps.agents.views.AgentRunner") as MockRunner:
            instance = MagicMock()
            MockRunner.return_value = instance
            instance.run.side_effect = AgentMaxIterationsError("loop > 5")

            resp = client.post(
                reverse("agent-run"),
                {"prompt": "test"},
                format="json",
            )
        assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        assert "tool iteration" in resp.data["detail"].lower()

    @override_settings(ANTHROPIC_API_KEY="sk-test")  # pragma: allowlist secret
    def test_500_on_unexpected_runtime_error(self):
        user = _make_user("av-500@example.com", "av_500")
        client = APIClient()
        client.force_authenticate(user=user)
        with patch("apps.agents.views.AgentRunner") as MockRunner:
            instance = MagicMock()
            MockRunner.return_value = instance
            instance.run.side_effect = RuntimeError("anthropic 503 down")

            resp = client.post(
                reverse("agent-run"),
                {"prompt": "test"},
                format="json",
            )
        assert resp.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        # generic message (内部詳細を user に漏らさない)
        assert "Agent failed" in resp.data["detail"]


@pytest.mark.django_db
class TestAgentRunViewThrottle:
    """ScopedRateThrottle.THROTTLE_RATES はクラス属性として import 時に
    凍結されるので、 settings override では効かない (test_crud_api / translate_endpoint
    の同種テスト参照)。 monkeypatch で class attr を上書きする。"""

    @override_settings(ANTHROPIC_API_KEY="sk-test")  # pragma: allowlist secret
    def test_429_after_exceeding_agent_run_scope(self, monkeypatch):
        from django.core.cache import cache
        from rest_framework.throttling import ScopedRateThrottle

        monkeypatch.setattr(
            ScopedRateThrottle,
            "THROTTLE_RATES",
            {**ScopedRateThrottle.THROTTLE_RATES, "agent_run": "2/day"},
        )
        cache.clear()

        user = _make_user("av-rl@example.com", "av_rl")
        client = APIClient()
        client.force_authenticate(user=user)

        with patch("apps.agents.views.AgentRunner") as MockRunner:
            instance = MagicMock()
            MockRunner.return_value = instance
            instance.run.return_value = _make_run_mock(user, "first")

            for i in range(2):
                r = client.post(
                    reverse("agent-run"),
                    {"prompt": f"prompt {i}"},
                    format="json",
                )
                assert (
                    r.status_code == status.HTTP_200_OK
                ), f"call {i + 1} should pass (got {r.status_code})"

            r = client.post(
                reverse("agent-run"),
                {"prompt": "over the limit"},
                format="json",
            )
            assert r.status_code == status.HTTP_429_TOO_MANY_REQUESTS


# ---------------------------------------------------------------------------
# GET /agent/runs/
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAgentRunListView:
    def test_401_unauthenticated(self):
        client = APIClient()
        resp = client.get(reverse("agent-runs"))
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    def test_returns_own_runs_newest_first(self):
        user = _make_user("av-list@example.com", "av_list")
        other = _make_user("av-other@example.com", "av_other")
        r1 = AgentRun.objects.create(user=user, prompt="第 1", draft_text="d1")
        r2 = AgentRun.objects.create(user=user, prompt="第 2", draft_text="d2")
        # 他人の run は見えない
        AgentRun.objects.create(user=other, prompt="他人", draft_text="x")

        client = APIClient()
        client.force_authenticate(user=user)
        resp = client.get(reverse("agent-runs"))
        assert resp.status_code == status.HTTP_200_OK
        results = resp.data.get("results", resp.data)
        run_ids = [str(row["run_id"]) for row in results]
        # 新しい順
        assert run_ids == [str(r2.id), str(r1.id)]
        # 他人の run prompt が含まれない
        prompts = [row["prompt"] for row in results]
        assert "他人" not in prompts
