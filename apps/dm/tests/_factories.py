"""テスト用ファクトリヘルパ (apps/dm)。

apps/tweets/tests/_factories.py と同じ薄ヘルパ方針。pytest-factoryboy 導入前なので
最低限の関数だけ提供する。
"""

from __future__ import annotations

import uuid
from typing import Any

from django.contrib.auth import get_user_model

from apps.dm.models import DMRoom, DMRoomMembership, Message

User = get_user_model()


def make_user(**overrides: Any) -> Any:
    suffix = uuid.uuid4().hex[:12]
    defaults: dict[str, Any] = {
        "username": f"dmtester-{suffix}",
        "email": f"dmtester-{suffix}@example.com",
        "first_name": "DM",
        "last_name": "Tester",
    }
    defaults.update(overrides)
    return User.objects.create_user(
        password="pw-unused-for-tests",  # pragma: allowlist secret
        **defaults,
    )


def make_room(
    *,
    kind: str = DMRoom.Kind.DIRECT,
    name: str = "",
    creator=None,
) -> DMRoom:
    """DMRoom を作成する薄ヘルパ。サービス層 (services.add_member_to_room) は通さない。"""
    if creator is None and kind == DMRoom.Kind.GROUP:
        creator = make_user()
    return DMRoom.objects.create(kind=kind, name=name, creator=creator)


def make_membership(room: DMRoom, user=None) -> DMRoomMembership:
    """直接 DB レベルで Membership を作成する (サービス層の制約検証はバイパス)。

    services.add_member_to_room の制約 (direct=2 / group<=20) をテストしたい場合は
    こちらでなく services 側を直接呼ぶこと。
    """
    if user is None:
        user = make_user()
    return DMRoomMembership.objects.create(room=room, user=user)


def make_message(room: DMRoom, sender=None, body: str = "hello") -> Message:
    if sender is None:
        sender = make_user()
    return Message.objects.create(room=room, sender=sender, body=body)
