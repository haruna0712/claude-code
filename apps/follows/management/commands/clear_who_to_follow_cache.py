"""Clear all who_to_follow:* Redis cache entries (#404).

Usage:
    python manage.py clear_who_to_follow_cache

stg/prod deploy 直後に WTF service の振る舞いを変えた場合 (e.g. #399 relaxed
fallback の追加) は、TTL 60min を待たずに即座に古い cache を捨てるためにこの
コマンドを叩く。後続の `/users/recommended/` 呼び出しが lazy 再 build する。
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management.base import BaseCommand

from apps.follows.services import CACHE_KEY


class Command(BaseCommand):
    help = "Clear all who_to_follow:* Redis cache entries"

    def add_arguments(self, parser) -> None:  # type: ignore[no-untyped-def]
        parser.add_argument(
            "--user-id",
            type=int,
            default=None,
            help="特定 user の WTF cache のみクリア (省略時は全ユーザの WTF cache を delete_many で一気に消す)",
        )

    def handle(self, *args, **options) -> None:  # type: ignore[no-untyped-def]
        user_id = options.get("user_id")
        if user_id is not None:
            cache.delete(CACHE_KEY.format(user_id=user_id))
            self.stdout.write(self.style.SUCCESS(f"cleared WTF cache for user_id={user_id}"))
            return

        # User table 全件 (small DB を想定)。大規模時は Redis SCAN で
        # who_to_follow:* を直接舐める実装が望ましいが、Django cache backend
        # 経由では keys/scan を提供しないため、ID 列挙でフォールバックする。
        User = get_user_model()
        keys = [CACHE_KEY.format(user_id=pk) for pk in User.objects.values_list("pk", flat=True)]
        cache.delete_many(keys)
        self.stdout.write(
            self.style.SUCCESS(f"cleared WTF cache for {len(keys)} users (delete_many)")
        )
