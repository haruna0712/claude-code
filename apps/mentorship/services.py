"""Service layer for mentorship business logic (P11-05).

`accept_proposal` を atomic に行うため view 層から分離。 既存 `apps.dm.services`
の流儀 (transaction.atomic + cursor advisory lock) を踏襲する設計だが、 ここでは
`(proposal, by_user)` が冪等に同じ contract を返せれば良いので advisory lock は
省略 (proposal の OneToOneField 制約と request.status の guard で十分)。

spec: ``docs/specs/phase-11-mentor-board-spec.md`` §3.2, §6.2
"""

from __future__ import annotations

from django.contrib.auth.models import AbstractBaseUser
from django.db import models, transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.dm.models import DMRoom, DMRoomMembership
from apps.mentorship.models import (
    MentorProposal,
    MentorRequest,
    MentorshipContract,
)


def accept_proposal(
    *,
    proposal: MentorProposal,
    by_user: AbstractBaseUser,
) -> MentorshipContract:
    """proposal を accept して `MentorshipContract` + `DMRoom (kind=MENTORSHIP)` を作る。

    - `by_user` は `proposal.request.mentee` 必須 (本人以外は PermissionDenied)
    - 既に accept 済 (`proposal.status == ACCEPTED` かつ contract 存在) なら冪等に
      既存 contract を返す
    - request.status が OPEN 以外なら ValidationError (MATCHED で別 proposal を
      二重 accept しようとした、 等)
    - self-accept は禁止 (mentee == mentor のとき ValidationError)
    """

    # by_user は request.mentee 本人であることを check
    request: MentorRequest = proposal.request
    if request.mentee_id != by_user.pk:
        raise PermissionDenied("自分の募集の提案のみ accept できます")

    # mentor がたまたま自分自身 (proposal 投稿側の validate で防ぐべき、 二重防御)
    if proposal.mentor_id == request.mentee_id:
        raise ValidationError("自分自身からの提案は accept できません")

    # 既に accept 済 → 冪等に同じ contract を返す
    if proposal.status == MentorProposal.Status.ACCEPTED:
        existing = MentorshipContract.objects.filter(proposal=proposal).first()
        if existing is not None:
            return existing
        # accept 済表示で contract が無い (race / inconsistent) は再生成へ

    if proposal.status not in {
        MentorProposal.Status.PENDING,
        MentorProposal.Status.ACCEPTED,
    }:
        raise ValidationError("rejected / withdrawn な提案は accept できません")

    if request.status != MentorRequest.Status.OPEN:
        # MATCHED / CLOSED / EXPIRED
        raise ValidationError("この募集は受付終了済です")

    with transaction.atomic():
        # 専用 DMRoom (kind=MENTORSHIP) を作って両者を member に追加。
        room = DMRoom.objects.create(kind=DMRoom.Kind.MENTORSHIP)
        DMRoomMembership.objects.create(room=room, user=request.mentee)
        DMRoomMembership.objects.create(room=room, user=proposal.mentor)

        # P11 follow-up #669: mentor が proposal を送って accept されたら mentor
        # activity あり判定なので、 MentorProfile が未作成なら placeholder で
        # auto-create する。 これがないと review が投稿されても /mentors/<handle>
        # が 404 になって review が表示先を失う (orphan review 問題)。
        from apps.mentorship.models import MentorProfile  # 循環回避の局所 import

        MentorProfile.objects.get_or_create(
            user=proposal.mentor,
            defaults={
                "headline": "メンター",
                "bio": "プロフィールは未設定です。 /mentors/me/edit から編集できます。",
                "experience_years": 0,
            },
        )

        # contract row。 plan_snapshot は P11-12 で plan 連携時に詳細を埋める。
        contract = MentorshipContract.objects.create(
            proposal=proposal,
            mentee=request.mentee,
            mentor=proposal.mentor,
            room=room,
            plan_snapshot={},
        )

        now = timezone.now()
        # proposal を ACCEPTED に
        proposal.status = MentorProposal.Status.ACCEPTED
        proposal.responded_at = now
        proposal.save(update_fields=["status", "responded_at", "updated_at"])

        # request を MATCHED に (他 proposal は PENDING のまま残る、 spec R8)
        request.status = MentorRequest.Status.MATCHED
        request.save(update_fields=["status", "updated_at"])

    return contract


def get_proposal_or_404(pk: int) -> MentorProposal:
    proposal = (
        MentorProposal.objects.select_related("request", "request__mentee", "mentor")
        .filter(pk=pk)
        .first()
    )
    if proposal is None:
        raise NotFound("MentorProposal not found")
    return proposal


