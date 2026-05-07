"""ミュート関係チェック helper (Phase 4B / Issue #444).

`apps.common.blocking.is_blocked_relationship` と同じ lazy-import 形式。
Mute モデルが入っていない期間も import 安全 (常に False を返す)。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.apps import apps

if TYPE_CHECKING:
    from django.contrib.auth.models import AbstractBaseUser


def is_muted_by(muter: AbstractBaseUser | None, target: AbstractBaseUser | None) -> bool:
    """muter が target を一方向で Mute していれば True.

    Block と異なり双方向は確認しない (Mute は muter 視点の一方向)。
    Mute モデル未実装期間 (Phase 4B 着手前) は常に False。
    """
    if muter is None or target is None:
        return False
    if muter.pk == target.pk:
        return False
    try:
        Mute = apps.get_model("moderation", "Mute")
    except LookupError:
        return False
    return Mute.objects.filter(muter=muter, mutee=target).exists()


def get_muted_user_ids(muter: AbstractBaseUser | None) -> set:
    """muter が Mute している user_id の set を返す (TL クエリ用)."""
    if muter is None:
        return set()
    try:
        Mute = apps.get_model("moderation", "Mute")
    except LookupError:
        return set()
    return set(Mute.objects.filter(muter=muter).values_list("mutee_id", flat=True))
