"""Mentorship models (Phase 11).

P11-02: MentorRequest を実装。
後続 Issue: MentorProposal (P11-04) / MentorshipContract (P11-05) /
MentorProfile (P11-11) / MentorPlan (P11-12) / MentorReview (P11-20)。

spec: ``docs/specs/phase-11-mentor-board-spec.md`` §4
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

REQUEST_EXPIRY_DAYS = 30


def _default_expires_at():
    """`MentorRequest.expires_at` のデフォルト値。 作成時の `now() + 30 日`。

    Django migration が lambda を serialize できないので module 関数として
    切り出してある。
    """

    return timezone.now() + timedelta(days=REQUEST_EXPIRY_DAYS)


class MentorRequest(models.Model):
    """mentee が出す「メンターを募集します」 投稿 (P11-02)。

    spec §4.3。 `OPEN` 状態でのみ mentor が proposal を出せ、 mentee が accept すると
    `MATCHED`、 期限切れで `EXPIRED`、 手動 close で `CLOSED`。
    """

    class Status(models.TextChoices):
        OPEN = "open", "募集中"
        MATCHED = "matched", "成立済"
        CLOSED = "closed", "終了"
        EXPIRED = "expired", "期限切れ"

    mentee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="mentor_requests",
    )
    title = models.CharField(max_length=80)
    body = models.TextField(max_length=2000)
    # スキル taxonomy は既存 apps.tags.Tag を流用 (spec §3、 重複 master を作らない)。
    target_skill_tags = models.ManyToManyField(
        "tags.Tag",
        related_name="mentor_requests",
        blank=True,
    )
    # Phase 11 は無償ベータ pivot のため 0 推奨だが、 将来 Stripe 連携時に
    # mentee 側の budget hint として残す placeholder。
    budget_jpy = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.OPEN,
    )
    # cached counter。 atomic 更新は P11-04 で proposal 投稿時に F() で行う。
    proposal_count = models.PositiveIntegerField(default=0)
    # 30 日 auto-expire のしきい値。 Celery beat (P11-24) で
    # `status=OPEN AND now()>expires_at` を `EXPIRED` に flip する。
    expires_at = models.DateTimeField(default=_default_expires_at)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            # 一覧 (status=open、 新着順) を高速化。
            models.Index(fields=["status", "-created_at"]),
            # mentee 視点 (自分の募集一覧) を高速化。
            models.Index(fields=["mentee", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"MentorRequest({self.mentee_id}, {self.title[:30]}, {self.status})"


class MentorProposal(models.Model):
    """mentor が `MentorRequest` に対して出す提案 (P11-04)。

    spec §4.4。 1 request に対し 1 mentor は 1 proposal のみ (UniqueConstraint)。
    self-proposal (mentor == request.mentee) は serializer 層で禁止 (CheckConstraint は
    cross-table FK で書けないため)。
    """

    class Status(models.TextChoices):
        PENDING = "pending", "保留中"
        ACCEPTED = "accepted", "承認済"
        REJECTED = "rejected", "却下"
        WITHDRAWN = "withdrawn", "取下げ"

    request = models.ForeignKey(
        MentorRequest,
        on_delete=models.CASCADE,
        related_name="proposals",
    )
    mentor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="proposals_sent",
    )
    body = models.TextField(max_length=2000)
    # plan FK は P11-12 で MentorPlan model 追加時に add_field migration で後付け。
    # 本 P11-04 では plan 連携なしで運用 (proposal は本文だけ送る形)。
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    # accept / reject / withdraw した時刻 (PENDING のうちは null)。
    responded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["request", "mentor"],
                name="unique_request_mentor_proposal",
            ),
        ]
        indexes = [
            # request 詳細で proposals を status 別 group 表示する用。
            models.Index(fields=["request", "status"]),
            # mentor 視点 (自分が出した提案一覧、 新着順)。
            models.Index(fields=["mentor", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"MentorProposal(req={self.request_id}, mentor={self.mentor_id}, {self.status})"


class MentorshipContract(models.Model):
    """proposal を mentee が accept したときに作られる契約 (P11-05)。

    spec §4.5。 既存 `apps.dm.DMRoom` を 1:1 mentee-mentor 専用に流用 (kind=MENTORSHIP)。
    課金 (Stripe) は無償ベータ pivot のため Phase 11 では `is_paid=False`、
    `paid_amount_jpy=0` 固定運用。 後続 Phase 11-E で `stripe_subscription_id` 等を
    migration 追加する。
    """

    class Status(models.TextChoices):
        ACTIVE = "active", "進行中"
        COMPLETED = "completed", "完了"
        CANCELED = "canceled", "キャンセル"

    proposal = models.OneToOneField(
        MentorProposal,
        on_delete=models.PROTECT,
        related_name="contract",
    )
    mentee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="contracts_as_mentee",
    )
    mentor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="contracts_as_mentor",
    )
    # 契約時の plan 内容を JSON で凍結 (Phase 11-B 以降で plan が編集されても契約は不変)。
    # P11-05 単独だと plan 無しなので空 dict、 P11-12 で snapshot を入れる。
    plan_snapshot = models.JSONField(default=dict, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    # 専用 DM room (kind=MENTORSHIP)。 contract と 1:1 対応。
    room = models.OneToOneField(
        "dm.DMRoom",
        on_delete=models.PROTECT,
        related_name="mentorship_contract",
    )
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    # 課金 placeholder (Phase 11-E future)。 Phase 11 では常に False / 0。
    is_paid = models.BooleanField(default=False)
    paid_amount_jpy = models.PositiveIntegerField(default=0)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["mentee", "-started_at"]),
            models.Index(fields=["mentor", "-started_at"]),
        ]

    def __str__(self) -> str:
        return (
            f"MentorshipContract(proposal={self.proposal_id}, "
            f"mentee={self.mentee_id}, mentor={self.mentor_id}, {self.status})"
        )


class MentorProfile(models.Model):
    """mentor として相談を受け付ける User の profile (P11-11)。

    spec §4.1。 User の OneToOne で「mentor offering する人」 だけ row が存在する
    (未設定 = mentor offering なし、 spec §3.1 推奨)。

    P11-11 では検索キャッシュ (proposal_count / contract_count / avg_rating /
    review_count) は default=0 のまま、 P11-12 (Plan) / P11-13 (検索) /
    P11-20 (Review) で個別に集計を更新する。
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="mentor_profile",
    )
    # 検索 / 一覧での 1 行短文。 「AWS infra mentor, ex-SRE」 のような catch copy。
    headline = models.CharField(max_length=80)
    # プロフィール本文。 Markdown 可。 frontend で react-markdown 描画。
    bio = models.TextField(max_length=2000)
    experience_years = models.PositiveSmallIntegerField()
    # 一時的に新規申込を止めたいときに mentor 側で off にする。
    is_accepting = models.BooleanField(default=True)
    # 既存 apps.tags.Tag を流用 (spec §3、 新 master 作らない)。
    skill_tags = models.ManyToManyField(
        "tags.Tag",
        related_name="mentor_profiles",
        blank=True,
    )

    # 検索ランキング用 cached counter (P11-13 で list ordering、 P11-20 で集計更新)。
    proposal_count = models.PositiveIntegerField(default=0)
    contract_count = models.PositiveIntegerField(default=0)
    avg_rating = models.DecimalField(max_digits=3, decimal_places=2, null=True, blank=True)
    review_count = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # 検索 default sort は is_accepting=True 中で avg_rating 降順。
        indexes = [
            models.Index(fields=["is_accepting", "-avg_rating"]),
        ]

    def __str__(self) -> str:
        return f"MentorProfile(user={self.user_id}, accepting={self.is_accepting})"


