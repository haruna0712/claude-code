"""Serializers for the tweets CRUD API (P1-08).

SPEC §3 に従うツイート CRUD エンドポイント用の DRF serializer。

設計方針:
- **list / detail (read)** は ``Tweet`` モデルのほぼ生に近い形を返す。
  ``html`` は ``apps.tweets.rendering.render_markdown`` で生成する。
  ``author_handle`` / ``tags`` は SerializerMethodField で配列化する
  (through テーブルを API 消費側に露出させない)。
- **create / update (write)** は Serializer (ModelSerializer ではなく) で
  書き味を揃える。Create 時の tags / images は別テーブルなので create() を
  手書きし、トランザクション境界を serializer 内に閉じ込める。
- **編集**は ``Tweet.record_edit(new_body, editor=...)`` 経由に統一する。
  record_edit は既に 30 分制約 / 5 回制約 / TweetEdit 作成 / edit_count 原子
  インクリメントをすべて引き受ける (apps/tweets/models.py 参照)。
- **char_count** は P1-10 (並列実装) の ``count_tweet_chars`` を優先し、
  未マージ期間は ``len()`` でフォールバックする (lazy import + try/except)。
  TODO: P1-10 マージ後にフォールバックブロックを削除する (#issue-P1-10)。
"""

from __future__ import annotations

from typing import Any

from django.core.validators import URLValidator
from django.db import transaction
from rest_framework import serializers

from apps.tags.models import Tag
from apps.tweets.models import (
    TWEET_BODY_MAX_LENGTH,
    TWEET_MAX_IMAGES,
    TWEET_MAX_TAGS,
    Tweet,
    TweetImage,
    TweetTag,
    TweetType,
)
from apps.tweets.rendering import render_markdown

# -----------------------------------------------------------------------------
# #383 reaction_summary helper
# -----------------------------------------------------------------------------


def _build_reaction_summary(tweet: Tweet, request: Any | None) -> dict[str, Any]:
    """Tweet に紐づく Reaction の集計と viewer 別 my_kind を返す.

    形は ``GET /api/v1/tweets/<id>/reactions/`` と同じ:
        {"counts": {kind: count for 10 kinds (0-fill)}, "my_kind": kind | None}

    各 tweet ごとに 1〜2 query を発行する (counts と my_kind)。timeline 等で
    N+1 が問題になるなら view 側で ``prefetch_related("reactions")`` するか、
    本 helper の caller が context に集計済 dict を入れて optimize する。
    MVP は単純に直接 query する (#383)。
    """
    from collections import Counter

    from apps.reactions.models import Reaction, ReactionKind

    rows = Reaction.objects.filter(tweet=tweet).values_list("kind", flat=True)
    counts = Counter(rows)
    full_counts = {k.value: counts.get(k.value, 0) for k in ReactionKind}

    my_kind: str | None = None
    if request is not None and request.user.is_authenticated:
        my_kind = (
            Reaction.objects.filter(user=request.user, tweet=tweet)
            .values_list("kind", flat=True)
            .first()
        )

    return {"counts": full_counts, "my_kind": my_kind}


# -----------------------------------------------------------------------------
# P1-10 (char_count) lazy import
# -----------------------------------------------------------------------------
# P1-10 は並列実装中なので import が失敗するケースを許容する。
# P1-10 マージ後はこの try/except を削除し、``from apps.tweets.char_count import
# count_tweet_chars, TWEET_MAX_CHARS`` のみ残す (TODO: #P1-10)。
try:
    from apps.tweets.char_count import (  # type: ignore[attr-defined]
        TWEET_MAX_CHARS,
        count_tweet_chars,
    )

    _HAS_CHAR_COUNT = True
except ImportError:  # pragma: no cover - P1-10 が merge されたら到達しない
    _HAS_CHAR_COUNT = False
    TWEET_MAX_CHARS = TWEET_BODY_MAX_LENGTH


