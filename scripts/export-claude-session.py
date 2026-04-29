#!/usr/bin/env python3
"""Export Claude Code session JSONL to readable markdown.

各セッションは ~/.claude/projects/<project>/<session-uuid>.jsonl に
全イベントが JSONL で保存されている。本スクリプトは:
  1. 最新の JSONL (もしくは引数指定の session id) を読む
  2. user/assistant メッセージとツール使用を時系列に整形
  3. プロジェクト直下 conversations/<date>-<short-uuid>.md に出力

Stop hook (.claude/settings.json) から呼ばれる前提だが、コマンドラインからも
直接実行できる。

Usage:
  scripts/export-claude-session.py                        # 最新セッションを export
  scripts/export-claude-session.py <session-uuid>         # 特定セッションを export
  scripts/export-claude-session.py --list                 # 最近 10 件のセッション一覧
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Claude Code の session JSONL は ~/.claude/projects/<workdir>/<uuid>.jsonl に
# 保存される。devcontainer では `/home/node/.claude/projects/-workspace/`。
SESSION_DIR = Path.home() / ".claude" / "projects" / "-workspace"

# 出力先 (プロジェクト直下)。CLAUDE_PROJECT_DIR が立ってない場合は CWD を採用。
PROJECT_DIR = Path(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()))
OUTPUT_DIR = PROJECT_DIR / "conversations"

# 入力タグ (ハルナさんの実プロンプトと区別するもの) — markdown 出力時にスキップ。
SKIP_PREFIXES = (
    "<command-name>",
    "<command-message>",
    "<local-command-stdout>",
    "<local-command-stderr>",
    "<local-command-caveat>",
    "<bash-input>",
    "<bash-stderr>",
    "<bash-stdout>",
    "<system-reminder>",
    "<task-notification>",
    "[Request interrupted",
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def find_latest_session() -> Path:
    files = sorted(
        SESSION_DIR.glob("*.jsonl"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not files:
        sys.exit(f"No JSONL files found in {SESSION_DIR}")
    return files[0]


def find_session_by_id(session_id: str) -> Path:
    # Allow short prefixes (first 8 chars typical UUID prefix)
    matches = list(SESSION_DIR.glob(f"{session_id}*.jsonl"))
    if not matches:
        sys.exit(f"No JSONL matches for session id '{session_id}' in {SESSION_DIR}")
    if len(matches) > 1:
        sys.exit(
            f"Ambiguous session id '{session_id}'. Matches: "
            + ", ".join(p.name for p in matches)
        )
    return matches[0]


def list_recent_sessions(n: int = 10) -> None:
    files = sorted(
        SESSION_DIR.glob("*.jsonl"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )[:n]
    for p in files:
        mtime = datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
        size_kb = p.stat().st_size // 1024
        print(f"  {p.stem[:8]}  {mtime}  {size_kb:>6} KB  {p.name}")


def parse_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def format_timestamp(iso: str) -> str:
    """ISO 8601 (UTC) → JST HH:MM:SS"""
    if not iso:
        return "?"
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        # JST = UTC+9
        from datetime import timedelta

        jst = dt.astimezone(timezone(timedelta(hours=9)))
        return jst.strftime("%H:%M:%S")
    except (ValueError, TypeError):
        return iso[:19]


def is_real_user_text(text: str) -> bool:
    """system reminder / bash-output / tool result 等は本物のユーザー発言ではない。"""
    if not text or not text.strip():
        return False
    t = text.lstrip()
    return not t.startswith(SKIP_PREFIXES)


def truncate(s: str, limit: int = 600) -> str:
    if len(s) <= limit:
        return s
    return s[:limit] + f"\n... (truncated, total {len(s)} chars)"


def render_tool_use(name: str, tool_input: dict[str, Any]) -> str:
    """ツール呼び出し input の人間可読サマリ。"""
    if name == "Bash":
        cmd = tool_input.get("command", "")
        desc = tool_input.get("description", "")
        head = desc if desc else cmd.split("\n", 1)[0][:80]
        return f"```bash\n{truncate(cmd, 800)}\n```"
    if name in ("Read", "Write", "Edit"):
        path = tool_input.get("file_path", "?")
        if name == "Read":
            return f"`{path}`" + (
                f" (lines {tool_input.get('offset', 0)}-{tool_input.get('offset', 0) + tool_input.get('limit', 2000)})"
                if tool_input.get("offset")
                else ""
            )
        if name == "Edit":
            return (
                f"`{path}`\n\n```diff\n- "
                + truncate(str(tool_input.get("old_string", "")).split("\n", 1)[0], 200)
                + "\n+ "
                + truncate(str(tool_input.get("new_string", "")).split("\n", 1)[0], 200)
                + "\n```"
            )
        return f"`{path}` ({len(tool_input.get('content', ''))} chars)"
    if name == "Agent":
        sub = tool_input.get("subagent_type", "general-purpose")
        d = tool_input.get("description", "")
        return f"subagent_type=`{sub}` — {d}"
    if name == "TodoWrite":
        todos = tool_input.get("todos", [])
        return f"{len(todos)} todos"
    return f"```json\n{truncate(json.dumps(tool_input, ensure_ascii=False, indent=2), 600)}\n```"


def render_tool_result(content: Any) -> str:
    if isinstance(content, str):
        return truncate(content)
    if isinstance(content, list):
        # may be list of {type:'text', text:'...'}
        parts = []
        for c in content:
            if isinstance(c, dict) and c.get("type") == "text":
                parts.append(c.get("text", ""))
        return truncate("\n".join(parts))
    return truncate(str(content))


# ---------------------------------------------------------------------------
# Main rendering
# ---------------------------------------------------------------------------


def render_session(session_path: Path) -> str:
    """JSONL を markdown 文字列に変換する。"""
    records = list(parse_jsonl(session_path))
    session_id = session_path.stem
    short_id = session_id[:8]

    # 開始日時を最初の record の timestamp から取得
    first_ts = next(
        (r.get("timestamp") for r in records if r.get("timestamp")),
        None,
    )
    start_date = (
        datetime.fromisoformat(first_ts.replace("Z", "+00:00"))
        .astimezone(timezone.max)
        .strftime("%Y-%m-%d")
        if first_ts
        else "unknown-date"
    )

    out: list[str] = []
    out.append(f"# Claude Code セッションログ — {short_id}\n")
    out.append(f"> セッション ID: `{session_id}`")
    out.append(f"> 開始: {start_date}")
    out.append(
        f"> 自動生成: {datetime.now(timezone(__import__('datetime').timedelta(hours=9))).strftime('%Y-%m-%d %H:%M:%S')} JST"
    )
    out.append(f"> 元ファイル: `{session_path}`")
    out.append(f"\n_ハルナさんとの対話を時系列に並べた読み物。Tool 呼び出しは折りたたみ。_\n")
    out.append("---\n")

    # Tool use ID → tool name map (for matching tool_result later)
    tool_use_map: dict[str, str] = {}

    for rec in records:
        rtype = rec.get("type")
        msg = rec.get("message", {})
        ts = format_timestamp(rec.get("timestamp", ""))

        if rtype == "user":
            content = msg.get("content")
            if isinstance(content, str):
                if is_real_user_text(content):
                    out.append(f"## 👤 User · {ts}\n")
                    out.append(content.strip())
                    out.append("\n")
            elif isinstance(content, list):
                # tool_result が混じってる
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "tool_result":
                        tu_id = block.get("tool_use_id", "")
                        tu_name = tool_use_map.get(tu_id, "Tool")
                        result = render_tool_result(block.get("content", ""))
                        if result.strip():
                            out.append(f"<details><summary>📤 {tu_name} result</summary>\n")
                            out.append("```\n" + result + "\n```\n")
                            out.append("</details>\n")
                    elif block.get("type") == "text":
                        # 一部 user-as-text wrapped block
                        text = block.get("text", "")
                        if is_real_user_text(text):
                            out.append(f"## 👤 User · {ts}\n")
                            out.append(text.strip())
                            out.append("\n")

        elif rtype == "assistant":
            content = msg.get("content", [])
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "text":
                    text = block.get("text", "")
                    if text.strip():
                        out.append(f"## 🤖 Assistant · {ts}\n")
                        out.append(text)
                        out.append("\n")
                elif btype == "tool_use":
                    name = block.get("name", "Tool")
                    tu_id = block.get("id", "")
                    tool_use_map[tu_id] = name
                    summary = render_tool_use(name, block.get("input", {}))
                    out.append(f"<details><summary>🔧 {name}</summary>\n")
                    out.append(summary)
                    out.append("\n</details>\n")

        # 他の type (system, attachment, file-history-snapshot, etc) は無視

    out.append("\n---\n")
    out.append(f"_End of session log. {len(records)} JSONL records processed._\n")

    return "\n".join(out)


def export_session(session_path: Path) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 出力ファイル名: <YYYY-MM-DD>-<short-uuid>.md
    first_ts = None
    for rec in parse_jsonl(session_path):
        if rec.get("timestamp"):
            first_ts = rec["timestamp"]
            break

    if first_ts:
        date = datetime.fromisoformat(first_ts.replace("Z", "+00:00")).strftime(
            "%Y-%m-%d"
        )
    else:
        date = datetime.fromtimestamp(session_path.stat().st_mtime).strftime("%Y-%m-%d")

    short_id = session_path.stem[:8]
    out_path = OUTPUT_DIR / f"{date}-{short_id}.md"

    md = render_session(session_path)
    out_path.write_text(md, encoding="utf-8")
    return out_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export Claude Code session JSONL to markdown."
    )
    parser.add_argument(
        "session_id",
        nargs="?",
        help="Session UUID prefix (e.g., 'dfcf4c86'). Default: latest session.",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List recent sessions and exit.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress informational stdout (used by hooks).",
    )
    args = parser.parse_args()

    if args.list:
        list_recent_sessions()
        return 0

    if args.session_id:
        path = find_session_by_id(args.session_id)
    else:
        path = find_latest_session()

    out = export_session(path)
    if not args.quiet:
        print(f"Exported: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
