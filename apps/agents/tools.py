"""Phase 14 P14-02: Claude Agent 用 user-scoped tools.

spec: docs/specs/claude-agent-spec.md §4

各 tool は **request.user の scope に閉じる** plain Python function。
Anthropic SDK の `@beta_tool` decoration は P14-03 (AgentRunner) で
適用する。 ここでは:

- user は第一引数として明示的に注入 (Claude が input で偽装できない設計)
- 戻り値は plain text の短い summary (token 浪費を防ぐ)
- block / mute 関係は既存 `is_blocked_relationship` で自動 filter
- DM 本文は **絶対に** 触らない (Privacy、 Phase 14 スコープ外)

戻り値は LLM が読みやすい簡潔な日本語フォーマット。 1 件 1 行で
``@handle: body...`` の形に統一する (token 効率)。

P14-03 で `apps.agents.runner` が以下のように wrap する想定:

    from apps.agents import tools as t

    def make_anthropic_tools(user):
        return [
            {"name": "read_my_recent_tweets", "description": ...,
             "input_schema": {"type": "object", "properties": {"limit": {"type": "integer"}}, ...},
             "_callable": lambda **kw: t.read_my_recent_tweets(user, **kw)},
            ...
        ]
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from apps.common.blocking import is_blocked_relationship
from apps.notifications.models import Notification, NotificationKind
from apps.tags.models import Tag
from apps.timeline.services import build_home_tl
from apps.tweets.models import Tweet, TweetType

if TYPE_CHECKING:
    from django.contrib.auth.models import AbstractBaseUser


# ---- 共通定数 ----

# Phase 14 §4.2 にあるツール毎の上限。 LLM が大きい limit を渡しても dispatcher
# 側で clamp する (token を無駄遣いさせない安全網)。
_MAX_RECENT_TWEETS = 20
_MAX_NOTIFICATIONS = 30
_MAX_HOME_TIMELINE = 30
_MAX_TAG_SEARCH = 20

# tweet draft の char 上限 (X / Twitter 互換)。 Phase 1 SPEC §2.4 と同じ。
TWEET_DRAFT_MAX_CHARS = 140


def _clamp(value: int, minimum: int, maximum: int) -> int:
    """LLM から渡る limit を安全な範囲に clamp する。"""
    if value < minimum:
        return minimum
    if value > maximum:
        return maximum
    return value


def _format_body(body: str, max_chars: int = 120) -> str:
    """本文を 1 行に正規化 + 長すぎる場合は ``…`` で truncate。

    LLM 用の token-economical な形式。 改行は半角空白に潰す。
    """
    one_line = body.replace("\n", " ").replace("\r", " ").strip()
    if len(one_line) <= max_chars:
        return one_line
    return one_line[: max_chars - 1] + "…"


# ---------------------------------------------------------------------------
# read_my_recent_tweets
# ---------------------------------------------------------------------------


def read_my_recent_tweets(user: AbstractBaseUser, limit: int = 10) -> str:
    """自分が最近投稿した tweet を取得する (original のみ、 repost / quote / reply 除く)。

    Args:
        user: agent を起動した user (注: tool input には現れず、 closure で注入)。
        limit: 取得件数。 1-20 の範囲に clamp。

    Returns:
        ``"# 最近の自分の tweet (n 件)\n@handle: body\n..."`` 形式の plain text。
        該当 0 件なら ``"# 最近の自分の tweet (0 件)\n(無し)"``。
    """
    n = _clamp(limit, 1, _MAX_RECENT_TWEETS)
    qs = (
        Tweet.objects.filter(
            author=user,
            type=TweetType.ORIGINAL,
            is_deleted=False,
        )
        .order_by("-created_at")
        .select_related("author")[:n]
    )
    rows = list(qs)
    if not rows:
        return "# 最近の自分の tweet (0 件)\n(無し)"
    lines = [f"# 最近の自分の tweet ({len(rows)} 件)"]
    for t in rows:
        lines.append(f"- @{t.author.username}: {_format_body(t.body)}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# read_my_notifications
# ---------------------------------------------------------------------------


def read_my_notifications(user: AbstractBaseUser, limit: int = 20) -> str:
    """自分宛の最近の notification (mention / like / repost / reply / follow 等) を取得。

    DM の本文は読まない (Privacy)。 dm_message / dm_invite kind は kind だけ
    含めて本文は省く (LLM に「DM が来ました」 までは伝える)。

    Args:
        user: agent を起動した user。
        limit: 取得件数。 1-30 の範囲に clamp。

    Returns:
        ``"# 最近の通知 (n 件)\n[kind] from @actor : target_type=...\n..."`` 形式。
    """
    n = _clamp(limit, 1, _MAX_NOTIFICATIONS)
    qs = (
        Notification.objects.filter(recipient=user)
        .order_by("-created_at")
        .select_related("actor")[:n]
    )
    rows = list(qs)
    if not rows:
        return "# 最近の通知 (0 件)\n(無し)"
    lines = [f"# 最近の通知 ({len(rows)} 件)"]
    for n_ in rows:
        actor = f"@{n_.actor.username}" if n_.actor_id else "(system)"
        kind_label = n_.kind
        # DM の本文には触れない (Privacy)。 kind と発信者だけ。
        if n_.kind in (NotificationKind.DM_MESSAGE, NotificationKind.DM_INVITE):
            target = "(本文は非表示)"
        else:
            target = (f"target={n_.target_type}/{n_.target_id}" if n_.target_type else "").strip()
        read_mark = "" if n_.read else " [未読]"
        lines.append(f"- [{kind_label}] from {actor}{read_mark} {target}".rstrip())
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# read_home_timeline
# ---------------------------------------------------------------------------


def read_home_timeline(user: AbstractBaseUser, limit: int = 20) -> str:
    """自分の home TL (follow している人の tweet + 全体トレンド) を取得。

    既存の `apps.timeline.services.build_home_tl` を流用するので、 block /
    mute は自動 filter される。 reply / repost は除外される (timeline 仕様)。

    Args:
        user: agent を起動した user。
        limit: 取得件数。 1-30 の範囲に clamp。

    Returns:
        ``"# home TL (n 件)\n@handle: body\n..."`` 形式。
    """
    n = _clamp(limit, 1, _MAX_HOME_TIMELINE)
    tweets = build_home_tl(user, limit=n)
    rows = tweets[:n]
    if not rows:
        return "# home TL (0 件)\n(無し)"
    lines = [f"# home TL ({len(rows)} 件)"]
    for t in rows:
        lines.append(f"- @{t.author.username}: {_format_body(t.body)}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# search_tweets_by_tag
# ---------------------------------------------------------------------------


def search_tweets_by_tag(
    user: AbstractBaseUser,
    tag: str,
    limit: int = 10,
) -> str:
    """特定 tag の最近の tweet を取得 (block / mute は filter)。

    Args:
        user: agent を起動した user (block/mute 判定用)。
        tag: タグ名 (先頭 ``#`` は除去、 lowercase 正規化)。
        limit: 取得件数。 1-20 の範囲に clamp。

    Returns:
        ``"# tag '<name>' の最近の tweet (n 件)\n@handle: body\n..."`` 形式。
        tag が存在しない場合は ``"# tag '<name>' は存在しません"``。
    """
    n = _clamp(limit, 1, _MAX_TAG_SEARCH)
    tag_name = tag.lstrip("#").lower().strip()
    if not tag_name:
        return "# tag が空です"

    if not Tag.objects.filter(name=tag_name).exists():
        return f"# tag '{tag_name}' は存在しません"

    qs = (
        Tweet.objects.filter(
            tags__name=tag_name,
            is_deleted=False,
            type=TweetType.ORIGINAL,
        )
        .order_by("-created_at")
        .select_related("author")
        .distinct()[: n * 3]  # block filter 後に件数が減る前提で余分に取得
    )
    rows: list[Tweet] = []
    for t in qs:
        if is_blocked_relationship(user, t.author):
            continue
        rows.append(t)
        if len(rows) >= n:
            break

    if not rows:
        return f"# tag '{tag_name}' の最近の tweet (0 件)\n(無し)"

    lines = [f"# tag '{tag_name}' の最近の tweet ({len(rows)} 件)"]
    for t in rows:
        lines.append(f"- @{t.author.username}: {_format_body(t.body)}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# compose_tweet_draft (marker tool — loop 終了の合図)
# ---------------------------------------------------------------------------


class DraftTooLongError(ValueError):
    """compose_tweet_draft に 140 字超のテキストが渡された。"""


def compose_tweet_draft(user: AbstractBaseUser, text: str) -> str:
    """tweet 下書きを最終出力として確定する。 AgentRunner は本 tool 呼び出しで loop を break。

    本関数自体は input を validate して返すだけの marker。 実際の DB 保存は
    AgentRunner が `AgentRun.draft_text` に行う。

    Args:
        user: agent を起動した user (本 tool では未使用、 signature 統一のため)。
        text: 投稿候補 (140 文字以内)。

    Returns:
        渡されたテキストをそのまま返す。

    Raises:
        DraftTooLongError: 140 字超。
    """
    del user  # 未使用だが signature を他 tool と揃える
    stripped = text.strip()
    if len(stripped) > TWEET_DRAFT_MAX_CHARS:
        raise DraftTooLongError(
            f"draft text is {len(stripped)} chars (max {TWEET_DRAFT_MAX_CHARS})"
        )
    return stripped


# ---------------------------------------------------------------------------
# Tool registry (P14-03 AgentRunner が使う)
# ---------------------------------------------------------------------------


# Anthropic SDK は tool list を deterministic に渡すと prompt cache が効く。
# dict 順序は Python 3.7+ で保証されているが、 cache 用に明示的に key の順序を
# 固定しておく (Anthropic spec §10 caching: cache_control を効かせるための
# tools 一覧 deterministic 化)。
TOOL_REGISTRY: tuple[str, ...] = (
    "read_home_timeline",
    "read_my_notifications",
    "read_my_recent_tweets",
    "search_tweets_by_tag",
    "compose_tweet_draft",
)


def get_callable(name: str):
    """tool name から callable を取得。 unknown name は KeyError。"""
    mapping = {
        "read_home_timeline": read_home_timeline,
        "read_my_notifications": read_my_notifications,
        "read_my_recent_tweets": read_my_recent_tweets,
        "search_tweets_by_tag": search_tweets_by_tag,
        "compose_tweet_draft": compose_tweet_draft,
    }
    return mapping[name]