# -----------------------------------------------------------------------------
# Image serializer (read/write 共通)
# -----------------------------------------------------------------------------


class TweetImageSerializer(serializers.ModelSerializer):
    """TweetImage の read/write 共通 serializer。

    security-reviewer HIGH: ``image_url`` は https 限定。
    ``data:`` / ``javascript:`` / ``http://`` を混入させない。
    """

    # URLField のデフォルト validator に加えて https 限定 URLValidator を重ねる。
    image_url = serializers.URLField(
        max_length=512,
        validators=[URLValidator(schemes=["https"])],
    )

    class Meta:
        model = TweetImage
        fields = ["image_url", "width", "height", "order"]


# -----------------------------------------------------------------------------
# Read serializers
# -----------------------------------------------------------------------------


class TweetBaseMiniSerializer(serializers.ModelSerializer):
    """Nested tweet summary without further nesting.

    Used as the terminal shape for quote/repost embeds so serializers cannot
    recurse indefinitely.
    """

    author_handle = serializers.SerializerMethodField()
    author_display_name = serializers.SerializerMethodField()
    author_avatar_url = serializers.SerializerMethodField()
    html = serializers.SerializerMethodField()
    char_count = serializers.SerializerMethodField()
    images = TweetImageSerializer(many=True, read_only=True)
    tags = serializers.SerializerMethodField()
    reposted_by_me = serializers.SerializerMethodField()
    # #383: reaction の kind 別集計 + viewer 別 my_kind。
    # 形は GET /reactions/ endpoint と同一。
    reaction_summary = serializers.SerializerMethodField()

    class Meta:
        model = Tweet
        fields = [
            "id",
            "author_handle",
            "author_display_name",
            "author_avatar_url",
            "body",
            "html",
            "char_count",
            "created_at",
            "edit_count",
            "last_edited_at",
            "images",
            "tags",
            "type",
            "is_deleted",
            "reply_count",
            "repost_count",
            "quote_count",
            "reaction_count",
            "reposted_by_me",
            "reaction_summary",
            # P13-01: 自動検出された言語コード (ISO 639-1)。 frontend の
            # 「翻訳」 button 表示判定で必要。 null=未検出。
            "language",
        ]
        read_only_fields = fields

    def get_author_handle(self, obj: Tweet) -> str:
        return obj.author.username

    def get_author_display_name(self, obj: Tweet) -> str:
        return obj.author.display_name or obj.author.username

    def get_author_avatar_url(self, obj: Tweet) -> str:
        return obj.author.avatar_url or ""

    def get_html(self, obj: Tweet) -> str:
        return render_markdown(obj.body)

    def get_char_count(self, obj: Tweet) -> int:
        return count_tweet_chars(obj.body) if _HAS_CHAR_COUNT else len(obj.body)

    def get_tags(self, obj: Tweet) -> list[str]:
        return [t.name for t in obj.tags.all()]

    def get_reposted_by_me(self, obj: Tweet) -> bool:
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return False
        prefetched = self.context.get("viewer_repost_ids")
        if prefetched is not None:
            return obj.pk in prefetched
        return Tweet.objects.filter(
            author=request.user,
            type=TweetType.REPOST,
            repost_of=obj,
        ).exists()

    def get_reaction_summary(self, obj: Tweet) -> dict[str, Any]:
        return _build_reaction_summary(obj, self.context.get("request"))


class TweetMiniSerializer(TweetBaseMiniSerializer):
    """#323: 親 tweet (reply_to / quote_of / repost_of) を nested で返す serializer.

    Repost rendering needs the original tweet to be close to a full card, not a
    body-only preview. One extra quote_of level is included so reposting a quote
    still shows the quoted embed, while deeper nesting is intentionally cut off.
    """

    quote_of = serializers.SerializerMethodField()

    class Meta(TweetBaseMiniSerializer.Meta):
        fields = [
            *TweetBaseMiniSerializer.Meta.fields,
            "quote_of",
        ]
        read_only_fields = fields

    def get_quote_of(self, obj: Tweet) -> dict[str, Any] | None:
        if obj.quote_of_id is None:
            return None
        parent = Tweet.all_objects.filter(pk=obj.quote_of_id).select_related("author").first()
        if parent is None:
            return None
        return TweetBaseMiniSerializer(parent, context=self.context).data


