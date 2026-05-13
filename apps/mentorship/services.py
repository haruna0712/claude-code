"""Service layer for mentorship business logic (P11-05).

`accept_proposal` を atomic に行うため view 層から分離。 既存 `apps.dm.services`
の流儀 (transaction.atomic + cursor advisory lock) を踏襲する設計だが、 ここでは
`(proposal, by_user)` が冪等に同じ contract を返せれば良いので advisory lock は
省略 (proposal の OneToOneField 制約と request.status の guard で十分)。

spec: ``docs/specs/phase-11-mentor-board-spec.md`` §3.2, §6.2
"""

from __future__ import annotations

from django.contrib.auth.models import AbstractBaseUser
from django.db import transaction
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
