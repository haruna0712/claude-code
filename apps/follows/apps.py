from django.apps import AppConfig


class FollowsConfig(AppConfig):
    """AppConfig for the follows app (P2-03)."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.follows"

    def ready(self) -> None:
        # signals を import するだけで @receiver が登録される。

        from apps.follows import signals  # noqa: F401