class TweetListSerializer(serializers.ModelSerializer):
    """List (GET /api/v1/tweets/) 用の read-only serializer。

    tags は through テーブル TweetTag を経由するが、API 消費側には
    ``[name, name, ...]`` の配列で返す (UI が扱いやすい)。

    #323: P2-15 受入消化のため以下を追加:
    - ``type``: original / reply / repost / quote (UI 分岐用)
    - ``is_deleted``: 削除済みなら true (button disable / tombstone 用)
    - ``reply_count`` / ``repost_count`` / ``quote_count`` / ``reaction_count``: count badge
    - ``reply_to`` / ``quote_of`` / ``repost_of``: 親 tweet の nested summary
    """

    author_handle = serializers.SerializerMethodField()
    html = serializers.SerializerMethodField()
    images = TweetImageSerializer(many=True, read_only=True)
    tags = serializers.SerializerMethodField()
    # #323: nested parent (1 階層のみ、循環防止)。soft-delete された parent も
    # tombstone (is_deleted=True) として返したいので、Tweet.objects (is_deleted
    # =False filter) ではなく all_objects 経由で取得する MethodField にする。
    reply_to = serializers.SerializerMethodField()
    quote_of = serializers.SerializerMethodField()
    repost_of = serializers.SerializerMethodField()
    # #351: viewer (request.user) 視点で「自分がこの tweet を repost 済みか」。
    # frontend の RepostButton.initialReposted に流して、リロード後も
    # 「リポスト済み」状態が UI に反映されるようにする。
    reposted_by_me = serializers.SerializerMethodField()
    # #383: reaction の kind 別集計 + viewer 別 my_kind (GET /reactions/ と同形)。
    reaction_summary = serializers.SerializerMethodField()

    class Meta:
        model = Tweet
        fields = [
            "id",
            "author_handle",
            "body",
            "html",
            "created_at",
            "edit_count",
            "last_edited_at",
            "images",
            "tags",
            # #323 P2-15 follow-up
            "type",
            "is_deleted",
            "reply_count",
            "repost_count",
            "quote_count",
            "reaction_count",
            "reply_to",
            "quote_of",
            "repost_of",
            # #351
            "reposted_by_me",
            # #383
            "reaction_summary",
            # P13-01: 自動検出された言語コード (ISO 639-1)。 frontend の
            # 「翻訳」 button 表示判定で必要。 null=未検出。
            "language",
        ]
        read_only_fields = fields

    def get_author_handle(self, obj: Tweet) -> str:
        return obj.author.username

    def get_html(self, obj: Tweet) -> str:
        return render_markdown(obj.body)

    def get_tags(self, obj: Tweet) -> list[str]:
        # prefetch 済み (view 側で prefetch_related) を前提に、追加の SQL を撃たない。
        return [t.name for t in obj.tags.all()]

    def _resolve_parent(self, parent_id: int | None) -> dict[str, Any] | None:
        """nested parent (reply_to / quote_of / repost_of) を all_objects 経由で取得.

        soft-delete された tweet も tombstone (is_deleted=True) として返すため、
        Tweet.objects (is_deleted=False filter) ではなく all_objects を使う。
        N+1 を避けるため select_related("author") を view 側で適用済 (FK 経由で
        cache されている前提)。
        """
        if parent_id is None:
            return None
        parent = Tweet.all_objects.filter(pk=parent_id).select_related("author").first()
        if parent is None:
            return None
        return TweetMiniSerializer(parent, context=self.context).data

    def get_reply_to(self, obj: Tweet) -> dict[str, Any] | None:
        return self._resolve_parent(obj.reply_to_id)

    def get_quote_of(self, obj: Tweet) -> dict[str, Any] | None:
        return self._resolve_parent(obj.quote_of_id)

    def get_repost_of(self, obj: Tweet) -> dict[str, Any] | None:
        return self._resolve_parent(obj.repost_of_id)

    def get_reposted_by_me(self, obj: Tweet) -> bool:
        """#351: viewer 視点での repost 状態.

        N+1 を避けるため context["viewer_repost_ids"] に **既に prefetch 済の
        id 集合** が入っていれば優先して使う。view 側 (TimelineView 等) が
        list 描画時に 1 query でまとめ取得できる。fallback は per-row EXISTS
        クエリ (詳細 view など 1 件取得時のみ許容).
        """
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return False
        prefetched = self.context.get("viewer_repost_ids")
        if prefetched is not None:
            return obj.pk in prefetched
        return Tweet.objects.filter(
            author=request.user,
            type=TweetType.REPOST,
            repost_of=obj,
        ).exists()

    def get_reaction_summary(self, obj: Tweet) -> dict[str, Any]:
        return _build_reaction_summary(obj, self.context.get("request"))


