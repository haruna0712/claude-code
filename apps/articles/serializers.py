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

from apps.articles.models import Article, ArticleImage, ArticleStatus
from apps.articles.s3_presign import ALLOWED_CONTENT_TYPES, MAX_CONTENT_LENGTH
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


# --------------------------------------------------------------------------
# 画像アップロード (P6-04 / docs/specs/article-image-upload-spec.md)
# --------------------------------------------------------------------------


class PresignImageInputSerializer(serializers.Serializer):
    """`POST /articles/images/presign/` の入力検証.

    値そのものの allowlist / size 上限は :func:`apps.articles.s3_presign.validate_image_request`
    で最終確認するが、 ここでも UX のために早期 400 を返す。
    """

    filename = serializers.CharField(min_length=1, max_length=200)
    mime_type = serializers.ChoiceField(choices=sorted(ALLOWED_CONTENT_TYPES))
    size = serializers.IntegerField(min_value=1, max_value=MAX_CONTENT_LENGTH)


class ConfirmImageInputSerializer(serializers.Serializer):
    """`POST /articles/images/confirm/` の入力検証.

    width / height は frontend が ``HTMLImageElement.naturalWidth/Height`` から取得する想定。

    NOTE (security-reviewer M-1 反映): ``s3_key`` は ``RegexField`` で
    ``[a-zA-Z0-9._/-]`` のみを accept する。 ``posixpath.normpath`` は path
    separator ベースの正規化しかしないため、 制御文字 (`\\t`、`\\n`、`\\r`、
    `\\x00`、`\\x7f` 等) が valid prefix の後に紛れ込むと normpath = 元 で
    通過してしまい boto3 内部まで到達する defense-in-depth gap が DM 添付には
    存在した (DM 側にも同じ穴があり別 issue で起票予定)。 本 PR では allowlist
    に絞ることで制御文字を入力段階で 400 にする。
    """

    s3_key = serializers.RegexField(
        regex=r"^[a-zA-Z0-9._/-]+$",
        min_length=1,
        max_length=512,
    )
    filename = serializers.CharField(min_length=1, max_length=200)
    mime_type = serializers.ChoiceField(choices=sorted(ALLOWED_CONTENT_TYPES))
    size = serializers.IntegerField(min_value=1, max_value=MAX_CONTENT_LENGTH)
    width = serializers.IntegerField(min_value=1, max_value=10000)
    height = serializers.IntegerField(min_value=1, max_value=10000)


class ArticleImageOutputSerializer(serializers.ModelSerializer):
    """`/articles/images/confirm/` の 201 response。 frontend が Markdown に挿入する ``url`` を含む."""

    class Meta:
        model = ArticleImage
        fields = (
            "id",
            "s3_key",
            "url",
            "width",
            "height",
            "size",
            "created_at",
        )
        read_only_fields = fields
