#!/usr/bin/env python3
"""Export Claude Code session JSONL to readable markdown.

各セッションは ~/.claude/projects/<project>/<session-uuid>.jsonl に
全イベントが JSONL で保存されている。本スクリプトは:

  1. 最新の JSONL (もしくは引数指定の session id) を読む
  2. user/assistant メッセージとツール使用を時系列に整形
  3. プロジェクト直下 conversations/<date>-<short-uuid>.md に出力

差分追加 (incremental append) モード:
  Stop hook が呼ばれるたびに、前回処理した JSONL の byte offset を
  conversations/.cursor-<short-uuid> に記録しておき、次回はそこから先だけを
  読んで markdown ファイル末尾に append する。

  - 初回 (cursor / md 不在): 全レコードを読んでヘッダ付き .md を新規作成
  - 2 回目以降: cursor 位置から read → 新規分だけ整形 → .md に append
  - --force: cursor を無視して頭から full 再生成

Stop hook (.claude/settings.json) から呼ばれる前提だが、コマンドラインからも
直接実行できる。

Usage:
  scripts/export-claude-session.py                        # 最新セッションを export (差分のみ)
  scripts/export-claude-session.py <session-uuid>         # 特定セッションを export
  scripts/export-claude-session.py --list                 # 最近 10 件のセッション一覧
  scripts/export-claude-session.py --force                # cursor 無視、全部書き直す
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Claude Code の session JSONL は ~/.claude/projects/<workdir>/<uuid>.jsonl に
# 保存される。devcontainer では `/home/node/.claude/projects/-workspace/`。
SESSION_DIR = Path.home() / ".claude" / "projects" / "-workspace"

# 出力先 (プロジェクト直下)。CLAUDE_PROJECT_DIR が立ってない場合は CWD を採用。
PROJECT_DIR = Path(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()))
OUTPUT_DIR = PROJECT_DIR / "conversations"

JST = timezone(timedelta(hours=9))

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
    matches = list(SESSION_DIR.glob(f"{session_id}*.jsonl"))
    if not matches:
        sys.exit(f"No JSONL matches for session id '{session_id}' in {SESSION_DIR}")
    if len(matches) > 1:
        sys.exit(
            f"Ambiguous session id '{session_id}'. Matches: " + ", ".join(p.name for p in matches)
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


def parse_jsonl_lines(lines: Iterable[str]) -> Iterable[dict[str, Any]]:
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue


def parse_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open() as f:
        yield from parse_jsonl_lines(f)


def read_jsonl_from_offset(path: Path, offset: int) -> tuple[list[dict[str, Any]], int]:
    """offset から末尾までを読み、(records, new_offset) を返す。"""
    records: list[dict[str, Any]] = []
    with path.open() as f:
        f.seek(offset)
        for line in f:
            line_stripped = line.strip()
            if line_stripped:
                with contextlib.suppress(json.JSONDecodeError):
                    records.append(json.loads(line_stripped))
        new_offset = f.tell()
    return records, new_offset


def format_timestamp(iso: str) -> str:
    """ISO 8601 (UTC) → JST HH:MM:SS"""
    if not iso:
        return "?"
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.astimezone(JST).strftime("%H:%M:%S")
    except (ValueError, TypeError):
        return iso[:19]


def is_real_user_text(text: str) -> bool:
    """system reminder / bash-output / tool result 等は本物のユーザー発言ではない。"""
    if not text or not text.strip():
        return False
    return not text.lstrip().startswith(SKIP_PREFIXES)


def truncate(s: str, limit: int = 600) -> str:
    if len(s) <= limit:
        return s
    return s[:limit] + f"\n... (truncated, total {len(s)} chars)"


def render_tool_use(name: str, tool_input: dict[str, Any]) -> str:
    """ツール呼び出し input の人間可読サマリ。"""
    if name == "Bash":
        cmd = tool_input.get("command", "")
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
        parts = []
        for c in content:
            if isinstance(c, dict) and c.get("type") == "text":
                parts.append(c.get("text", ""))
        return truncate("\n".join(parts))
    return truncate(str(content))


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def render_header(session_path: Path, first_ts: str | None) -> str:
    """セッション最初に 1 度だけ出力するヘッダ。"""
    session_id = session_path.stem
    short_id = session_id[:8]
    if first_ts:
        start_date = (
            datetime.fromisoformat(first_ts.replace("Z", "+00:00"))
            .astimezone(JST)
            .strftime("%Y-%m-%d")
        )
    else:
        start_date = "unknown-date"

    lines = [
        f"# Claude Code セッションログ — {short_id}\n",
        f"> セッション ID: `{session_id}`",
        f"> 開始: {start_date}",
        f"> 元ファイル: `{session_path}`",
        "",
        "_ハルナさんとの対話を時系列に並べた読み物。"
        "Tool 呼び出しは折りたたみ。Stop hook で差分追加されます。_",
        "",
        "---",
        "",
    ]
    return "\n".join(lines)


def render_records(records: list[dict[str, Any]]) -> str:
    """JSONL レコード列を markdown 文字列に変換する (ヘッダ無し)。

    tool_use → tool_result の対応付けは引数の records 範囲内でのみ行う。
    Stop hook 単位での tool_use と tool_result は同一 turn なので同一 batch
    に収まり、cross-batch 状態を持ち越す必要はない。
    """
    out: list[str] = []
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
                    out.append("")
            elif isinstance(content, list):
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
                        text = block.get("text", "")
                        if is_real_user_text(text):
                            out.append(f"## 👤 User · {ts}\n")
                            out.append(text.strip())
                            out.append("")

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
                        out.append("")
                elif btype == "tool_use":
                    name = block.get("name", "Tool")
                    tu_id = block.get("id", "")
                    tool_use_map[tu_id] = name
                    summary = render_tool_use(name, block.get("input", {}))
                    out.append(f"<details><summary>🔧 {name}</summary>\n")
                    out.append(summary)
                    out.append("\n</details>\n")

    return "\n".join(out)


# ---------------------------------------------------------------------------
# Export (incremental)
# ---------------------------------------------------------------------------


def output_paths(session_path: Path) -> tuple[Path, Path]:
    """(markdown 出力先, cursor sidecar) を返す。"""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    short_id = session_path.stem[:8]

    # ヘッダ用: 最初の timestamp から日付を決定 (JST 換算)
    first_ts = None
    for rec in parse_jsonl(session_path):
        if rec.get("timestamp"):
            first_ts = rec["timestamp"]
            break
    if first_ts:
        date = (
            datetime.fromisoformat(first_ts.replace("Z", "+00:00"))
            .astimezone(JST)
            .strftime("%Y-%m-%d")
        )
    else:
        date = datetime.fromtimestamp(session_path.stat().st_mtime).strftime("%Y-%m-%d")

    md_path = OUTPUT_DIR / f"{date}-{short_id}.md"
    cursor_path = OUTPUT_DIR / f".cursor-{short_id}"
    return md_path, cursor_path


def export_session(session_path: Path, force: bool = False) -> tuple[Path, int, bool]:
    """差分追加で markdown を更新する。

    Returns:
        (md_path, num_new_records_appended, was_full_regenerate)
    """
    md_path, cursor_path = output_paths(session_path)

    # cursor 読み取り (force / md 不在 / cursor 不在 → full regenerate)
    is_full = force or not md_path.exists() or not cursor_path.exists()
    offset = 0 if is_full else int(cursor_path.read_text().strip() or "0")

    # 新規レコード読み取り
    new_records, new_offset = read_jsonl_from_offset(session_path, offset)

    if not new_records and not is_full:
        # 何も追加することがない (Stop hook が空打ちされたケース等)
        cursor_path.write_text(str(new_offset))
        return md_path, 0, False

    md_body = render_records(new_records)

    if is_full:
        first_ts = next(
            (r.get("timestamp") for r in new_records if r.get("timestamp")),
            None,
        )
        header = render_header(session_path, first_ts)
        md_path.write_text(header + md_body, encoding="utf-8")
    else:
        # append
        with md_path.open("a", encoding="utf-8") as f:
            if md_body.strip():
                # 既存末尾と境界を空行で区切る
                f.write("\n" + md_body)

    cursor_path.write_text(str(new_offset))
    return md_path, len(new_records), is_full


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export Claude Code session JSONL to markdown (incremental append)."
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
        "--force",
        action="store_true",
        help="Ignore cursor and regenerate the full markdown from scratch.",
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

    path = find_session_by_id(args.session_id) if args.session_id else find_latest_session()

    out, n_new, was_full = export_session(path, force=args.force)
    if not args.quiet:
        mode = "full regenerate" if was_full else "incremental append"
        print(f"Exported ({mode}, {n_new} new records): {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
