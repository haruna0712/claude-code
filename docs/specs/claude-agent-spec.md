# Phase 14: Claude Agent (Read + Compose MVP) — 仕様

> Milestone: "Phase 14: Claude Agent (Read+Compose MVP)" #17
> 関連: ハルナさんのリクエスト
> 「Claude managed agent を使ってユーザーがいろいろなことをさせる機能を作って。
> 例: その日起きたことをまとめて面白いものをツイートして、 と言えばツイートしてくれる」

---

## 1. 背景 / モチベーション

X (Twitter) Grok のように、 SNS 内に LLM agent を組み込むと「TL 見て今日の話題まとめて」「英文 tweet を要約して」 のような自然言語タスクが完結する。 本機能は **Phase 14 MVP**。 機能スコープを意図的に狭めて段階的に release する:

- **MVP (本仕様)**: Read + Compose のみ。 投稿しない、 下書きを返すだけ。
- 将来 (Phase 15+): Search 拡張 / DM 読み / 自動投稿 / 多 agent

ハルナさん判断 (Recommended 3 つ全選択):

1. **自動レベル**: 下書き提示だけ。 user が「保存」 button を押して初めて tweet が走る
2. **Tool スコープ**: Read (TL / notification / 自分の tweet) + Compose (tweet 文案生成)
3. **課金**: $10 以下 / per-user 10/day / max_tokens 5000 / model = Haiku 4.5

---

## 2. 全体構成

```
Browser
  │  user "今日の話題まとめて tweet 下書き作って"
  ▼
Next.js /agent ページ (Phase 14-F)
  │  POST /api/v1/agent/run { prompt }
  ▼
Django apps/agents/
  │
  ├─ views.AgentRunView (auth + throttle agent_run=10/day)
  ├─ services.AgentRunner
  │   │
  │   ├─ Anthropic SDK (anthropic.Anthropic)
  │   │   model="claude-haiku-4-5"
  │   │   max_tokens=5000
  │   │   system=(SYSTEM_PROMPT, cache_control=ephemeral)  # ← prefix cache
  │   │   tools=[...4-5 custom tools, cache_control on last]
  │   │
  │   ├─ Tool definitions (Python @beta_tool):
  │   │   - read_my_recent_tweets(limit=10)
  │   │   - read_my_notifications(limit=20)
  │   │   - read_home_timeline(limit=20)
  │   │   - search_tweets_by_tag(tag, limit=10)
  │   │   - compose_tweet_draft(text)   # 最終 output、 next iteration を止める
  │   │
  │   └─ Manual loop:
  │         while stop_reason == "tool_use":
  │             execute tool → tool_result → continue
  │         (compose_tweet_draft が呼ばれたら loop break)
  │
  └─ models.AgentRun (audit log)
        run_id, user, prompt, draft_text, tools_called, token_usage, cost_usd, created_at
```

---

## 3. データモデル

### 3.1 AgentRun (apps/agents/models.py)

agent の 1 回の起動を audit する。 cost / token を可視化して上限管理に使う。

```python
class AgentRun(models.Model):
    id = models.UUIDField(default=uuid.uuid4, primary_key=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="agent_runs")
    prompt = models.TextField(max_length=2000)
    draft_text = models.TextField(blank=True, default="")
    tools_called = models.JSONField(default=list)  # ["read_home_timeline", "compose_tweet_draft"]
    input_tokens = models.IntegerField(default=0)
    output_tokens = models.IntegerField(default=0)
    cache_read_input_tokens = models.IntegerField(default=0)
    cache_creation_input_tokens = models.IntegerField(default=0)
    cost_usd = models.DecimalField(max_digits=8, decimal_places=6, default=0)
    error = models.TextField(blank=True, default="")  # 失敗時の anthropic error message
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "-created_at"]),  # per-user 履歴 + rate limit 計算
        ]
```

---

## 4. Tool 設計

### 4.1 共通仕様

- すべて **request.user の scope に閉じる** (他人 private は読めない)
- block / mute 関係はサーバ側で自動 filter (Phase 4B `is_blocked_relationship`)
- 戻り値は **plain text の短い summary** (token 浪費を防ぐ、 Claude に loop 回数を減らさせる)

### 4.2 個別 tool

```python
@beta_tool
def read_my_recent_tweets(limit: int = 10) -> str:
    """自分が最近投稿した tweet を取得。 「今日何を tweet したか」 等で使う。
    Args:
        limit: 取得件数 (1-20)
    """

@beta_tool
def read_my_notifications(limit: int = 20) -> str:
    """自分宛の最近の notification (mention / like / repost / reply) を取得。
    「今日の自分宛の反応をまとめる」 等で使う。
    Args:
        limit: 取得件数 (1-30)
    """

@beta_tool
def read_home_timeline(limit: int = 20) -> str:
    """自分の home TL (follow している人の tweet) を取得。
    「TL の話題まとめる」 等で使う。 block / mute は自動除外。
    Args:
        limit: 取得件数 (1-30)
    """

@beta_tool
def search_tweets_by_tag(tag: str, limit: int = 10) -> str:
    """特定 tag (例: 'python', '#typescript') の tweet を最近順で取得。
    Args:
        tag: # を除いた tag 名
        limit: 取得件数 (1-20)
    """

@beta_tool
def compose_tweet_draft(text: str) -> str:
    """tweet 下書きを最終出力として確定する。 loop はこの tool 呼び出しで終了。
    Args:
        text: 投稿候補 (140 文字以内、 user が「保存」 button で実投稿)
    """
```