class TweetDetailSerializer(TweetListSerializer):
    """Detail (GET /api/v1/tweets/<id>/) 用 serializer。

    List に加えて author の表示情報 (display_name / avatar_url) を返す。
    """

    author_display_name = serializers.SerializerMethodField()
    author_avatar_url = serializers.SerializerMethodField()

    class Meta(TweetListSerializer.Meta):
        fields = [
            *TweetListSerializer.Meta.fields,
            "author_display_name",
            "author_avatar_url",
        ]
        read_only_fields = fields

    def get_author_display_name(self, obj: Tweet) -> str:
        # display_name は blank=True / default="" なので fallback で username
        return obj.author.display_name or obj.author.username

    def get_author_avatar_url(self, obj: Tweet) -> str:
        return obj.author.avatar_url or ""


# -----------------------------------------------------------------------------
# Create serializer
# -----------------------------------------------------------------------------


class TweetCreateSerializer(serializers.Serializer):
    """POST /api/v1/tweets/ 用の write-only serializer。

    tags は承認済みタグ名の配列を受け取り、内部で ``Tag`` 解決 → ``TweetTag`` 作成。
    images は ``{image_url, width, height, order}`` の配列を受け取り、
    ``TweetImage.objects.create`` で 1 件ずつ保存する (``TweetImage.save()`` 内部で
    ``full_clean()`` が走るので URL スキーム / 枚数制限が再度 enforce される)。
    """

    body = serializers.CharField(max_length=TWEET_BODY_MAX_LENGTH)
    tags = serializers.ListField(
        child=serializers.CharField(max_length=50),
        max_length=TWEET_MAX_TAGS,
        required=False,
        default=list,
    )
    images = TweetImageSerializer(many=True, required=False, default=list)

    def validate_body(self, value: str) -> str:
        """本文の文字数チェック。

        P1-10 (char_count) が merge されていれば ``count_tweet_chars`` で
        絵文字 / 合字を 1 文字としてカウントする。未 merge 期間は ``len()`` 相当
        (= CharField(max_length=180) の既存検証) にフォールバックする。
        """
        count = count_tweet_chars(value) if _HAS_CHAR_COUNT else len(value)
        if count > TWEET_MAX_CHARS:
            raise serializers.ValidationError(
                f"本文は {TWEET_MAX_CHARS} 字以内で入力してください。"
            )
        return value

    def validate_tags(self, value: list[str]) -> list[str]:
        """全てのタグ名が is_approved=True のタグとして存在することを確認する。"""
        if not value:
            return value
        # 重複は排除するがユーザー指定の順序は保つ
        seen: set[str] = set()
        unique: list[str] = []
        for name in value:
            lowered = name.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            unique.append(lowered)

        if len(unique) > TWEET_MAX_TAGS:
            raise serializers.ValidationError(f"タグは最大 {TWEET_MAX_TAGS} 個まで指定できます。")

        # Tag.objects (= ApprovedTagManager) が既に is_approved=True で絞るが、
        # defense-in-depth と可読性のため is_approved=True を明示する。
        existing = set(
            Tag.objects.filter(name__in=unique, is_approved=True).values_list("name", flat=True)
        )
        missing = [n for n in unique if n not in existing]
        if missing:
            raise serializers.ValidationError(
                f"承認済みタグではない、または存在しないタグが含まれています: {missing}"
            )
        return unique

    def validate_images(self, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len(value) > TWEET_MAX_IMAGES:
            raise serializers.ValidationError(f"画像は最大 {TWEET_MAX_IMAGES} 枚まで添付できます。")
        return value

    @transaction.atomic
    def create(self, validated_data: dict[str, Any]) -> Tweet:
        """Tweet + TweetTag + TweetImage をトランザクション内で一括作成する。"""
        tags: list[str] = validated_data.pop("tags", [])
        images: list[dict[str, Any]] = validated_data.pop("images", [])
        author = validated_data.pop("author")
        # defensive: pop() で取り出しておくことで、以降 validated_data を
        # Tweet.objects.create(**validated_data) のように unpack しても
        # 重複キー / 未知フィールドで落ちないようにする。
        body: str = validated_data.pop("body")

        # validated_data に残っている view 由来の kwargs (type / quote_of /
        # reply_to / repost_of) を Tweet.objects.create に通す。これがないと
        # Quote/Reply のときに type=ORIGINAL のまま Tweet が作られて signal
        # が `quote_count` / `reply_count` を更新せず test_actions_api の
        # `test_quote_creates_with_body_201` 等が落ちる (P2-06 残バグ)。
        tweet = Tweet.objects.create(author=author, body=body, **validated_data)

        if tags:
            # validate_tags で存在確認済みなので、dict 経由で一括取得する
            tag_map = {t.name: t for t in Tag.objects.filter(name__in=tags)}
            for name in tags:
                TweetTag.objects.create(tweet=tweet, tag=tag_map[name])

        for img in images:
            TweetImage.objects.create(tweet=tweet, **img)

        return tweet


# -----------------------------------------------------------------------------
# Update serializer
# -----------------------------------------------------------------------------


class TweetUpdateSerializer(serializers.Serializer):
    """PATCH /api/v1/tweets/<id>/ 用の write-only serializer。

    本文だけが編集可能。tags / images は編集不可 (SPEC §3.5)。
    実際の編集は ``Tweet.record_edit`` に委譲する — これにより:
      - 30 分以内制約
      - 5 回制約
      - TweetEdit の自動生成
      - edit_count の原子インクリメント
    が全て担保される。
    """

    body = serializers.CharField(max_length=TWEET_BODY_MAX_LENGTH)

    def validate_body(self, value: str) -> str:
        count = count_tweet_chars(value) if _HAS_CHAR_COUNT else len(value)
        if count > TWEET_MAX_CHARS:
            raise serializers.ValidationError(
                f"本文は {TWEET_MAX_CHARS} 字以内で入力してください。"
            )
        return value

    def update(self, instance: Tweet, validated_data: dict[str, Any]) -> Tweet:
        """``Tweet.record_edit`` に委譲する。

        editor は context['request'].user から取得する。
        record_edit は ValidationError を投げる可能性があるので、
        view 側 ``perform_update`` はそれを 400 に map する。
        """
        editor = self.context["request"].user
        instance.record_edit(new_body=validated_data["body"], editor=editor)
        return instance
