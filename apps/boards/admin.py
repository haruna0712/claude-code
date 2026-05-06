"""Admin registrations for boards (Phase 5).

- Board: 完全 CRUD
- Thread: 一覧・詳細・削除可 (論理削除)。新規作成は admin からは行わない (UI から)。
- ThreadPost: 一覧・詳細・削除可 (論理削除)
"""

from __future__ import annotations

from typing import Any

from django.contrib import admin
from django.utils import timezone

from apps.boards.models import Board, Thread, ThreadPost, ThreadPostImage


@admin.register(Board)
class BoardAdmin(admin.ModelAdmin):
    list_display = ("slug", "name", "order", "color", "created_at")
    search_fields = ("slug", "name")
    list_editable = ("order",)
    prepopulated_fields = {"slug": ("name",)}


class ThreadPostInline(admin.TabularInline):
    model = ThreadPost
    fields = ("number", "author", "is_deleted", "deleted_at", "created_at")
    readonly_fields = ("number", "author", "created_at")
    extra = 0
    can_delete = False
    show_change_link = True


@admin.register(Thread)
class ThreadAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "board",
        "title",
        "author",
        "post_count",
        "locked",
        "is_deleted",
        "last_post_at",
    )
    list_filter = ("board", "locked", "is_deleted")
    search_fields = ("title",)
    readonly_fields = ("post_count", "last_post_at", "created_at", "updated_at")
    actions = ["soft_delete_threads"]
    inlines = [ThreadPostInline]

    @admin.action(description="選択したスレッドを論理削除する")
    def soft_delete_threads(self, request: Any, queryset: Any) -> None:
        # python-reviewer MEDIUM #5: queryset.update は auto_now を発火しないため
        # updated_at を明示的に渡してダウンストリームの cache-bust 等を整合させる。
        now = timezone.now()
        queryset.update(is_deleted=True, deleted_at=now, updated_at=now)


class ThreadPostImageInline(admin.TabularInline):
    model = ThreadPostImage
    extra = 0


@admin.register(ThreadPost)
class ThreadPostAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "thread",
        "number",
        "author",
        "is_deleted",
        "created_at",
    )
    list_filter = ("is_deleted",)
    search_fields = ("body",)
    readonly_fields = ("thread", "number", "author", "created_at", "updated_at")
    inlines = [ThreadPostImageInline]
    actions = ["soft_delete_posts"]

    @admin.action(description="選択したレスを論理削除する")
    def soft_delete_posts(self, request: Any, queryset: Any) -> None:
        # python-reviewer MEDIUM #5: queryset.update は auto_now を発火しないため
        # updated_at を明示的に渡してダウンストリームの cache-bust 等を整合させる。
        now = timezone.now()
        queryset.update(is_deleted=True, deleted_at=now, updated_at=now)
