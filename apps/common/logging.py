"""Structured logging wiring for Django + Celery (P0-10).

structlog を Django の標準 logging にぶら下げる構成。
- ローカル開発: ConsoleRenderer (色付き / 人間可読)
- stg / prod: JSONRenderer (CloudWatch Logs Insights で検索しやすい)

使用側は `structlog.get_logger(__name__)` を呼ぶだけ。request_id / user_id /
path は RequestContextMiddleware が context var として差し込み、
`merge_contextvars` processor 経由で自動的にログへ含まれる。

Celery タスクの start / success / failure も signal で自動ロギングする。
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from typing import Any

import structlog
from django.http import HttpRequest, HttpResponse
from django.utils.deprecation import MiddlewareMixin

# ---------------------------------------------------------------------------
# structlog configuration
# ---------------------------------------------------------------------------


def configure_structlog(environment: str) -> None:
    """Invoked once from settings (after LOGGING dict is assembled)."""
    is_production_like = environment in {"stg", "production"}
    renderer: Any = (
        structlog.processors.JSONRenderer()
        if is_production_like
        else structlog.dev.ConsoleRenderer(colors=True)
    )

    structlog.configure(
        processors=[
            # add contextvars (request_id, user_id, path) injected by middleware
            structlog.contextvars.merge_contextvars,
            # add log level / logger name / timestamp
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            # exception info -> structured dict
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            # final rendering
            renderer,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


def build_logging_dict(environment: str) -> dict[str, Any]:
    """Return the `LOGGING` dict consumed by Django settings.

    All output goes through a single structlog-aware handler, so downstream
    (stdout -> CloudWatch Logs in stg/prod, tty in local) gets consistent
    JSON or pretty output.
    """
    is_production_like = environment in {"stg", "production"}
    formatter_key = "json" if is_production_like else "console"

    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "json": {
                "()": structlog.stdlib.ProcessorFormatter,
                "processor": structlog.processors.JSONRenderer(),
                "foreign_pre_chain": _foreign_pre_chain(),
            },
            "console": {
                "()": structlog.stdlib.ProcessorFormatter,
                "processor": structlog.dev.ConsoleRenderer(colors=True),
                "foreign_pre_chain": _foreign_pre_chain(),
            },
        },
        "handlers": {
            "default": {
                "class": "logging.StreamHandler",
                "formatter": formatter_key,
            },
        },
        "root": {
            "handlers": ["default"],
            "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO"),
        },
        "loggers": {
            # Noisy loggers tuned here; add more as needed.
            "django.server": {"handlers": ["default"], "level": "INFO", "propagate": False},
            "django.request": {"handlers": ["default"], "level": "WARNING", "propagate": False},
            "django.db.backends": {"handlers": ["default"], "level": "WARNING", "propagate": False},
            "celery": {"handlers": ["default"], "level": "INFO", "propagate": False},
        },
    }


def _foreign_pre_chain() -> list[Any]:
    """Processors applied to log records coming from non-structlog loggers.

    Keeping this aligned with `configure_structlog` ensures Django's own
    stdlib logs (request lifecycle, migrations, SQL warnings) end up with
    the same fields as our application logs.
    """
    return [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]


# ---------------------------------------------------------------------------
# Request context middleware
# ---------------------------------------------------------------------------


class RequestContextMiddleware(MiddlewareMixin):
    """Attach request_id / user_id / method / path to structlog contextvars.

    `process_request` seeds the context; `process_response` clears it so
    later requests on the same worker don't inherit stale state.
    """

    def process_request(self, request: HttpRequest) -> None:
        structlog.contextvars.clear_contextvars()
        request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex
        request.request_id = request_id  # type: ignore[attr-defined]

        user_id: str | None = None
        user = getattr(request, "user", None)
        if user is not None and getattr(user, "is_authenticated", False):
            user_id = str(getattr(user, "id", "") or getattr(user, "pk", ""))

        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            user_id=user_id,
            method=request.method,
            path=request.path,
        )
        request._structlog_started = time.monotonic()  # type: ignore[attr-defined]

    def process_response(self, request: HttpRequest, response: HttpResponse) -> HttpResponse:
        started = getattr(request, "_structlog_started", None)
        if started is not None:
            duration_ms = int((time.monotonic() - started) * 1000)
            structlog.get_logger("django.request").info(
                "request.finished",
                status_code=response.status_code,
                duration_ms=duration_ms,
            )
        response["X-Request-Id"] = getattr(request, "request_id", "")
        structlog.contextvars.clear_contextvars()
        return response


# ---------------------------------------------------------------------------
# Celery signal hooks
# ---------------------------------------------------------------------------


def register_celery_signals() -> None:
    """Wire Celery task lifecycle events into structlog.

    Called from config/celery_app.py after the Celery app is created.
    """
    from celery.signals import task_failure, task_postrun, task_prerun

    log = structlog.get_logger("celery.task")

    def _prerun(task_id: str | None, task: Any, **_kwargs: Any) -> None:
        structlog.contextvars.bind_contextvars(task_id=task_id, task_name=getattr(task, "name", None))
        log.info("task.started")

    def _postrun(task_id: str | None, task: Any, state: str | None = None, **_kwargs: Any) -> None:
        log.info("task.finished", state=state)
        structlog.contextvars.unbind_contextvars("task_id", "task_name")

    def _failure(task_id: str | None, exception: BaseException | None = None, **_kwargs: Any) -> None:
        log.error("task.failed", task_id=task_id, exc_info=exception)

    task_prerun.connect(_prerun, weak=False)
    task_postrun.connect(_postrun, weak=False)
    task_failure.connect(_failure, weak=False)


__all__ = [
    "RequestContextMiddleware",
    "build_logging_dict",
    "configure_structlog",
    "register_celery_signals",
]


# Silence mypy / unused-import warnings for `logging` (kept in case
# downstream modules want to grab it from here for convenience).
_ = logging
