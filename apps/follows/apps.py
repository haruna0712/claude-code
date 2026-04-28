from django.apps import AppConfig


class FollowsConfig(AppConfig):
    """AppConfig for the follows app (P2-03)."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.follows"

    def ready(self) -> None:
        # signals を import するだけで @receiver が登録される。
        # noqa: F401 を付けて未使用 import 警告を抑止 (副作用 import)。
        from apps.follows import signals  # noqa: F401
