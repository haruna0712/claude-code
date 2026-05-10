"""DRF serializers for articles (#526 / Phase 6 P6-03).

docs/issues/phase-6.md P6-03 + SPEC §12 を実装。

- 出力: ArticleSummarySerializer (一覧用、body_html は含めない) /
  ArticleDetailSerializer (詳細用、body_html フル)
- 入力: ArticleCreateInputSerializer / ArticleUpdateInputSerializer
"""

from __future__ import annotations

from typing import Any

from django.utils.text import slugify
from rest_framework import serializers

from apps.articles.models import Article, ArticleStatus
from apps.tags.models import Tag


class _AuthorMiniSerializer(serializers.Serializer):
    """記事 author の最小表現 (TweetCard / 著者カード共通形)."""

    handle = serializers.CharField(source="username", read_only=True)
    display_name = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    def get_display_name(self, obj) -> str:
        # User モデルに get_full_name があれば使う、空なら username
        full = getattr(obj, "get_full_name", lambda: "")()
        return full or obj.username

    def get_avatar_url(self, obj) -> str:
        return getattr(obj, "avatar_url", "") or ""


class ArticleSummarySerializer(serializers.ModelSerializer):
    """記事一覧用 (body_html は重いので含めない)."""

    author = _AuthorMiniSerializer(read_only=True)
    tags = serializers.SerializerMethodField()
    like_count = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = Article
        fields = (
            "id",
            "slug",
            "title",
            "status",
            "published_at",
            "view_count",
            "author",
            "tags",
            "like_count",
            "comment_count",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

    def get_tags(self, obj: Article) -> list[dict[str, Any]]:
        return [
            {"slug": at.tag.name, "display_name": at.tag.display_name}
            for at in obj.article_tags.all().select_related("tag").order_by("sort_order")
        ]

    def get_like_count(self, obj: Article) -> int:
        # P6-05 で properly cache されるが MVP では count() で十分。
        return obj.likes.count()

    def get_comment_count(self, obj: Article) -> int:
        # 論理削除されてないコメントだけカウント (default manager 経由)。
        return obj.comments.count()


class ArticleDetailSerializer(ArticleSummarySerializer):
    """記事詳細用 (body_markdown + body_html を含む)."""

    class Meta(ArticleSummarySerializer.Meta):
        fields = (
            *ArticleSummarySerializer.Meta.fields,
            "body_markdown",
            "body_html",
        )
        read_only_fields = fields


# --------------------------------------------------------------------------
# 入力 (POST / PATCH)
# --------------------------------------------------------------------------


class _TagSlugField(serializers.CharField):
    """Tag.name (slug) を受け取り、未承認 / 不存在は 400 にする."""

    def to_internal_value(self, data) -> Tag:
        slug = super().to_internal_value(data)
        try:
            return Tag.objects.get(name=slug)  # default manager は is_approved=True
        except Tag.DoesNotExist as exc:
            raise serializers.ValidationError(f"未承認 / 存在しないタグ: {slug}") from exc


class ArticleCreateInputSerializer(serializers.Serializer):
    """`POST /articles/` 入力."""

    title = serializers.CharField(min_length=1, max_length=120)
    body_markdown = serializers.CharField(min_length=1, max_length=100_000)
    slug = serializers.SlugField(max_length=120, required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=ArticleStatus.choices, default=ArticleStatus.DRAFT)
    tags = serializers.ListField(
        child=_TagSlugField(),
        required=False,
        max_length=5,  # SPEC §12.1 max 5
        default=list,
    )

    def validate(self, attrs: dict) -> dict:
        # slug 未指定なら title から自動生成。空の slugify (記号のみ) なら 400。
        slug = attrs.get("slug") or slugify(attrs["title"])
        if not slug:
            raise serializers.ValidationError(
                {"slug": "title から slug を生成できませんでした。slug を指定してください"}
            )
        attrs["slug"] = slug
        return attrs


class ArticleUpdateInputSerializer(serializers.Serializer):
    """`PATCH /articles/<slug>/` 入力 (partial update)."""

    title = serializers.CharField(min_length=1, max_length=120, required=False)
    body_markdown = serializers.CharField(min_length=1, max_length=100_000, required=False)
    slug = serializers.SlugField(max_length=120, required=False)
    status = serializers.ChoiceField(choices=ArticleStatus.choices, required=False)
    tags = serializers.ListField(
        child=_TagSlugField(),
        required=False,
        max_length=5,
    )
