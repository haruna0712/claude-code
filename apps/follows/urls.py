"""Follow API URLs (P2-03 / GitHub #178).

エンドポイントは SPEC §16.2 に従って handle ベースの user-rooted resource として
登録する。``config/urls.py`` で ``path("api/v1/users/", include("apps.follows.urls"))``
として登録するが、既存の ``apps.users.urls_profile`` も同じ prefix を共有する
ため、URL pattern の specificity を意識して順序付けする (具体的なパスを先に)。

実際のマウントは ``config/urls.py`` で:
- ``api/v1/users/`` には ``urls_profile`` (me/, <handle>/) と本ファイルが共存。
  Django は登録順に試すので、本ファイルの ``<handle>/follow/`` のように 2 セグメント
  パターンは ``urls_profile`` の 1 セグメント ``<handle>/`` と衝突しない。
"""

from django.urls import path

from apps.follows.views import (
    FollowView,
    FollowersListView,
    FollowingListView,
    PopularUsersView,
    RecommendedUsersView,
)

urlpatterns = [
    # P2-10: <handle>/follow/ より優先するため static path を先に
    path(
        "recommended/",
        RecommendedUsersView.as_view(),
        name="users-recommended",
    ),
    path(
        "popular/",
        PopularUsersView.as_view(),
        name="users-popular",
    ),
    path(
        "<str:handle>/follow/",
        FollowView.as_view(),
        name="follows-follow",
    ),
    path(
        "<str:handle>/followers/",
        FollowersListView.as_view(),
        name="follows-followers-list",
    ),
    path(
        "<str:handle>/following/",
        FollowingListView.as_view(),
        name="follows-following-list",
    ),
]
