"""DM の Celery タスク (P3-06 / Issue #231).

- :func:`purge_orphan_attachments` — Confirm API で作成された orphan ``MessageAttachment``
  (``message=null``) のうち、``ORPHAN_TTL_MINUTES`` 分以上前のものを S3 削除 + DB 削除する。
  Beat schedule は ``django_celery_beat`` の DB 経由で 1 時間に 1 回実行する想定 (admin で設定)。
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Final

from celery import shared_task
from django.db import transaction
from django.utils import timezone

# delete_object を module level で import することで test の `patch("apps.dm.tasks.delete_object")`
# が意図どおり対象シンボルを差し替えられるようにする (循環 import 上問題なければ trade-off OK)。
from apps.dm.s3_presign import delete_object

# orphan attachment の保持時間。これ以上経過した未紐付け attachment は GC で削除される。
# 30 分: フロントが presign 取得 → S3 PUT → confirm → send_message を行うのに十分な時間
# (5 分 presign 有効期限 + 安全率 6 倍)。
ORPHAN_TTL_MINUTES: Final[int] = 30

# 1 回の GC で扱う最大件数 (db-reviewer HIGH H-2 反映)。
# 大量蓄積時に worker OOM を防ぐ。残りは次回タスク実行で消化される。
PURGE_BATCH_SIZE: Final[int] = 500

logger = logging.getLogger(__name__)


@shared_task(name="apps.dm.purge_orphan_attachments")
def purge_orphan_attachments() -> dict[str, int]:
    """``message__isnull=True AND created_at < now - ORPHAN_TTL_MINUTES`` を物理削除.

    S3 上の object も best-effort で削除する。S3 削除失敗時は warning ログのみで
    DB 行は削除を続行する (lifecycle rule で 365 日後に自動削除されるため致命的ではない、
    P3-07 dm/* 90 日 → Glacier IR / 365 日 → expire)。

    Race-condition guard (review HIGH 反映):
    - snapshot 後 → S3 削除 → DB 削除 の間に send_message が同 attachment を紐付ける
      可能性があるため、最終 DELETE でも ``message__isnull=True`` を再確認する。

    Returns:
        ``{"deleted_db": <int>, "s3_attempted": <int>, "s3_failed": <int>}``
    """

    from apps.dm.models import MessageAttachment

    threshold = timezone.now() - timedelta(minutes=ORPHAN_TTL_MINUTES)
    # batch limit (db HIGH H-2): 過剰蓄積時の OOM 防止。残りは次回 tick で処理。
    orphans = list(
        MessageAttachment.objects.filter(
            message__isnull=True,
            created_at__lt=threshold,
        ).only("id", "s3_key")[:PURGE_BATCH_SIZE]
    )

    s3_attempted = 0
    s3_failed = 0
    for att in orphans:
        s3_attempted += 1
        try:
            delete_object(s3_key=att.s3_key)
        except Exception:
            # delete_object 自身が ClientError を握って warning ログを残す設計だが、
            # それ以外の例外で worker が落ちないよう保険。
            s3_failed += 1
            logger.warning(
                "dm.purge_orphan.s3_delete_unexpected",
                extra={"event": "dm.purge_orphan.s3_unexpected", "key": att.s3_key},
                exc_info=True,
            )

    # GC TOCTOU 防止 (review HIGH 反映): snapshot 後に send_message で紐付いた行を消さない。
    # message__isnull=True を WHERE に明示することで、紐付け済みは行レベルで除外される。
    with transaction.atomic():
        deleted, _ = MessageAttachment.objects.filter(
            pk__in=[a.pk for a in orphans],
            message__isnull=True,
        ).delete()
    logger.info(
        "dm.purge_orphan.done",
        extra={
            "event": "dm.purge_orphan.done",
            "deleted_db": deleted,
            "s3_attempted": s3_attempted,
            "s3_failed": s3_failed,
        },
    )
    return {
        "deleted_db": deleted,
        "s3_attempted": s3_attempted,
        "s3_failed": s3_failed,
    }
