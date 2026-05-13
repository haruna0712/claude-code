"""Smoke tests for apps.mentorship scaffold (P11-01)."""

import pytest
from django.apps import apps as django_apps


@pytest.mark.django_db
def test_mentorship_app_is_registered():
    """INSTALLED_APPS に apps.mentorship が含まれており、 AppConfig が解決できる。"""
    config = django_apps.get_app_config("mentorship")
    assert config.name == "apps.mentorship"
    assert config.verbose_name == "メンターマッチング"


def test_mentorship_urls_module_importable():
    """urls module が import できる (空 router でも OK)。"""
    from apps.mentorship import urls

    # default router で空 patterns、 import エラー無し
    assert urls.urlpatterns is not None
