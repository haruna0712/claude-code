"""Reaction API URLs (P2-04 / GitHub #179).

エンドポイントは ``/api/v1/tweets/<tweet_id>/reactions/`` (tweet-rooted)。
``config/urls.py`` で ``path("api/v1/tweets/", include("apps.reactions.urls"))`` で
nested mount する。
"""

from django.urls import path

from apps.reactions.views import ReactionView

urlpatterns = [
    path(
        "<int:tweet_id>/reactions/",
        ReactionView.as_view(),
        name="reactions-toggle",
    ),
]
