"""#732 follow-up: AgentRun.agent_message を追加。

spec: docs/specs/claude-agent-spec.md §3.1 (P14 follow-up)

Claude が `compose_tweet_draft` を呼ばずに `end_turn` した場合
(= tool では解けない prompt) 、 Claude の text 返答を保存して frontend で
「Claude より:」 として表示できるようにする。 draft_text が空のときの
説明にあたる。
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("agents", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="agentrun",
            name="agent_message",
            field=models.TextField(
                blank=True,
                default="",
                help_text=(
                    "compose_tweet_draft を呼ばずに end_turn したとき、"
                    " Claude が返した text response。 draft_text が空の"
                    "とき用の説明。"
                ),
            ),
        ),
    ]
