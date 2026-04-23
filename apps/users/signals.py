"""
User モデルの username 不変性を Django signal で enforce する。

SPEC §2: @handle (= username) は **変更不可**。

仕組み:
- ``User.__init__`` および ``User.from_db`` で ``self._original_username`` に
  ロード時の値を snapshot する (モデル側で実装)。
- pre_save signal で ``instance.username != instance._original_username`` を
  検出した場合、``ValidationError`` を送出する。
- ``update_fields`` に ``"username"`` が含まれる場合も同様に reject。

Migration バイパスについて:
    この signal は Django の ORM レイヤ ``.save()`` 経由でのみ発火する。
    ``QuerySet.update(username=...)`` は pre_save/post_save を発火しないため、
    migration 内で ``User.objects.update(username=...)`` を使えば username を
    書き換えることが可能。本 SPEC では初回 migration 以降 username の変更は
    想定していないが、将来的に正規化 migration 等が必要になった場合は
    この逃げ道を使うこと。
"""

from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError
from django.db.models.signals import pre_save
from django.dispatch import receiver

from apps.users.models import User


@receiver(pre_save, sender=User)
def prevent_username_change(
    sender: type[User],
    instance: User,
    raw: bool = False,
    update_fields: frozenset[str] | None = None,
    **kwargs: Any,
) -> None:
    """username 変更を拒否する pre_save ハンドラ。

    - fixtures ロード (raw=True) は対象外。
    - 新規作成 (pk=None) は対象外。
    - ``update_fields`` に ``"username"`` を明示指定した場合も reject。
    """

    # fixtures / loaddata の場合はスキップ。
    if raw:
        return

    # 新規作成時は変更ではないのでスキップ。
    if instance.pk is None:
        return

    # snapshot が未設定の場合 (通常起こらないが安全策)。
    original = getattr(instance, "_original_username", None)
    if original is None:
        return

    # update_fields で "username" を明示的に更新しようとしている場合は拒否。
    if update_fields is not None and "username" in update_fields:
        raise ValidationError(
            {"username": "Username (@handle) cannot be changed once set."},
            code="username_immutable",
        )

    # 値が変わっている場合は拒否 (通常の save() 経路)。
    if instance.username != original:
        raise ValidationError(
            {"username": "Username (@handle) cannot be changed once set."},
            code="username_immutable",
        )