`compose_tweet_draft` が呼ばれた時点で `tool_result` を返さず loop を break、 結果を `AgentRun.draft_text` に保存して response に乗せる。

---

## 5. AgentRunner service (apps/agents/services.py)

### 5.1 main loop

```python
class AgentRunner:
    SYSTEM_PROMPT = """あなたは SNS 内に常駐する Claude agent です。 ユーザーの自然
    言語指示を受けて、 提供されたツールを順番に呼んで情報を集め、 最後に
    `compose_tweet_draft` で 140 字以内の tweet 下書きを返してください。

    ルール:
    - **直接投稿はしない**。 必ず compose_tweet_draft 経由。
    - 1 回の run で tool は **最大 5 回まで**。 多用しない。
    - 言語は user の preferred_language (デフォルト 日本語) に合わせる。
    """

    MODEL = "claude-haiku-4-5"
    MAX_TOKENS = 5000
    MAX_TOOL_ITERATIONS = 5

    def run(self, user, prompt: str) -> AgentRun:
        # 1. AgentRun を pending state で作成
        # 2. Anthropic client で manual tool_use loop を回す
        # 3. tool は user に bind した closure として渡す (security boundary)
        # 4. compose_tweet_draft 呼び出しで loop 終了
        # 5. token usage を計算して cost_usd を保存
        ...
```

### 5.1.1 prompt caching

CLAUDE.md `claude-api` skill より:

```python
response = client.messages.create(
    model=MODEL,
    max_tokens=MAX_TOKENS,
    system=[
        {"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}
    ],
    tools=[...4-5 tools...],  # tools は render order position 0、 deterministic 順
    messages=[{"role": "user", "content": prompt}],
)
```

- `cache_control` は system の最後に置く → tools + system が一緒に cache される
- tools 一覧は **deterministic に sort** して固定 (cache invalidation 防止)
- 5 分 TTL ephemeral cache、 2 回目以降の run は token cost 1/10

### 5.2 安全境界

- tool 関数は user closure (`def make_read_my_recent_tweets(user): return @beta_tool def f(): ...`)
  → Claude が tool input で渡せるのは limit のみ。 author や user_id は注入されない
- tool 内部で `request.user` を必ず参照 (他人を読まない)
- block / mute は既存 `is_blocked_relationship` を Tweet/Notification queryset に適用

---

## 6. API (apps/agents/views.py)

### 6.1 `POST /api/v1/agent/run`

| 項目         | 内容                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------ |
| auth         | Cookie JWT (`CookieAuthentication`) + IsAuthenticated                                            |
| throttle     | scope=`agent_run` 10/day, stg 100/day                                                            |
| request body | `{"prompt": "今日の話題まとめて"}`                                                               |
| 200 response | `{"run_id", "draft_text", "tools_called", "input_tokens", "output_tokens", "cost_usd", "model"}` |
| 400          | prompt が空 / 2000 字超過                                                                        |
| 401          | 未認証                                                                                           |
| 429          | rate limit                                                                                       |
| 500          | Anthropic API error (`AgentRun.error` に記録、 generic message を返す)                           |
| 503          | `ANTHROPIC_API_KEY` 未設定 (= MVP off の運用)                                                    |

### 6.2 `GET /api/v1/agent/runs/`

履歴一覧。 自分の AgentRun を新しい順、 paginate。 cost dashboard 用。

---

## 7. Frontend (P14-05)

### 7.1 新規 route

`/agent` (settings tab に link、 ホームから 3 click 以内):

- 入力 textarea (max 2000 文字、 placeholder「今日 TL で話題になったテックを 1 tweet にまとめて」)
- 「Agent 起動」 button (loading 中は disabled + Spinner)
- 結果 panel:
  - tools_called リスト (透明性)
  - draft_text を `<Textarea>` で edit 可能に
  - 「これを投稿」 button → 既存 `POST /tweets/` を呼ぶ
  - 「下書きとして保存」 button → Phase 6 article draft 流用 / Phase 14 では skip
- 履歴 (右 column): `GET /agent/runs/` の最近 10 件

### 7.2 ナビ導線 (CLAUDE.md §9 必須)

- `client/src/constants/index.ts` の `leftNavLinks` に `{ href: "/agent", label: "Agent", Icon: Sparkles }` 追加
- premium / 全 user に開放するかは feature flag (`is_premium` でゲートする選択肢あり)

---

## 8. テスト

### 8.1 backend pytest

