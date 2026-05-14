"""P14-04: Agent app URLs。

config/urls.py の ``path('api/v1/agent/', include('apps.agents.urls'))`` から
マウントされる。

- POST /api/v1/agent/run
- GET  /api/v1/agent/runs/
"""

from __future__ import annotations

from django.urls import path

from apps.agents.views import AgentRunListView, AgentRunView

urlpatterns = [
    path("run", AgentRunView.as_view(), name="agent-run"),
    path("runs/", AgentRunListView.as_view(), name="agent-runs"),
]
