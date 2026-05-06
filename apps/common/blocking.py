"""ブロック関係チェック helper (sec HIGH: 双方向 Block 検証).

Phase 4B の `apps.moderation.Block` 実装前から、Phase 2 の Follow / Reaction /
Reply / Quote / Repost API で **双方向ブロック** をチェックする必要がある。
未実装の `Block` モデルに依存させずに forward-compatible なインターフェイスを
提供することで、Phase 4B 実装と同時に自動的に有効化される。

設計:
- Block モデルが未実装 (`apps.get_model` が `LookupError`) の間は、本関数は常に
  `False` を返す → Phase 2 では実質 noop。
- Block モデルが Phase 4B で実装されると、`get_model` が成功し、双方向クエリが
  有効化される (`(blocker=a, blockee=b) OR (blocker=b, blockee=a)`)。
- `apps.notifications.Notification` も同じパターンが必要なので、`safe_notify`
  もここに同居させる。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.apps import apps
from django.db.models import Q

if TYPE_CHECKING:
    from django.contrib.auth.models import AbstractBaseUser


def is_blocked_relationship(user_a: AbstractBaseUser, user_b: AbstractBaseUser) -> bool:
    """User A と User B の間に**いずれかの方向で** Block 関係があれば True.

    sec HIGH (security-reviewer): 「blocker → blockee の方向だけチェックする」
    と blockee 側からのフォロー/リアクション/Reply で実質的にブロックを迂回できる
    ため、必ず双方向で確認すること。

    Phase 4B で apps.moderation.Block が実装されるまでは常に False を返す。
    """
    try:
        Block = apps.get_model("moderation", "Block")
    except LookupError:
        return False
    if user_a is None or user_b is None:
        return False
    if user_a.pk == user_b.pk:
        # 自分自身に対する Block 関係は概念的に存在しない。
        return False
    return Block.objects.filter(
        Q(blocker=user_a, blockee=user_b) | Q(blocker=user_b, blockee=user_a)
    ).exists()


def safe_notify(kind: str, recipient: Any, actor: Any | None = None, **extra: Any) -> None:
    """通知を発火する (#412 で実装完了).

    apps.notifications.services.create_notification の薄いラッパ。dedup /
    self-notify guard / target stringify は service 側に集約済。
    呼び出し元が `target_type=`, `target_id=` を **extra で渡せば serializer
    が target preview を解決する。

    forward-compat: `from apps.notifications.services import create_notification`
    を直接呼ぶ migration を阻まないため、この shim は薄く維持する。
    """
    if recipient is None:
        return
    try:
        from apps.notifications.services import create_notification
    except ImportError:  # pragma: no cover - Phase 0 期間の forward-compat
        return
    create_notification(
        kind=kind,
        recipient=recipient,
        actor=actor,
        target_type=extra.get("target_type", ""),
        target_id=extra.get("target_id"),
    )
