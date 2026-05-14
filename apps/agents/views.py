"""Phase 14 P14-04: Agent API views.

spec: docs/specs/claude-agent-spec.md §6

- POST /api/v1/agent/run     — agent を起動し、 draft_text を返す
- GET  /api/v1/agent/runs/   — 自分の AgentRun 履歴を新しい順に paginate

throttle scope ``agent_run`` は per-user 10/day (stg 100/day) で
``config/settings/base.py`` の DEFAULT_THROTTLE_RATES に登録される。
"""

from __future__ import annotations

import logging

from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.agents.models import AgentRun
from apps.agents.runner import (
    AgentDisabledError,
    AgentMaxIterationsError,
    AgentRunner,
)
from apps.agents.serializers import (
    AgentRunRequestSerializer,
    AgentRunSummarySerializer,
)
from apps.agents.tools import DraftTooLongError
from apps.common.cookie_auth import CookieAuthentication

logger = logging.getLogger(__name__)


class AgentRunView(APIView):
    """POST /api/v1/agent/run

    Cookie JWT + IsAuthenticated。 throttle scope ``agent_run`` で per-user
    日次制限 (10/day)。
    """

    permission_classes = [IsAuthenticated]
    authentication_classes = [CookieAuthentication]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "agent_run"

    def post(self, request: Request) -> Response:
        serializer = AgentRunRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        prompt: str = serializer.validated_data["prompt"]

        try:
            runner = AgentRunner()
        except AgentDisabledError as e:
            # spec §6.1: ANTHROPIC_API_KEY 未設定 → 503
            logger.warning("agent.disabled %s", e)
            return Response(
                {"detail": "Claude Agent is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            run = runner.run(request.user, prompt)
        except DraftTooLongError:
            # spec §6.1: compose で 140 字超 → 422 (user の指示が悪かった、
            # generic 500 ではない)
            return Response(
                {"detail": "Generated draft exceeded 140 characters."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        except AgentMaxIterationsError:
            # spec §6.1: tool loop 上限超 → 422 (LLM が compose に到達できない)
            return Response(
                {"detail": "Agent exceeded the tool iteration limit."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        except Exception:
            logger.exception("agent.run failed for user=%s", request.user.pk)
            return Response(
                {"detail": "Agent failed; please try again later."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        out = AgentRunSummarySerializer(run).data
        return Response(out, status=status.HTTP_200_OK)


class AgentRunListView(generics.ListAPIView):
    """GET /api/v1/agent/runs/

    Cookie JWT + IsAuthenticated。 自分の AgentRun のみ新しい順、 PageNumberPagination。
    """

    permission_classes = [IsAuthenticated]
    authentication_classes = [CookieAuthentication]
    serializer_class = AgentRunSummarySerializer

    def get_queryset(self):
        return AgentRun.objects.filter(user=self.request.user).order_by("-created_at")
