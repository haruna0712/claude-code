"""Unit tests for apps.tags.models.Tag (P1-05)."""

from __future__ import annotations

from django.test import TestCase

from apps.tags.models import Tag


class TagModelTests(TestCase):
    def test_save_normalizes_name_to_lowercase(self) -> None:
        """save() override が name を小文字化すること."""
        tag = Tag.objects.create(name="TypeScript", display_name="TypeScript")
        tag.refresh_from_db()
        self.assertEqual(tag.name, "typescript")
        # display_name は原文のまま保持される
        self.assertEqual(tag.display_name, "TypeScript")

    def test_save_normalizes_mixed_case_with_symbols(self) -> None:
        """英字以外の文字を含むケースでも case 部分だけ小文字化されること."""
        tag = Tag.objects.create(name="C++", display_name="C++")
        tag.refresh_from_db()
        self.assertEqual(tag.name, "c++")
        self.assertEqual(tag.display_name, "C++")

    def test_str_returns_display_name(self) -> None:
        """__str__ は display_name を返す (admin / デバッグでの表示用)."""
        tag = Tag.objects.create(name="nextjs", display_name="Next.js")
        self.assertEqual(str(tag), "Next.js")

    def test_defaults(self) -> None:
        """デフォルト値: is_approved=False, usage_count=0, created_by=None."""
        tag = Tag.objects.create(name="python", display_name="Python")
        self.assertFalse(tag.is_approved)
        self.assertEqual(tag.usage_count, 0)
        self.assertIsNone(tag.created_by)

    def test_name_unique(self) -> None:
        """小文字正規化後の name は unique 制約に従う.

        "Python" と "python" は正規化後同一 → IntegrityError で弾かれる.
        """
        from django.db import IntegrityError, transaction

        Tag.objects.create(name="python", display_name="Python")

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Tag.objects.create(name="Python", display_name="Python (dup)")

    def test_ordering_prefers_usage_count_then_name(self) -> None:
        """Meta.ordering = ['-usage_count', 'name'] が効いていること."""
        Tag.objects.create(name="python", display_name="Python", usage_count=100)
        Tag.objects.create(name="rust", display_name="Rust", usage_count=50)
        Tag.objects.create(name="go", display_name="Go", usage_count=50)

        ordered_names = list(Tag.objects.values_list("name", flat=True))
        # 最初: usage 100 の python, 次に usage 50 の go / rust を name 昇順
        self.assertEqual(ordered_names, ["python", "go", "rust"])
