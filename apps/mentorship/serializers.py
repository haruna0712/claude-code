"""DRF serializers for mentorship models.

P11-03: MentorRequest 用 serializer を実装 (list / detail / input)。
spec §6.1
"""

from __future__ import annotations

from rest_framework import serializers

from apps.mentorship.models import MentorProposal, MentorRequest
from apps.tags.models import Tag


class _MenteeMiniSerializer(serializers.Serializer):
    """mentee (User) の最小 representation。 detail / list 共通。"""

    handle = serializers.CharField(source="username", read_only=True)
    display_name = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    def get_display_name(self, obj) -> str:
        first = getattr(obj, "first_name", "") or ""
        last = getattr(obj, "last_name", "") or ""
        full = f"{first} {last}".strip()
        return full or obj.username

    def get_avatar_url(self, obj) -> str:
        # P11-03 では Profile.avatar 連携は未実装 (P11-14 周辺で profile API 整備時に追加)。
        # 空文字を返しておけば frontend は default avatar を出す。
        return ""


class _TagSlimSerializer(serializers.ModelSerializer):
    """tag の最小 representation (name / display_name のみ)。"""

    class Meta:
        model = Tag
        fields = ("name", "display_name")


class MentorRequestSummarySerializer(serializers.ModelSerializer):
    """一覧用 (body 除く軽量版)。"""

    mentee = _MenteeMiniSerializer(read_only=True)
    target_skill_tags = _TagSlimSerializer(many=True, read_only=True)

    class Meta:
        model = MentorRequest
        fields = (
            "id",
            "mentee",
            "title",
            "target_skill_tags",
            "budget_jpy",
            "status",
            "proposal_count",
            "expires_at",
            "created_at",
        )
        read_only_fields = fields


class MentorRequestDetailSerializer(MentorRequestSummarySerializer):
    """詳細用 (body 含む)。"""

    class Meta(MentorRequestSummarySerializer.Meta):
        fields = (
            *MentorRequestSummarySerializer.Meta.fields,
            "body",
            "updated_at",
        )
        read_only_fields = fields


class MentorRequestInputSerializer(serializers.Serializer):
    """POST / PATCH の入力 schema。

    target_skill_tag_names は既存 tag.name の list (mentee は新規 tag を生やせない、
    既存承認済 tag のみ採用)。
    """

    title = serializers.CharField(min_length=1, max_length=80)
    body = serializers.CharField(min_length=1, max_length=2000)
    target_skill_tag_names = serializers.ListField(
        child=serializers.CharField(max_length=50),
        max_length=5,
        required=False,
        default=list,
    )
    budget_jpy = serializers.IntegerField(min_value=0, max_value=10_000_000, default=0)

    def validate_target_skill_tag_names(self, value: list[str]) -> list[Tag]:
        # 重複除去 + 小文字化
        normalized = list({v.strip().lower() for v in value if v.strip()})
        if not normalized:
            return []
        tags = list(Tag.objects.filter(name__in=normalized))
        if len(tags) != len(normalized):
            found = {t.name for t in tags}
            missing = sorted(set(normalized) - found)
            raise serializers.ValidationError(f"未登録 / 未承認のタグ: {', '.join(missing)}")
        return tags


# --- MentorProposal (P11-04) ---


class _MentorMiniSerializer(_MenteeMiniSerializer):
    """mentor の最小 representation。 mentee と同じ shape (User 共通)。"""


class MentorProposalDetailSerializer(serializers.ModelSerializer):
    """proposal 詳細 (request owner のみ閲覧、 mentor 自身も自分のは見える)。"""

    mentor = _MentorMiniSerializer(read_only=True)

    class Meta:
        model = MentorProposal
        fields = (
            "id",
            "request",
            "mentor",
            "body",
            "status",
            "responded_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class MentorProposalInputSerializer(serializers.Serializer):
    """`POST /requests/<id>/proposals/` の入力 schema。"""

    body = serializers.CharField(min_length=1, max_length=2000)
