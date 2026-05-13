from django.apps import AppConfig


class MentorshipConfig(AppConfig):
    """AppConfig for the mentorship app (Phase 11).

    P11-01 では空 scaffold。 model / signal / admin は後続 Issue で追加。
    spec: ``docs/specs/phase-11-mentor-board-spec.md``
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.mentorship"
    verbose_name = "メンターマッチング"