- `apps/agents/tests/test_tools.py` — 各 tool が user scope を守るか、 block / mute filter が効くか
- `apps/agents/tests/test_runner.py` — Anthropic API を mock、 tool_use loop が compose_tweet_draft で終わるか
- `apps/agents/tests/test_agent_run_view.py` — 401 / 400 / 429 / 200 / 503 (API key 未設定)
- `apps/agents/tests/test_cost_tracking.py` — token usage が AgentRun に正しく保存されるか

### 8.2 frontend vitest

- `AgentPanel.test.tsx` — submit → loading → 結果表示 → 投稿 button
- `useAgentRun.test.ts` — error toast / draft edit

### 8.3 E2E Playwright (`client/e2e/agent.spec.ts`)

- AGENT-1: 未ログインで /agent → /login redirect
- AGENT-2: ログイン → ホーム → leftNav「Agent」 で 1 click 到達 (heading が表示される)
- AGENT-3: prompt 投入 → 「Agent 起動」 で draft が出る (実 Anthropic 経由、 ~30 秒)
- AGENT-4: draft を edit → 「これを投稿」 で /tweets POST 成功 + 後片付けに API で delete

実行コマンド (env は [docs/local/e2e-stg.md](../local/e2e-stg.md) 参照):

```bash
cd /workspace/client

PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test2 \
  npx playwright test e2e/agent.spec.ts --reporter=line --timeout=90000
```

**注意 (P14-07 未完時)**: stg env に `ANTHROPIC_API_KEY` が注入されるまでは AGENT-3 が `503` を返して fail する。 placeholder のままだと AgentRunner init は通るが Anthropic 401 → 500、 user に toast error が出るので AGENT-3 / AGENT-4 が fail する。 **実翻訳品質確認は P14-07 完了後** に行う。

---

## 9. ロールアウト順序 (Issues)

| Issue  | 内容                                                                                                            | size |
| ------ | --------------------------------------------------------------------------------------------------------------- | ---- |
| P14-01 | apps/agents AppConfig + AgentRun model + migration + admin                                                      | XS   |
| P14-02 | Tool layer (`tools.py`) + 5 tools の user-scope 実装 + unit test                                                | M    |
| P14-03 | AgentRunner service (Anthropic API + manual tool loop + cost 計算)                                              | M    |
| P14-04 | `POST /agent/run` + `GET /agent/runs/` view + throttle scope `agent_run`                                        | S    |
| P14-05 | Frontend /agent route + AgentPanel component + leftNavLinks 追加                                                | M    |
| P14-06 | Playwright E2E + spec doc 更新                                                                                  | S    |
| P14-07 | infra: terraform で `ANTHROPIC_API_KEY` を ECS task secrets に注入 (Phase 13 P13-08 と同型、 ハルナさん手動 op) | XS   |

---

## 10. プライバシー / コスト

### Privacy

- prompt と tool 戻り値 (= 自分の TL の一部) は Anthropic に送信される
- /agent ページ + ToS / Privacy に明示 (「あなたの TL / notification の一部が Anthropic に送られて生成に使われます」)
- log retention: `AgentRun.prompt` / `draft_text` は 30 日保管後 cron で削除 (Phase 15 で実装)
- DM 本文は **絶対** tool で読まない (Phase 14 スコープ外、 spec 明示)

### Cost

Haiku 4.5 単価: 入力 $1/M、 出力 $5/M (2026-04 時点)。

| 想定                                             | 1 run      | 月想定   |
| ------------------------------------------------ | ---------- | -------- |
| 入力 ~3000 token (system + tools + tool_results) | $0.003     | —        |
| 出力 ~1500 token (思考 + tool calls + 下書き)    | $0.0075    | —        |
| **1 run 合計**                                   | **~$0.01** | —        |
| 100 user × 月 30 run / user                      | —          | **~$30** |

cache が効くと入力 token の ~90% が 1/10 価格になるので実際は $5-10 / 月見込み。 ハルナさん指定の $10 上限内に収まる。 上限超え対策:

- per-user 10/day throttle (server-side)
- `ANTHROPIC_API_KEY` が未設定なら 503 で機能 off (kill switch)
- 日次 `Sum(cost_usd)` を Cloud Watch で監視、 $5/day 超えたら Sentry alarm (Phase 15)

---

## 11. 開発フロー

CLAUDE.md §4.5 通り:

1. ✅ 本仕様書 (本ファイル) を merge してから Issue 起票
2. P14-01 ～ 07 の Issue を `gh issue create` で 7 件起票
3. P14-01 から TDD で実装、 PR ごとに review エージェント (`python-reviewer` / `security-reviewer` 必須)
4. P14-07 (infra) は terraform plan まで Claude が作って apply はハルナさんに振る (Phase 13 P13-08 と同じ運用)
5. stg deploy 後 Playwright で実機検証 + `gan-evaluator` で UI 採点

---

## 12. 出典 / 参考

- Anthropic Tool Use overview: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- Prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Anthropic SDK `@beta_tool` decorator: `anthropic` Python 1.x SDK README
- Haiku 4.5 model card: https://platform.claude.com/docs/en/about-claude/models/overview
- Phase 13 P13-02 OpenAI adapter (本プロジェクト内、 同型構造を流用): `apps/translation/services.py`
