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
from typing import TYPE_CHECKING

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, URLValidator
from django.db import models, transaction
from django.db.models import F, Q
from django.utils import timezone

from apps.tweets.char_count import TWEET_MAX_CHARS, count_tweet_chars
from apps.tweets.managers import TweetManager

if TYPE_CHECKING:
    from django.contrib.auth.models import AbstractBaseUser

# 仕様上のマジックナンバーは定数として切り出す
TWEET_BODY_MAX_LENGTH = 180
TWEET_MAX_IMAGES = 4
TWEET_MAX_TAGS = 3
TWEET_MAX_EDIT_COUNT = 5
TWEET_EDIT_WINDOW_MINUTES = 30


class TweetType(models.TextChoices):
    """SPEC §3 のツイートタイプ (P2-05)."""

    ORIGINAL = "original", "オリジナル"
    REPLY = "reply", "返信"
    REPOST = "repost", "リポスト"
    QUOTE = "quote", "引用"


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
    # CharField にすることで `max_length` が full_clean/DB 両方で強制される。
    # TextField だと `max_length` はフォーム用のヒントに過ぎず ValidationError を投げない。
    body = models.CharField(max_length=TWEET_BODY_MAX_LENGTH)

    # ソフト削除 (§3.9)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # 編集回数 (上限 TWEET_MAX_EDIT_COUNT、§3.5)
    edit_count = models.PositiveSmallIntegerField(default=0)
    last_edited_at = models.DateTimeField(null=True, blank=True)

    # ---- カウンタ (P2-04: signals で transaction.on_commit + reconciliation Beat) ----
    # apps.reactions.signals が atomic に F("reaction_count") ± 1 を発行する。
    # 種別変更 (kind の UPDATE) 時は count を変えない (db H-1 / arch H-1)。
    reaction_count = models.PositiveIntegerField(
        default=0,
        help_text="Total reactions (denormalized via Reaction signals).",
    )

    # ---- P2-05: ツイートタイプ + reply/quote/repost 参照 + カウンタ ----
    # ER §2.5 + SPEC §3.2-§3.4. signals (apps/tweets/signals.py) が
    # transaction.on_commit でカウンタを ± 1 する。db H-1 / arch H-2 反映。
    type = models.CharField(
        max_length=20,
        choices=TweetType.choices,
        default=TweetType.ORIGINAL,
        help_text="SPEC §3: original / reply / repost / quote.",
    )
    reply_to = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="replies",
    )
    quote_of = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quotes",
    )
    # db C-1: CASCADE だと元ツイート削除で大量行が連鎖削除されロック保持時間が増える
    # ため SET_NULL に変更 (ER.md §2.5 と一致)。
    # `type=repost AND repost_of IS NULL` のレコードは表示側で tombstone 化する。
    repost_of = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reposts",
    )
    # カウンタ (signals で同期更新)
    reply_count = models.PositiveIntegerField(default=0)
    repost_count = models.PositiveIntegerField(default=0)
    quote_count = models.PositiveIntegerField(default=0)

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
        # database-reviewer HIGH: TL の主要クエリは `is_deleted=False` で絞るため、
        # partial index で index サイズと書き込みコストを抑える (PostgreSQL 前提)。
        indexes = [
            models.Index(
                fields=["-created_at"],
                condition=Q(is_deleted=False),
                name="tweets_tl_idx",
            ),
            models.Index(
                fields=["author", "-created_at"],
                condition=Q(is_deleted=False),
                name="tweets_author_tl_idx",
            ),
        ]
        # defense in depth (python-reviewer HIGH):
        # - TOCTOU で record_edit が競合しても edit_count は 5 を超えない
        # - body は CharField(max_length=180) なので DB 側も varchar(180) で長さ enforce
        constraints = [
            models.CheckConstraint(
                check=Q(edit_count__lte=TWEET_MAX_EDIT_COUNT),
                name="tweet_edit_count_lte_max",
            ),
            # P2-05: type=repost のときのみ body 空を許可する。
            # それ以外の type で空 body は reject。
            models.CheckConstraint(
                check=(Q(type=TweetType.REPOST) | ~Q(body="")),
                name="tweet_repost_has_empty_body",
            ),
            # P2-05: 同一 user × 同一 repost_of は 1 件のみ (重複 RT 防止)。
            # partial UniqueConstraint (`condition`): type=repost の行のみ対象。
            models.UniqueConstraint(
                fields=["author", "repost_of"],
                condition=Q(type=TweetType.REPOST),
                name="tweet_unique_repost_per_user",
            ),
        ]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"Tweet(id={self.pk}, author={self.author_id})"

    # ---------- バリデーション ----------

    def clean(self) -> None:
        """SPEC §3.3 に従う「見た目の文字数」上限を検証する (P1-10)。

        CharField(max_length=180) によって **raw 文字列長** は DB / full_clean
        双方で強制されるが、本プロジェクトでは URL を 23 字換算し Markdown
        記号を除外した「見た目の文字数」も 180 字以下でなければならない。
        ここではその後者を検証する (raw 上限は CharField が担当)。
        """

        super().clean()
        if self.body and count_tweet_chars(self.body) > TWEET_MAX_CHARS:
            raise ValidationError(
                {"body": (f"本文は URL / Markdown 換算で {TWEET_MAX_CHARS} 字以内にしてください。")}
            )

    # ---------- ドメインメソッド ----------

    def soft_delete(self) -> None:
        """論理削除する。

        `is_deleted=True` / `deleted_at=now` をセットして保存する。
        物理削除は行わない (§3.9)。

        #400: 単純リポスト (``type=REPOST``) は元ツイート削除と同時に
        cascade で論理削除する。元投稿が消えると repost は body 空のため
        TL に意味のない tombstone (「このツイートは削除されました」) を
        残すだけになるので、合わせて消す。
        引用 (``type=QUOTE``) は本文を持つ独立した発言なので cascade しない。
        """

        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.save(update_fields=["is_deleted", "deleted_at", "updated_at"])

        # 単純リポストの cascade soft-delete (#400)
        # `self.reposts` は `Tweet.objects` 経由 = 既に削除済みは除外されている。
        # bulk update で signals は飛ばないが、元 tweet が is_deleted=True で
        # TL に出ない以上 repost_count の整合は不要。
        self.reposts.filter(type=TweetType.REPOST).update(
            is_deleted=True,
            deleted_at=self.deleted_at,
            updated_at=timezone.now(),
        )

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

    @transaction.atomic
    def record_edit(
        self,
        new_body: str,
        editor: AbstractBaseUser | None = None,
    ) -> TweetEdit:
        """編集履歴を残しつつ本文を更新する (§3.5)。

        - ``TweetEdit`` を 1 件作成
        - ``body`` / ``edit_count`` / ``last_edited_at`` を更新

        呼び出し側は事前に :py:meth:`can_edit` で編集可能性を確認すること。

        python/security-reviewer HIGH 対応:
        - ``@transaction.atomic`` + ``select_for_update`` で TOCTOU を排除し、
          edit_count の上限 (5) を跨ぐ並行更新を阻止する。
        - ``new_body`` の長さを事前検証し、DB レイヤー (TextField) を迂回した
          長大本文の挿入を防ぐ。
        - 更新は F 式で原子的に ``+1``。F 式評価後の値は ``refresh_from_db`` で
          インスタンスに読み戻す。
        """

        # new_body の長さは常に検証する (CharField にしたが record_edit は save() を使わないため)。
        # code-reviewer MEDIUM: ValidationError の形式を ``{field: message}`` 辞書に
        # 統一する (clean() 側と揃えて DRF レイヤーでも field-level エラーとして返せる)。
        if len(new_body) > TWEET_BODY_MAX_LENGTH:
            raise ValidationError(
                {"body": f"本文は {TWEET_BODY_MAX_LENGTH} 字以内で入力してください。"}
            )

        # P1-10: URL 換算 / Markdown 記号除外 ベースの「見た目の文字数」も検証する。
        # raw 文字数が 180 以下でも見た目が 180 を超えるケース (長い URL を
        # 1 字扱いしてコードブロックで装飾等) を拒否する。
        if count_tweet_chars(new_body) > TWEET_MAX_CHARS:
            raise ValidationError(
                {"body": f"本文は URL / Markdown 換算で {TWEET_MAX_CHARS} 字以内にしてください。"}
            )

        # 行ロックを取り、ロック後にもう一度 can_edit を評価することで
        # TOCTOU (can_edit と save の間で別トランザクションが挿入) を排除する
        locked = Tweet.all_objects.select_for_update().get(pk=self.pk)
        if not locked.can_edit():
            raise ValidationError("この Tweet はこれ以上編集できません。")

        body_before = locked.body
        now = timezone.now()

        edit = TweetEdit.objects.create(
            tweet=locked,
            body_before=body_before,
            body_after=new_body,
            editor=editor,
            editor_username=(getattr(editor, "username", "") if editor else ""),
        )

        # F 式で原子的に +1。同時に本文 / last_edited_at / updated_at も更新する
        Tweet.all_objects.filter(pk=self.pk).update(
            body=new_body,
            edit_count=F("edit_count") + 1,
            last_edited_at=now,
            updated_at=now,
        )
        # インスタンスに最新値を反映
        self.refresh_from_db(fields=["body", "edit_count", "last_edited_at", "updated_at"])
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
    # S3 URL。security-reviewer HIGH: https 限定の URLValidator を付けて
    # javascript: 等の危険スキームの混入を防ぐ。S3 ドメイン固定は後続 (P1-08) で。
    image_url = models.URLField(
        max_length=512,
        validators=[URLValidator(schemes=["https"])],
    )
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    # order は 0..TWEET_MAX_IMAGES-1 (=0..3)。DB 側で CHECK はかけられないため
    # MaxValueValidator で full_clean 経由の検証を行う。
    order = models.PositiveSmallIntegerField(
        default=0,
        validators=[MaxValueValidator(TWEET_MAX_IMAGES - 1)],
    )

    class Meta:
        ordering = ["order"]
        unique_together = [("tweet", "order")]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"TweetImage(tweet={self.tweet_id}, order={self.order})"

    def save(self, *args, **kwargs) -> None:
        """save() 経由でも ``clean()`` の制約が必ず適用されるようにする。

        python-reviewer HIGH: ``TweetImage.objects.create`` など ORM 直接経由で
        枚数制限が bypass される問題への対応 (defense in depth)。
        """

        self.full_clean()
        super().save(*args, **kwargs)

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
        related_name="tweet_tags",
    )
    tag = models.ForeignKey(
        "tags.Tag",
        on_delete=models.PROTECT,
        related_name="tweet_tags",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("tweet", "tag")]
        # database-reviewer HIGH: tag_id 逆引きのクエリ (「このタグを持つ Tweet 一覧」)
        # に備え明示的に index を張る。
        # P2-09 (db H-4): tweet_id 側のルックアップ (Tweet 削除時 CASCADE / トレンド集計の
        # JOIN) でも index を効かせるため `tweet` 単独 index も追加する。Django は FK に
        # 自動で index を作らないため明示が必要。
        indexes = [
            models.Index(fields=["tag"], name="tweets_tweettag_tag_idx"),
            models.Index(fields=["tweet"], name="tweets_tweettag_tweet_idx"),
        ]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"TweetTag(tweet={self.tweet_id}, tag={self.tag_id})"

    def save(self, *args, **kwargs) -> None:
        """save() 経由でも ``clean()`` の制約が必ず適用されるようにする。

        python-reviewer HIGH: ``TweetTag.objects.create`` など ORM 直接経由で
        タグ数制限 / 未承認タグ禁止が bypass される問題への対応。
        """

        self.full_clean()
        super().save(*args, **kwargs)

    def clean(self) -> None:
        """同一 Tweet に既に 3 個以上タグが付いていないか、
        および未承認タグが紐付けられていないかを検証する。
        """

        super().clean()
        if self.tweet_id is None:
            return
        qs = TweetTag.objects.filter(tweet_id=self.tweet_id)
        if self.pk is not None:
            qs = qs.exclude(pk=self.pk)
        if qs.count() >= TWEET_MAX_TAGS:
            raise ValidationError(f"1 つのツイートに付与できるタグは最大 {TWEET_MAX_TAGS} 個です。")

        # security-reviewer HIGH + CROSS-PR: tags worktree 側で Tag.is_approved が
        # 追加される前提で、未承認タグの紐付けを拒否する。
        # Tag モデルに is_approved 属性が未搭載の期間 (tags worktree 未マージ) は
        # getattr で安全にフォールバック (True 扱い) する。
        if self.tag_id is not None:
            is_approved = getattr(self.tag, "is_approved", True)
            if not is_approved:
                raise ValidationError("承認されていないタグは Tweet に紐付けられません。")


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
    # body_before / body_after は Tweet.body と同じ max_length を揃える (MEDIUM)
    body_before = models.CharField(max_length=TWEET_BODY_MAX_LENGTH)
    body_after = models.CharField(max_length=TWEET_BODY_MAX_LENGTH)
    edited_at = models.DateTimeField(auto_now_add=True)
    editor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    # database-reviewer HIGH: editor は SET_NULL なので、ユーザ削除後に
    # 編集者情報が完全に失われる。監査用にユーザ名スナップショットを保持する。
    # Django 慣習に従い、文字列カラムは NULL ではなく空文字列で「未記録」を表す。
    editor_username = models.CharField(max_length=150, blank=True, default="")

    class Meta:
        ordering = ["-edited_at"]
        # database-reviewer HIGH: editor_id 逆引き (「このユーザが編集した履歴」)
        # 用の index を明示的に張る。
        indexes = [
            models.Index(fields=["editor"], name="tweets_tweetedit_editor_idx"),
        ]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"TweetEdit(tweet={self.tweet_id}, edited_at={self.edited_at})"