# --- contract state transitions (P11-17) ---


def get_contract_or_404(pk: int) -> MentorshipContract:
    contract = (
        MentorshipContract.objects.select_related("mentee", "mentor", "room").filter(pk=pk).first()
    )
    if contract is None:
        raise NotFound("MentorshipContract not found")
    return contract


def complete_contract(
    *,
    contract: MentorshipContract,
    by_user: AbstractBaseUser,
) -> MentorshipContract:
    """契約を COMPLETED に。 mentee / mentor どちらでも実行可。

    既に COMPLETED なら冪等。 CANCELED は不可 (PermissionDenied 相当の
    ValidationError)。 完了時に DMRoom.is_archived=True にして read-only UI 用 flag を
    立てる (P11-19 で frontend が消費)。
    """

    if by_user.pk not in {contract.mentee_id, contract.mentor_id}:
        raise PermissionDenied("契約当事者のみ完了できます")

    if contract.status == MentorshipContract.Status.COMPLETED:
        return contract
    if contract.status == MentorshipContract.Status.CANCELED:
        raise ValidationError("キャンセル済の契約は完了できません")

    with transaction.atomic():
        now = timezone.now()
        contract.status = MentorshipContract.Status.COMPLETED
        contract.completed_at = now
        contract.save(update_fields=["status", "completed_at", "updated_at"])

        # DMRoom を archived に (composer 無効 + 「契約完了」 banner 用)。
        room = contract.room
        if not room.is_archived:
            room.is_archived = True
            room.save(update_fields=["is_archived", "updated_at"])

        # mentor profile の集計 (contract_count) を atomic に +1。
        from apps.mentorship.models import MentorProfile  # 局所 import (循環回避)

        MentorProfile.objects.filter(user=contract.mentor).update(
            contract_count=models.F("contract_count") + 1,
        )

    return contract


def cancel_contract(
    *,
    contract: MentorshipContract,
    by_user: AbstractBaseUser,
) -> MentorshipContract:
    """契約をキャンセル。 mentee / mentor どちらでも実行可。

    既に CANCELED なら冪等。 COMPLETED は不可 (一度完了した契約は取り消せない)。
    DMRoom も archived に。
    """

    if by_user.pk not in {contract.mentee_id, contract.mentor_id}:
        raise PermissionDenied("契約当事者のみキャンセルできます")

    if contract.status == MentorshipContract.Status.CANCELED:
        return contract
    if contract.status == MentorshipContract.Status.COMPLETED:
        raise ValidationError("完了済の契約はキャンセルできません")

    with transaction.atomic():
        contract.status = MentorshipContract.Status.CANCELED
        contract.save(update_fields=["status", "updated_at"])
        room = contract.room
        if not room.is_archived:
            room.is_archived = True
            room.save(update_fields=["is_archived", "updated_at"])

    return contract


# --- review submission (P11-20) ---


def submit_review(
    *,
    contract: MentorshipContract,
    by_user: AbstractBaseUser,
    rating: int,
    comment: str,
):
    """contract.mentee のみが、 COMPLETED 契約に対して 1 回だけ review 投稿可能。

    投稿後に MentorProfile.avg_rating / review_count を atomic に再集計。
    """

    from apps.mentorship.models import MentorProfile, MentorReview

    if contract.mentee_id != by_user.pk:
        raise PermissionDenied("レビューは mentee のみ投稿できます")
    if contract.status != MentorshipContract.Status.COMPLETED:
        raise ValidationError("完了済の契約のみレビュー可能です")
    if rating < 1 or rating > 5:
        raise ValidationError("rating は 1-5 の範囲です")

    with transaction.atomic():
        review, created = MentorReview.objects.get_or_create(
            contract=contract,
            defaults={
                "mentor": contract.mentor,
                "mentee": contract.mentee,
                "rating": rating,
                "comment": comment,
            },
        )
        if not created:
            # 既存 review を上書き編集 (mentee は同じ contract に 1 件しか持てない)。
            review.rating = rating
            review.comment = comment
            review.save(update_fields=["rating", "comment", "updated_at"])

        # MentorProfile 集計を再計算 (review_count + avg_rating)。
        profile = MentorProfile.objects.filter(user=contract.mentor).first()
        if profile is not None:
            agg = MentorReview.objects.filter(mentor=contract.mentor, is_visible=True).aggregate(
                count=models.Count("id"),
                avg=models.Avg("rating"),
            )
            profile.review_count = agg["count"] or 0
            profile.avg_rating = agg["avg"]
            profile.save(update_fields=["review_count", "avg_rating", "updated_at"])

    return review