class MentorPlan(models.Model):
    """mentor が提示する相談プラン (P11-12)。

    spec §4.2。 単発 (one_time) / 月額 (monthly) の 2 種類。 Phase 11 は無償ベータ
    pivot のため `price_jpy=0` 固定運用、 P11-E (将来) で Stripe 連携を入れる際に
    `stripe_price_id` 等を migration 追加するだけ。

    proposal が plan に紐付くのは P11-12 で MentorProposal.plan FK を後付け migration。
    """

    class BillingCycle(models.TextChoices):
        ONE_TIME = "one_time", "単発"
        MONTHLY = "monthly", "月額"

    profile = models.ForeignKey(
        MentorProfile,
        on_delete=models.CASCADE,
        related_name="plans",
    )
    title = models.CharField(max_length=60)
    description = models.TextField(max_length=1000)
    price_jpy = models.PositiveIntegerField(default=0)
    billing_cycle = models.CharField(
        max_length=20,
        choices=BillingCycle.choices,
    )
    # 論理削除フラグ。 過去の proposal/contract が plan を参照したまま編集 / 削除を
    # 安全にするため、 物理削除はせず is_active=False で hide する。
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["profile", "is_active"]),
        ]

    def __str__(self) -> str:
        return f"MentorPlan(profile={self.profile_id}, {self.title[:30]}, {self.billing_cycle})"


class MentorReview(models.Model):
    """契約完了後の mentee → mentor 評価 (P11-20)。

    spec §4.6。 1 contract 1 review (OneToOne)。 rating 1-5、 comment 必須 (1-2000)。
    投稿時に MentorProfile の avg_rating / review_count を atomic に集計更新する
    (service 層 `submit_review` で実装)。
    """

    contract = models.OneToOneField(
        MentorshipContract,
        on_delete=models.CASCADE,
        related_name="review",
    )
    mentor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="reviews_received",
    )
    # mentee は退会で SET_NULL (review は残るが author 表示は「退会済ユーザー」)。
    mentee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="reviews_written",
    )
    rating = models.PositiveSmallIntegerField()  # 1-5 (CheckConstraint)
    comment = models.TextField(max_length=2000)
    # 通報対応で隠す用 (Phase 4B Report と連動、 P11-25 で wire)。
    is_visible = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=models.Q(rating__gte=1, rating__lte=5),
                name="mentor_review_rating_1_to_5",
            ),
        ]
        indexes = [
            models.Index(fields=["mentor", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"MentorReview(contract={self.contract_id}, mentor={self.mentor_id}, ★{self.rating})"
