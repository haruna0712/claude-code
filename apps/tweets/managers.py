"""Custom managers for the tweets app.

`Tweet` はソフト削除 (§3.9) + 下書き状態 (#734, `published_at IS NULL`) を採用
しているため、 既定の `objects` は **削除済み + 下書き** の両方を除外する。

- `Tweet.objects.all()`: 公開済み + 未削除のみ (= 普通の公開 TL / search / agent
  が読む集合)
- `Tweet.objects.all_with_drafts()`: 下書きも含む alive な tweet (composer 編集 /
  自分の /drafts 用)
- `Tweet.objects.drafts_of(user)`: 特定ユーザーの下書きのみ
- `Tweet.all_objects`: 削除済みも含むすべて (admin / audit 用)

spec: docs/specs/tweet-drafts-spec.md §2.3
"""

from __future__ import annotations

from django.db import models


class TweetQuerySet(models.QuerySet):
    """Tweet 用 QuerySet。

    チェーン可能な `alive()` / `dead()` / `published()` / `drafts_of(user)` を提供。
    """

    def alive(self) -> TweetQuerySet:
        """論理削除されていない Tweet のみを返す。"""

        return self.filter(is_deleted=False)

    def dead(self) -> TweetQuerySet:
        """論理削除された Tweet のみを返す。"""

        return self.filter(is_deleted=True)

    def published(self) -> TweetQuerySet:
        """公開済み Tweet のみ (= `published_at IS NOT NULL`) を返す。"""

        return self.filter(published_at__isnull=False)

    def drafts_of(self, user) -> TweetQuerySet:
        """`user` の下書きのみ (= `published_at IS NULL`) を返す。"""

        return self.filter(author=user, published_at__isnull=True)

    def visible_to(self, viewer) -> TweetQuerySet:
        """``viewer`` が見られる tweet のみに絞るチェーンメソッド。

        spec: docs/specs/private-account-spec.md §2.4

        #735 鍵アカ機能の visibility 判定:
        - 公開アカ (``author.is_private=False``) の tweet: 誰でも見える
        - 鍵アカ author の tweet:
          - viewer が author 本人 → 見える
          - viewer が approved follower → 見える
          - それ以外 (匿名 / 非 follower / pending) → 見えない

        viewer が None (or 未認証) のときは公開アカのみを返す。 view 層から:

            qs = Tweet.objects.all().visible_to(request.user)

        の形で呼ぶ運用。 manager の `get_queryset()` で勝手に viewer を取れない
        (request context は無い) ので、 viewer に応じた filter は view 層責務。
        """
        from django.db.models import Q

        if viewer is None or not getattr(viewer, "is_authenticated", False):
            return self.filter(author__is_private=False)
        return self.filter(
            Q(author__is_private=False)
            | Q(author=viewer)
            | Q(
                author__is_private=True,
                author__follower_set__follower=viewer,
                author__follower_set__status="approved",
            )
        ).distinct()


class TweetManager(models.Manager.from_queryset(TweetQuerySet)):
    """既定で `is_deleted=False` + `published_at__isnull=False` の Tweet のみを返す Manager。

    既定除外することで、 TL / search / agent tool 等の公開 read query を 1 箇所
    ずつ書き換えなくても自動的に下書きが消える (= defense in depth)。

    下書きを意図的に読みたい場所:
    - `Tweet.objects.all_with_drafts()`: 下書きも含む alive
    - `Tweet.objects.drafts_of(user)`: user の下書きのみ
    - `Tweet.all_objects`: 削除済みも含む全件 (admin / audit)
    """

    def get_queryset(self) -> TweetQuerySet:  # type: ignore[override]
        return super().get_queryset().filter(is_deleted=False, published_at__isnull=False)

    def create(self, **kwargs):
        """Tweet 作成時、 ``published_at`` が指定されていなければ now() を設定する。

        既存呼び出し (`Tweet.objects.create(author=..., body=...)`) は publish
        即時投稿として動作する (= 従来挙動)。 下書きとして作成したい場合は
        ``published_at=None`` を明示的に渡す (serializer 側で is_draft=True
        のときに行っている)。

        #734: この override により既存の create 呼び出し全てが「公開」 として
        作られ、 default=None の field を持つ Tweet が誤って下書き扱いになる
        事故を防ぐ。
        """
        from django.utils import timezone

        if "published_at" not in kwargs:
            kwargs["published_at"] = timezone.now()
        return super().create(**kwargs)

    def all_with_drafts(self) -> TweetQuerySet:
        """下書きも含む alive な Tweet (composer 編集 / `/drafts` 用)。"""

        return super().get_queryset().filter(is_deleted=False)

    def drafts_of(self, user) -> TweetQuerySet:  # type: ignore[override]
        """`user` の下書きのみ (= `published_at IS NULL`)。"""

        return (
            super()
            .get_queryset()
            .filter(
                is_deleted=False,
                author=user,
                published_at__isnull=True,
            )
        )

    def all_with_deleted(self) -> TweetQuerySet:
        """削除済みを含むすべての Tweet を返す (admin / audit)。"""

        return super().get_queryset()
