"""Block / Mute / Report モデルテスト (Phase 4B / Issues #443 #444 #446)."""

from __future__ import annotations

import pytest
from django.db import IntegrityError

from apps.moderation.tests._factories import make_block, make_mute, make_user


@pytest.mark.django_db
class TestBlock:
    def test_create(self) -> None:
        a = make_user()
        b = make_user()
        block = make_block(a, b)
        assert block.blocker == a
        assert block.blockee == b

    def test_unique(self) -> None:
        a = make_user()
        b = make_user()
        make_block(a, b)
        with pytest.raises(IntegrityError):
            make_block(a, b)

    def test_self_block_forbidden(self) -> None:
        a = make_user()
        with pytest.raises(IntegrityError):
            make_block(a, a)


@pytest.mark.django_db
class TestMute:
    def test_create(self) -> None:
        a = make_user()
        b = make_user()
        mute = make_mute(a, b)
        assert mute.muter == a
        assert mute.mutee == b

    def test_unique(self) -> None:
        a = make_user()
        b = make_user()
        make_mute(a, b)
        with pytest.raises(IntegrityError):
            make_mute(a, b)

    def test_self_mute_forbidden(self) -> None:
        a = make_user()
        with pytest.raises(IntegrityError):
            make_mute(a, a)


@pytest.mark.django_db
class TestReport:
    def test_create_pending(self) -> None:
        from apps.moderation.models import Report

        reporter = make_user()
        r = Report.objects.create(
            reporter=reporter,
            target_type=Report.Target.TWEET,
            target_id="42",
            reason=Report.Reason.SPAM,
            note="繰り返し広告",
        )
        assert r.status == Report.Status.PENDING
        assert r.resolved_at is None
        assert r.resolved_by is None

    def test_target_id_charfield_accepts_uuid_and_int(self) -> None:
        from apps.moderation.models import Report

        reporter = make_user()
        r1 = Report.objects.create(
            reporter=reporter,
            target_type=Report.Target.TWEET,
            target_id="42",
            reason=Report.Reason.SPAM,
        )
        r2 = Report.objects.create(
            reporter=reporter,
            target_type=Report.Target.USER,
            target_id="00000000-0000-0000-0000-000000000001",
            reason=Report.Reason.ABUSE,
        )
        assert r1.pk and r2.pk

    def test_reason_choices_invalid_rejected(self) -> None:
        from django.core.exceptions import ValidationError

        from apps.moderation.models import Report

        reporter = make_user()
        r = Report(
            reporter=reporter,
            target_type=Report.Target.TWEET,
            target_id="1",
            reason="not_a_real_reason",
        )
        with pytest.raises(ValidationError):
            r.full_clean()
