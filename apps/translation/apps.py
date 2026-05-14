from django.apps import AppConfig


class TranslationConfig(AppConfig):
    """Phase 13 P13-02: 翻訳エンジン abstraction を提供する Django app。

    本 app 自体は model を持たない (TweetTranslation cache は apps.tweets 配下に
    置く)。 純粋に service layer (`services.py`) を集約する目的。
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.translation"
    label = "translation"
