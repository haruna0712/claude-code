"""
P14-01: AgentRun model のテスト。

spec: docs/specs/claude-agent-spec.md §3.1

カバレッジ:
1. default values (cost_usd=0, draft_text="", tools_called=[], error="", token=0)
2. per-user 履歴 ordering (created_at desc)
3. UUID pk が自動生成される
4. user FK は cascade delete
5. cost_usd は Decimal で 6 decimal places まで保存できる
6. tools_called JSON field に list を保存できる
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model

from apps.agents.models import AgentRun

User = get_user_model()


def _make_user(email: str, username: str) -> User:
    return User.objects.create_user(
        email=email,
        username=username,
        first_name="F",
        last_name="L",
        password="StrongPass!1",  # pragma: allowlist secret
    )


@pytest.mark.django_db
class TestAgentRunDefaults:
    def test_default_values(self):
        user = _make_user("a-def@example.com", "a_def")
        run = AgentRun.objects.create(user=user, prompt="今日の話題まとめて")
        assert run.id is not None  # UUID 自動生成
        assert run.draft_text == ""
        assert run.tools_called == []
        assert run.input_tokens == 0
        assert run.output_tokens == 0
        assert run.cache_read_input_tokens == 0
        assert run.cache_creation_input_tokens == 0
        assert run.cost_usd == Decimal("0")
        assert run.error == ""
        assert run.created_at is not None

    def test_uuid_pk_is_unique(self):
        user = _make_user("a-uuid@example.com", "a_uuid")
        r1 = AgentRun.objects.create(user=user, prompt="prompt 1")
        r2 = AgentRun.objects.create(user=user, prompt="prompt 2")
        assert r1.id != r2.id


@pytest.mark.django_db
class TestAgentRunPersistence:
    def test_persists_token_usage_and_cost(self):
        user = _make_user("a-cost@example.com", "a_cost")
        run = AgentRun.objects.create(
            user=user,
            prompt="test",
            draft_text="今日は良い天気です",
            tools_called=["read_home_timeline", "compose_tweet_draft"],
            input_tokens=2400,
            output_tokens=350,
            cache_read_input_tokens=1800,
            cache_creation_input_tokens=600,
            cost_usd=Decimal("0.004250"),
        )
        run.refresh_from_db()
        assert run.draft_text == "今日は良い天気です"
        assert run.tools_called == ["read_home_timeline", "compose_tweet_draft"]
        assert run.input_tokens == 2400
        assert run.output_tokens == 350
        assert run.cache_read_input_tokens == 1800
        assert run.cache_creation_input_tokens == 600
        assert run.cost_usd == Decimal("0.004250")

    def test_persists_error_message_on_failure(self):
        user = _make_user("a-err@example.com", "a_err")
        run = AgentRun.objects.create(
            user=user,
            prompt="test",
            error="anthropic.APIStatusError: 503 service unavailable",
        )
        run.refresh_from_db()
        assert "503" in run.error
        assert run.draft_text == ""


@pytest.mark.django_db
class TestAgentRunOrdering:
    def test_per_user_history_is_newest_first(self):
        """spec §3.1: index (user, -created_at) で per-user 履歴を新しい順に取得。"""
        user = _make_user("a-ord@example.com", "a_ord")
        r1 = AgentRun.objects.create(user=user, prompt="第 1")
        r2 = AgentRun.objects.create(user=user, prompt="第 2")
        r3 = AgentRun.objects.create(user=user, prompt="第 3")
        history = list(AgentRun.objects.filter(user=user).order_by("-created_at"))
        assert [r.id for r in history] == [r3.id, r2.id, r1.id]

    def test_user_cascade_delete_removes_runs(self):
        user = _make_user("a-cas@example.com", "a_cas")
        AgentRun.objects.create(user=user, prompt="p1")
        AgentRun.objects.create(user=user, prompt="p2")
        assert AgentRun.objects.filter(user=user).count() == 2
        user.delete()
        assert AgentRun.objects.count() == 0
