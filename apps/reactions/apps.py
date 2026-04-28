from django.apps import AppConfig


class ReactionsConfig(AppConfig):
    """AppConfig for the reactions app (P2-04)."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.reactions"

    def ready(self) -> None:
        from apps.reactions import signals  # noqa: F401
