from django.apps import AppConfig


class AgentsConfig(AppConfig):
    """Phase 14: Claude Agent (Read+Compose MVP) を実装する Django app。

    spec: docs/specs/claude-agent-spec.md

    user が自然言語 prompt を投げると Claude が tool を順番に呼んで TL / 通知 /
    自分の tweet を読み、 tweet 下書きを生成する。 model は claude-haiku-4-5。
    自動投稿はせず、 user が「これを投稿」 button を押して初めて実投稿が走る。
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.agents"
    label = "agents"
