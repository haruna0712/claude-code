"""Admin registrations for the articles app (#524 / Phase 6 P6-01)."""

from __future__ import annotations

from django.contrib import admin

from apps.articles.models import (
    Article,
    ArticleComment,
    ArticleImage,
    ArticleLike,
    ArticleTag,
)


class ArticleTagInline(admin.TabularInline):
    model = ArticleTag
    extra = 0
    autocomplete_fields = ("tag",)


@admin.action(description="選択した記事を soft_delete する")
def soft_delete_articles(modeladmin, request, queryset):
    """python-reviewer #541 MEDIUM: is_deleted を直書きすると deleted_at が
    null のまま不整合になるため、必ず Article.soft_delete() を経由する."""

    for article in queryset:
        article.soft_delete()


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "author",
        "slug",
        "status",
        "published_at",
        "view_count",
        "is_deleted",
        "updated_at",
    )
    list_filter = ("status", "is_deleted", "created_at")
    search_fields = ("title", "slug", "author__username", "author__email")
    # is_deleted / deleted_at は admin から直書き禁止 (action 経由で soft_delete)
    readonly_fields = (
        "id",
        "view_count",
        "is_deleted",
        "deleted_at",
        "created_at",
        "updated_at",
    )
    autocomplete_fields = ("author",)
    inlines = [ArticleTagInline]
    actions = [soft_delete_articles]

    # 削除済も admin で見られるよう all_objects を使う
    def get_queryset(self, request):
        return Article.all_objects.all()


@admin.register(ArticleImage)
class ArticleImageAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "article",
        "uploader",
        "s3_key",
        "width",
        "height",
        "size",
        "created_at",
    )
    list_filter = ("created_at",)
    search_fields = ("s3_key", "uploader__username")
    readonly_fields = ("id", "created_at")
    autocomplete_fields = ("article", "uploader")


@admin.register(ArticleLike)
class ArticleLikeAdmin(admin.ModelAdmin):
    list_display = ("article", "user", "created_at")
    list_filter = ("created_at",)
    search_fields = ("article__title", "user__username")
    autocomplete_fields = ("article", "user")


@admin.action(description="選択したコメントを soft_delete する")
def soft_delete_comments(modeladmin, request, queryset):
    for c in queryset:
        c.soft_delete()


@admin.register(ArticleComment)
class ArticleCommentAdmin(admin.ModelAdmin):
    list_display = ("id", "article", "author", "parent", "is_deleted", "created_at")
    list_filter = ("is_deleted", "created_at")
    search_fields = ("body", "article__title", "author__username")
    readonly_fields = ("id", "is_deleted", "deleted_at", "created_at", "updated_at")
    autocomplete_fields = ("article", "author", "parent")
    actions = [soft_delete_comments]

    def get_queryset(self, request):
        return ArticleComment.all_objects.all()


@admin.register(ArticleTag)
class ArticleTagAdmin(admin.ModelAdmin):
    list_display = ("article", "tag", "sort_order", "created_at")
    autocomplete_fields = ("article", "tag")
