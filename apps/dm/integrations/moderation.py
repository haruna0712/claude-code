"""DM → モデレーション (Phase 4B Block/Mute) のブリッジ (P3-15 / Issue #240).

Phase 3 では ``apps.moderation`` の Block / Mute モデルがまだ無いため、本モジュールは
**常に「ブロック/ミュートされていない」**を返すスタブとして動作する。Phase 4B 着手時に
``apps.moderation`` の Block / Mute モデルを参照する実装に差し替える。

呼び出し点 (Phase 3 で正しい場所に配置済):

- :mod:`apps.dm.consumers` の ``send_message`` 前 → :func:`is_dm_blocked` で判定
- :mod:`apps.dm.consumers` の typing/read broadcast 時 → 任意 (Phase 4B 着手時に決定)

Phase 4B での差し替え方法は ``docs/operations/phase-3-stub-bridges.md`` を参照。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from django.contrib.auth.models import AbstractBaseUser


def is_dm_blocked(user_a: AbstractBaseUser, user_b: AbstractBaseUser) -> bool:
    """``user_a`` と ``user_b`` の **どちらか一方** がもう片方を Block していれば ``True``.

    Phase 3 は **常に False** (Block 機能は Phase 4B で実装)。

    Phase 4B 差し替え時の実装イメージ::

        from django.db.models import Q
        from apps.moderation.models import Block

        if user_a.pk == user_b.pk:
            return False
        return Block.objects.filter(
            Q(blocker=user_a, blockee=user_b) | Q(blocker=user_b, blockee=user_a)
        ).exists()

    関係は双方向 (片方が block していれば送信不可) — security-reviewer Phase 2 が指摘した
    パターンと同じ方針。Phase 4B でも同じ規約を踏襲する。
    """

    return False


def is_dm_muted(user: AbstractBaseUser, target: AbstractBaseUser) -> bool:
    """``user`` が ``target`` をミュートしていれば ``True`` (一方向).

    Phase 3 は **常に False** (Mute 機能は Phase 4B で実装)。

    ミュートはブロックと違い相手は気づかない (SPEC §14.3)。送信そのものは許可、
    受信側の通知ベル / TL 表示で抑制するため、DM Consumer ではほぼ使わず Phase 4B で
    通知 / TL 側が利用する想定。
    """

    return False
