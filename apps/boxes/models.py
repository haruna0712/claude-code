"""Models for the boxes app (#499 / Phase 4A お気に入り).

docs/specs/favorites-spec.md §3 を実装する。SPEC §9 の「ボックス」 を Google /
Edge ブックマーク風の **任意深さフォルダツリー** に拡張。

- Folder: ユーザー所有のフォルダ。self FK で nest 可能 (MAX_FOLDER_DEPTH=10)
- Bookmark: 1 (folder, tweet) ペアごとの保存レコード
- 本人以外は閲覧 / 操作不可 (SPEC §9 「完全非公開」)
"""

from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

# Google ブックマークも実用上 6〜7 層程度。Folder.parent の循環や深すぎる
# nesting を避ける運用上の安全弁。
MAX_FOLDER_DEPTH = 10


class Folder(models.Model):
    """お気に入りフォルダ. parent=NULL がルート."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="folders",
    )
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="children",
    )
    # SPEC §9 "1〜50 字"
    name = models.CharField(max_length=50)
    # 同じ親 fold 内での並び順 (UI 操作は将来追加、MVP は default 0)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "parent", "name"],
                name="uniq_folder_per_parent",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "parent"]),
        ]

    def __str__(self) -> str:
        return f"@{self.user_id}: {self.name}"

    def clean(self) -> None:
        """循環 / 深さ / 親の所有者をチェック (services 層からも明示的に呼ばれる)."""

        if self.parent_id is None:
            return

        # parent_id 経由で 1 回だけ取得 (full_clean 経由で並行削除されているケースも考慮)
        parent_obj = Folder.objects.filter(pk=self.parent_id).first()
        if parent_obj is None:
            raise ValidationError({"parent": "親フォルダが見つかりません"})

        if parent_obj.user_id != self.user_id:
            raise ValidationError({"parent": "他のユーザーのフォルダは親に指定できません"})
        if self.parent_id == self.pk:
            raise ValidationError({"parent": "自分自身を親に指定できません"})

        # 深さチェック: parent から root までの段数 + 1 が MAX を超えてはいけない
        depth = 1
        cursor: Folder | None = parent_obj
        while cursor is not None:
            depth += 1
            if depth > MAX_FOLDER_DEPTH:
                raise ValidationError(
                    {"parent": (f"フォルダの深さ上限 ({MAX_FOLDER_DEPTH}) を超えています")}
                )
            cursor = (
                Folder.objects.filter(pk=cursor.parent_id).first()
                if cursor.parent_id is not None
                else None
            )

        # 子孫を親にしようとしている (循環)
        descendant_ids = self._collect_descendant_ids()
        if self.parent_id in descendant_ids:
            raise ValidationError({"parent": "子孫フォルダを親に指定できません"})

    def _collect_descendant_ids(self) -> set[int]:
        """自分の子孫すべての pk セットを返す (循環検出用)."""

        if self.pk is None:
            return set()
        ids: set[int] = set()
        queue: list[int] = [self.pk]
        while queue:
            current = queue.pop()
            child_ids = list(Folder.objects.filter(parent_id=current).values_list("pk", flat=True))
            ids.update(child_ids)
            queue.extend(child_ids)
        return ids


class Bookmark(models.Model):
    """ツイートをフォルダに保存するレコード."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="bookmarks",
    )
    folder = models.ForeignKey(
        Folder,
        on_delete=models.CASCADE,
        related_name="bookmarks",
    )
    tweet = models.ForeignKey(
        "tweets.Tweet",
        on_delete=models.CASCADE,
        related_name="bookmarked_by",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            # (folder, tweet) で一意 (同一フォルダ内重複禁止)。
            # user は folder.user と整合する想定だが、view 層で必ず request.user を渡す。
            models.UniqueConstraint(
                fields=["folder", "tweet"],
                name="uniq_bookmark_per_folder",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["folder", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"@{self.user_id} -> {self.folder_id} (tweet {self.tweet_id})"
