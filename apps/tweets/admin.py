"""Admin registrations for the tweets app (P1-07).

`Tweet` / `TweetImage` / `TweetTag` / `TweetEdit` の管理画面を提供する。
デフォルトの `objects` は削除済みを除外するため、管理画面では
`all_objects` を使って削除済みも含めて閲覧可能にする (is_deleted でフィルタ可)。
"""

from __future__ import annotations

from django.contrib import admin

from apps.tweets.models import Tweet, TweetEdit, TweetImage, TweetTag


class TweetImageInline(admin.TabularInline):
    """TweetAdmin の画像インライン。"""

    model = TweetImage
    extra = 0
    fields = ("order", "image_url", "width", "height")


class TweetTagInline(admin.TabularInline):
    """TweetAdmin のタグインライン (through モデル)。"""

    model = TweetTag
    extra = 0
    fields = ("tag", "created_at")
    readonly_fields = ("created_at",)
    autocomplete_fields = ("tag",)


@admin.register(Tweet)
class TweetAdmin(admin.ModelAdmin):
    """Tweet 管理画面。

    削除済みも含めて閲覧できるよう :pyattr:`Tweet.all_objects` を使う。
    """

    list_display = (
        "id",
        "author",
        "body_preview",
        "created_at",
        "edit_count",
        "is_deleted",
    )
    list_filter = ("is_deleted", "created_at")
    search_fields = ("body", "author__username")
    readonly_fields = ("created_at", "updated_at", "last_edited_at", "deleted_at")
    inlines = (TweetImageInline, TweetTagInline)

    def get_queryset(self, request):  # type: ignore[override]
        # 管理画面では削除済みも表示する
        return Tweet.all_objects.get_queryset()

    @admin.display(description="body")
    def body_preview(self, obj: Tweet) -> str:
        """一覧で本文の先頭 40 字を表示する。"""

        body = obj.body or ""
        return body if len(body) <= 40 else body[:40] + "…"


@admin.register(TweetImage)
class TweetImageAdmin(admin.ModelAdmin):
    list_display = ("id", "tweet", "order", "image_url", "width", "height")
    list_filter = ("order",)
    search_fields = ("tweet__id", "image_url")


@admin.register(TweetTag)
class TweetTagAdmin(admin.ModelAdmin):
    list_display = ("id", "tweet", "tag", "created_at")
    search_fields = ("tweet__id", "tag__name")
    autocomplete_fields = ("tag",)


@admin.register(TweetEdit)
class TweetEditAdmin(admin.ModelAdmin):
    list_display = ("id", "tweet", "editor", "edited_at")
    list_filter = ("edited_at",)
    search_fields = ("tweet__id", "editor__username")
    readonly_fields = ("edited_at",)
