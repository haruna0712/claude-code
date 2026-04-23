"""Models for the tweets app (P1-07).

SPEC §3 の要件に従い、以下の 4 モデルを提供する:

- ``Tweet``: ツイート本体 (Markdown 原文、最大 180 字)。
- ``TweetImage``: ツイートに添付される画像 (最大 4 枚、表示順 0〜3)。
- ``TweetTag``: ``Tweet`` と ``tags.Tag`` を結ぶ through テーブル (最大 3 個)。
- ``TweetEdit``: 編集履歴 (§3.5 編集回数上限 5 回)。

``tags.Tag`` と ``settings.AUTH_USER_MODEL`` は文字列参照で解決する
(並行開発中の worktree から直接 import しないため)。
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from apps.tweets.managers import TweetManager

# 仕様上のマジックナンバーは定数として切り出す
TWEET_BODY_MAX_LENGTH = 180
TWEET_MAX_IMAGES = 4
TWEET_MAX_TAGS = 3
TWEET_MAX_EDIT_COUNT = 5
TWEET_EDIT_WINDOW_MINUTES = 30


class Tweet(models.Model):
    """ツイート本体。

    本モデルは論理削除 (§3.9) を採用する。`is_deleted=True` の行は
    `objects` からは除外されるが `all_objects` には残り、監査目的で参照できる。
    """

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="tweets",
    )
    # Markdown ソース (HTML 換算は P1-09 で別実装)
    body = models.TextField(max_length=TWEET_BODY_MAX_LENGTH)

    # ソフト削除 (§3.9)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # 編集回数 (上限 TWEET_MAX_EDIT_COUNT、§3.5)
    edit_count = models.PositiveSmallIntegerField(default=0)
    last_edited_at = models.DateTimeField(null=True, blank=True)

    # through テーブル経由で Tag と関連付け
    tags = models.ManyToManyField(
        "tags.Tag",
        through="tweets.TweetTag",
        related_name="tweets",
    )

    # 既定 Manager は削除済みを除外する
    objects = TweetManager()
    # 監査/管理画面用: 削除済みも含む全件。複数 Manager 宣言のため
    # DJ012 (field は manager より前であるべき) を無効化する。
    all_objects = models.Manager()  # noqa: DJ012

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-created_at"]),
            models.Index(fields=["author", "-created_at"]),
        ]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"Tweet(id={self.pk}, author={self.author_id})"

    # ---------- ドメインメソッド ----------

    def soft_delete(self) -> None:
        """論理削除する。

        `is_deleted=True` / `deleted_at=now` をセットして保存する。
        物理削除は行わない (§3.9)。
        """

        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.save(update_fields=["is_deleted", "deleted_at", "updated_at"])

    def can_edit(self) -> bool:
        """編集可能かを判定する (§3.5)。

        - 作成から 30 分以内
        - 編集回数が上限 (5) 未満
        - 論理削除されていない
        """

        if self.is_deleted:
            return False
        if self.edit_count >= TWEET_MAX_EDIT_COUNT:
            return False
        deadline = self.created_at + timedelta(minutes=TWEET_EDIT_WINDOW_MINUTES)
        return deadline >= timezone.now()

    def record_edit(self, new_body: str, editor: models.Model | None = None) -> TweetEdit:
        """編集履歴を残しつつ本文を更新する (§3.5)。

        - ``TweetEdit`` を 1 件作成
        - ``body`` / ``edit_count`` / ``last_edited_at`` を更新

        呼び出し側は事前に :py:meth:`can_edit` で編集可能性を確認すること。
        """

        if not self.can_edit():
            raise ValidationError("この Tweet はこれ以上編集できません。")

        body_before = self.body
        now = timezone.now()

        edit = TweetEdit.objects.create(
            tweet=self,
            body_before=body_before,
            body_after=new_body,
            editor=editor,
        )

        self.body = new_body
        self.edit_count = models.F("edit_count") + 1
        self.last_edited_at = now
        self.save(update_fields=["body", "edit_count", "last_edited_at", "updated_at"])
        # F 式評価後の値を読み戻す
        self.refresh_from_db(fields=["edit_count"])
        return edit


class TweetImage(models.Model):
    """ツイートに添付される画像。

    同一 Tweet には最大 ``TWEET_MAX_IMAGES`` (=4) 枚まで。表示順 ``order``
    は 0〜3 で、同一 Tweet 内でユニーク。
    """

    tweet = models.ForeignKey(
        Tweet,
        on_delete=models.CASCADE,
        related_name="images",
    )
    # S3 URL。アップロード処理自体は P1-08 以降で実装されるため、
    # ここでは純粋な文字列カラムとして保持する。
    image_url = models.CharField(max_length=512)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order"]
        unique_together = [("tweet", "order")]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"TweetImage(tweet={self.tweet_id}, order={self.order})"

    def clean(self) -> None:
        """同一 Tweet に既に 4 枚以上紐付いていないか検証する。"""

        super().clean()
        if self.tweet_id is None:
            return
        qs = TweetImage.objects.filter(tweet_id=self.tweet_id)
        if self.pk is not None:
            qs = qs.exclude(pk=self.pk)
        if qs.count() >= TWEET_MAX_IMAGES:
            raise ValidationError(
                f"1 つのツイートに添付できる画像は最大 {TWEET_MAX_IMAGES} 枚です。"
            )


class TweetTag(models.Model):
    """``Tweet`` と ``tags.Tag`` を結ぶ through テーブル。

    1 ツイートあたり最大 ``TWEET_MAX_TAGS`` (=3) 個のタグを付与できる。
    タグは ``PROTECT`` なので、紐付く TweetTag が残っている限り Tag は削除できない。
    """

    tweet = models.ForeignKey(
        Tweet,
        on_delete=models.CASCADE,
    )
    tag = models.ForeignKey(
        "tags.Tag",
        on_delete=models.PROTECT,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("tweet", "tag")]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"TweetTag(tweet={self.tweet_id}, tag={self.tag_id})"

    def clean(self) -> None:
        """同一 Tweet に既に 3 個以上タグが付いていないか検証する。"""

        super().clean()
        if self.tweet_id is None:
            return
        qs = TweetTag.objects.filter(tweet_id=self.tweet_id)
        if self.pk is not None:
            qs = qs.exclude(pk=self.pk)
        if qs.count() >= TWEET_MAX_TAGS:
            raise ValidationError(f"1 つのツイートに付与できるタグは最大 {TWEET_MAX_TAGS} 個です。")


class TweetEdit(models.Model):
    """ツイートの編集履歴 (§3.5)。

    誰が (editor) / いつ (edited_at) / どう編集したか (body_before → body_after)
    を保持する。監査目的のため物理削除はしない。
    """

    tweet = models.ForeignKey(
        Tweet,
        on_delete=models.CASCADE,
        related_name="edits",
    )
    body_before = models.TextField()
    body_after = models.TextField()
    edited_at = models.DateTimeField(auto_now_add=True)
    editor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    class Meta:
        ordering = ["-edited_at"]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"TweetEdit(tweet={self.tweet_id}, edited_at={self.edited_at})"
