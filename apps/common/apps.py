from django.apps import AppConfig


class CommonConfig(AppConfig):
    """AppConfig for the common app.

    Phase 0 では INSTALLED_APPS に未登録だったが、P2-02 で pg_bigm / pg_trgm の
    `CreateExtension` を共有 migration として apps/common/migrations/ に配置する
    ため、本フェーズで正式登録する (config/settings/base.py の LOCAL_APPS に追加)。
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.common"
