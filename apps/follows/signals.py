"""Follow signals (P2-03 / GitHub #178).

db H-1 (database-reviewer HIGH):
- post_save / post_delete はトランザクション commit 前に発火するため、
  例外でロールバックした場合に counters だけが先行更新されて drift する。
- ``transaction.on_commit`` 経由でコミット後にカウンタを ``F() ± 1`` で
  atomic 更新する。
- ``GREATEST(... - 1, 0)`` 相当のガードはアプリ層で `Coalesce(F("...") - 1, 0)`
  を使って実現する (PostgreSQL 想定、PositiveIntegerField なので負数が DB
  到達した場合は IntegrityError になるためガード必須)。

reconciliation Beat (`apps.follows.tasks.reconcile_follow_counters`) が日次で
実態と照合・補正する設計のため、本 signals が drift しても 1 日以内に矯正される。
"""

from __future__ import annotations

from typing import Any

from django.db import transaction
from django.db.models import F
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.common.blocking import safe_notify
from apps.follows.models import Follow


def _bump_counter(user_pk: int, field: str, delta: int) -> None:
    """User.<field> を delta だけ atomic に増減する.

    db H-1: PositiveIntegerField なので負数 (delta=-1 で 0 → -1) になると
    IntegrityError が発生する。``GREATEST(field - 1, 0)`` 相当のガードを
    アプリ側で表現する。Django ORM では Greatest を使う。
    """
    from django.contrib.auth import get_user_model
    from django.db.models.functions import Greatest

    User = get_user_model()
    if delta >= 0:
        User.objects.filter(pk=user_pk).update(**{field: F(field) + delta})
    else:
        # 負方向は 0 で clip。F-1 が -1 にならないよう Greatest で 0 と比較。
        User.objects.filter(pk=user_pk).update(**{field: Greatest(F(field) + delta, 0)})


@receiver(post_save, sender=Follow)
def on_follow_created(sender: type[Follow], instance: Follow, created: bool, **kwargs: Any) -> None:
    """Follow 作成時に followers_count / following_count を +1.

    P2-08: 自分の home TL キャッシュを invalidate (follow 直後に新しいフォロイーの
    ツイートが TL に反映されるよう)。
    """
    if not created:
        return
    follower_pk = instance.follower_id
    followee_pk = instance.followee_id
    follower_obj = instance.follower
    followee_obj = instance.followee

    def _bump() -> None:
        _bump_counter(follower_pk, "following_count", 1)
        _bump_counter(followee_pk, "followers_count", 1)
        # Phase 4A 実装後に自動で有効化される forward-compat shim
        safe_notify(kind="FOLLOW", recipient=followee_obj, actor=follower_obj)
        # P2-08: TL キャッシュ invalidate
        try:
            from apps.timeline.services import invalidate_home_tl

            invalidate_home_tl(follower_obj)
        except ImportError:  # pragma: no cover - timeline 未配置時の fallback
            pass

    transaction.on_commit(_bump)


@receiver(post_delete, sender=Follow)
def on_follow_deleted(sender: type[Follow], instance: Follow, **kwargs: Any) -> None:
    """Follow 削除時に followers_count / following_count を -1 (0 で clip)."""
    follower_pk = instance.follower_id
    followee_pk = instance.followee_id
    follower_obj = instance.follower

    def _bump() -> None:
        _bump_counter(follower_pk, "following_count", -1)
        _bump_counter(followee_pk, "followers_count", -1)
        # P2-08: TL キャッシュ invalidate
        try:
            from apps.timeline.services import invalidate_home_tl

            invalidate_home_tl(follower_obj)
        except ImportError:  # pragma: no cover
            pass

    transaction.on_commit(_bump)
