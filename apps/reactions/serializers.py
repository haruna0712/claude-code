"""Reaction API serializers (P2-04 / GitHub #179)."""

from __future__ import annotations

from rest_framework import serializers

from apps.reactions.models import ReactionKind


class ReactionRequestSerializer(serializers.Serializer):
    """POST /tweets/<id>/reactions/ のリクエスト body."""

    kind = serializers.ChoiceField(choices=ReactionKind.choices)


class ReactionResponseSerializer(serializers.Serializer):
    """POST のレスポンス。kind=null は取消を表す."""

    kind = serializers.CharField(allow_null=True)
    created = serializers.BooleanField()
    changed = serializers.BooleanField()
    removed = serializers.BooleanField()


class ReactionAggregateSerializer(serializers.Serializer):
    """GET /tweets/<id>/reactions/ のレスポンス.

    各 kind ごとの集計と、auth 時の自分の現在 kind を返す。
    """

    counts = serializers.DictField(child=serializers.IntegerField(min_value=0))
    my_kind = serializers.CharField(allow_null=True, required=False)