class OgpCache(models.Model):
    """OGP メタデータのキャッシュ (P2-07 / GitHub #182, ER §2.10).

    SPEC §3.5: Tweet 本文の URL をパースして OGP メタを取得し、24h キャッシュする。
    キャッシュキーは正規化済み URL の SHA-256 hex (``url_hash``)。複数の Tweet が
    同じ URL を含む場合に同じ OgpCache 行を共有する。

    sec MEDIUM (db M-1): 蓄積防止のため ``last_used_at`` を持ち、Tweet 作成時に
    touch する。日次 Beat (``apps.tweets.tasks.purge_stale_ogp``) で 7 日以上参照
    されていない行を物理削除する。
    """

    url_hash = models.CharField(
        max_length=64,
        unique=True,
        help_text="SHA-256 hex of the normalized URL (32 bytes → 64 chars).",
    )
    url = models.URLField(max_length=500)
    title = models.CharField(max_length=300, blank=True, default="")
    description = models.TextField(blank=True, default="")
    image_url = models.URLField(max_length=500, blank=True, default="")
    site_name = models.CharField(max_length=200, blank=True, default="")
    fetched_at = models.DateTimeField(auto_now=True)
    last_used_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            # purge_stale_ogp の対象抽出に利用 (last_used_at < threshold)
            models.Index(fields=["last_used_at"], name="ogp_last_used_idx"),
        ]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"OgpCache(url={self.url[:50]!r})"
