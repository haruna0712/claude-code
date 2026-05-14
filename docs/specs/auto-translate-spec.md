# Phase 13: 自動翻訳機能 — 仕様

> Issue: Milestone "Phase 13: 自動翻訳機能" #16
> 関連: X (旧 Twitter) の auto-translate 機能を参考に実装
>
> **更新 (2026-05-14)**: 翻訳エンジンを Anthropic Claude → **OpenAI GPT-4o-mini** に変更
> (ハルナさん判断、 既存 `OPENAI_API_KEY` 流用、 OpenAI dashboard で予算管理可能)

---

## 1. 背景

エンジニア特化型 SNS は日本語話者だけでなく多言語の engineer 参加を想定している。 Twitter / X が 2024-2026 にかけて全展開した **「ユーザー UI 言語と異なるツイートに `翻訳` button を出す」** UX をベースに実装する。

ハルナさん要件:

> 国外のツイートはそのユーザーの使用言語に応じて翻訳して見せる
> 原文を表示も X のように

---

## 2. 参考: X (Twitter) 仕様

調査結果 (Web 検索 + UX 観察):

1. **言語検出**: ツイートごとに自動検出 (X は Grok を内部利用、 一般実装は langdetect / CLD3)
2. **翻訳 button 表示条件**: 投稿言語 ≠ ユーザー UI 言語 のときだけ小さい「翻訳」 link
3. **Show original / Show translation toggle**: 翻訳後「原文を表示」 で戻せる (per-post 永続)
4. **Auto translate 設定**: gear icon でグローバル auto on/off (default off)。 per-post override 可能
5. **設定 UI**: 翻訳バナー横の歯車 icon で auto translate 切替

---

## 3. スコープ (Phase 13-A 〜 13-G)

| ID     | 内容                                                         | layer    |
| ------ | ------------------------------------------------------------ | -------- |
| P13-01 | Tweet.language 自動検出 + 保存 (langdetect)                  | backend  |
| P13-02 | Translation service abstraction + OpenAI GPT-4o-mini adapter | backend  |
| P13-03 | `POST /api/v1/tweets/<id>/translate/` endpoint               | backend  |
| P13-04 | User.preferred_language + auto_translate field + settings UI | both     |
| P13-05 | TweetCard に「翻訳する」 button + 「原文を表示」 toggle      | frontend |
| P13-06 | 自動翻訳 global toggle (settings page)                       | frontend |
| P13-07 | Auto translate ON 時に初期 render で翻訳済 状態にする        | frontend |
| P13-08 | stg / prod env に OPENAI_API_KEY 投入 (manual op)            | infra    |

---

## 4. データモデル

### 4.1 Tweet model 拡張 (P13-01)

```python
class Tweet(models.Model):
    # ... 既存 fields ...
    # P13-01: 自動翻訳機能のための言語検出結果。
    # ISO 639-1 (2 文字、 ja / en / ko 等) を投稿時に langdetect で検出。
    # 検出失敗 / 短すぎる本文は NULL (= 翻訳 button を出さない判定)。
    language = models.CharField(
        max_length=8,  # 余裕を持って (zh-CN 等 BCP-47 想定外も保険)
        null=True,
        blank=True,
        db_index=True,
    )
```

migration: `apps/tweets/migrations/0006_tweet_language.py`

### 4.2 User model 拡張 (P13-04)

```python
class User(AbstractUser):
    # ... 既存 fields ...
    # P13-04: UI 表示言語 (ISO 639-1)。 default は ja (日本語話者 SNS なので)。
    # 翻訳 button 表示判定: tweet.language != user.preferred_language なら出す。
    preferred_language = models.CharField(
        max_length=8,
        default="ja",
    )
    # P13-04: グローバル auto translate (default False、 X と同じ opt-in)。
    auto_translate = models.BooleanField(default=False)
```

migration: `apps/users/migrations/0007_user_language_preferences.py`

### 4.3 TweetTranslation cache model (P13-02)

翻訳結果を DB cache して再呼び出し時 OpenAI API を叩かない:

```python
class TweetTranslation(models.Model):
    tweet = models.ForeignKey(Tweet, on_delete=CASCADE, related_name="translations")
    target_language = models.CharField(max_length=8)  # ja / en 等
    translated_text = models.TextField()
    engine = models.CharField(max_length=64)  # "openai:gpt-4o-mini" 等
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("tweet", "target_language")
        indexes = [
            models.Index(fields=["tweet", "target_language"]),
        ]
```

migration: `apps/tweets/migrations/0007_tweet_translation.py`

---

## 5. Translation service (P13-02)

`apps/translation/services.py`:

```python
from typing import Protocol

class Translator(Protocol):
    def translate(self, text: str, target_language: str, source_language: str | None = None) -> str: ...

class OpenAITranslator:
    """OpenAI GPT-4o-mini で翻訳。 system prompt で「翻訳のみを返す」 を強制。"""
    ENGINE_TAG = "openai:gpt-4o-mini"

    def __init__(self, api_key: str, model: str = "gpt-4o-mini"):
        from openai import OpenAI
        self._client = OpenAI(api_key=api_key)
        self._model = model

    def translate(self, text: str, target_language: str, source_language: str | None = None) -> str:
        completion = self._client.chat.completions.create(
            model=self._model,
            max_tokens=2000,
            temperature=0,
            messages=[
                {"role": "system", "content": (
                    "You are a translator. Translate the user's text into the specified target language. "
                    "Output only the translation. No quotation marks, no preamble, no explanation."
                )},
                {"role": "user", "content": (
                    f"Target language: {target_language}\n\n{text}"
                )},
            ],
        )
        return (completion.choices[0].message.content or "").strip()

class NoopTranslator:
    """API key 未設定時 / テスト用 stub。 そのまま返す。"""
    ENGINE_TAG = "noop"
    def translate(self, text, target_language, source_language=None): return text

def get_translator() -> Translator:
    from django.conf import settings
    key = getattr(settings, "OPENAI_API_KEY", "")
    if not key:
        return NoopTranslator()
    return OpenAITranslator(api_key=key)
```

### 5.1 API key 取り扱い

- `settings.base.py` に `OPENAI_API_KEY = env.str("OPENAI_API_KEY", default="")` を追加
- stg / prod は AWS Secrets Manager 経由で ECS task definition に注入 (terraform で管理、 manual op)
- local 開発は `.envs/.env.local` (gitignore 済) に書く

### 5.2 Rate limit

- backend throttle scope `translate: 60/hour` (auth user)
- frontend は per-tweet 結果を memo して同 ツイートで複数回叩かない

---

## 6. API (P13-03)

### `POST /api/v1/tweets/<id>/translate/`

- 認証必須 (Cookie + CSRF)
- 200 + `{translated_text: string, source_language: string, target_language: string, cached: boolean}`
- response 内訳:
  - `target_language`: `request.user.preferred_language` (server side で決定、 改竄不可)
  - `source_language`: `tweet.language` (DB cache、 null なら 422)
  - `translated_text`: TweetTranslation cache hit なら DB から、 miss なら Claude API 呼び出し + cache 書き
  - `cached`: bool (frontend が「すぐ返った」 を判別するため)
- 同一言語 (tweet.language == user.preferred_language) のときは 422 + `{detail: "Same language"}` (frontend が button 出さない判定とは別に防御)

---

## 7. Frontend (P13-05〜07)

### 7.1 TweetCard の「翻訳する」 button (P13-05)

各 TweetCard の bio 下に小さく `<button>翻訳する</button>` を出す。 表示条件:

- `tweet.language` が non-null
- `tweet.language !== currentUser.preferred_language`
- `tweet.author.id !== currentUser.id` (自分の投稿は翻訳しない)

button click → API call → 結果を `<p>{translatedText}</p>` に差し替え + 下に「原文を表示」 link。

「原文を表示」 click → 元の本文に戻す + 「翻訳する」 button を再表示。

state は client-side `useState`、 page reload で reset (X と同じ per-session 永続)。

### 7.2 設定 (P13-04 + P13-06)

`/settings/profile` の中に追加:

- 「UI 表示言語」 select (ja / en / ko / zh-CN / es / fr 等)
- 「自動翻訳」 toggle (default off)

これらは `User.preferred_language` / `User.auto_translate` を PATCH。

### 7.3 Auto translate (P13-07)

`User.auto_translate=true` のとき、 該当ツイート (tweet.language != user.preferred_language) は初期 render の時点で翻訳結果を表示。 button は「原文を表示」 と「自動翻訳をオフ」 の 2 つ。

実装方針:

- TweetCard レベルで `useEffect` で初期 fetch (auto_translate=true 時のみ)
- pagination / infinite scroll では各 card が個別 fetch (Claude API 呼び出しは DB cache のおかげで二度目以降は速い)

---

## 8. テスト

### 8.1 backend pytest

`apps/tweets/tests/test_tweet_language.py` (P13-01):

- 日本語本文で language=ja
- 英語本文で language=en
- 短すぎる本文 (3 char 以下) は language=None
- 混在言語は最頻言語

`apps/translation/tests/test_translation_service.py` (P13-02):

- OpenAITranslator: mock openai client で 「Hello」 → 「こんにちは」 確認
- NoopTranslator: input をそのまま返す
- `get_translator()` は OPENAI_API_KEY 未設定で NoopTranslator
- `get_translator()` は OPENAI_API_KEY 設定で OpenAITranslator

`apps/tweets/tests/test_translate_endpoint.py` (P13-03):

- 認証必須 (401/403)
- 200 + translated_text 返却
- 2 回目呼び出しで `cached=true`
- 同一言語で 422
- 他人のツイートでも翻訳可
- rate limit (60/hour) で 429
- API key 未設定でも fallback して 200 (Noop で原文返却)

`apps/users/tests/test_language_preference.py` (P13-04):

- preferred_language default = ja
- auto_translate default = false
- PATCH /users/me/ で更新できる

### 8.2 frontend vitest

`TweetCardLanguageBadge.test.tsx` 等:

- tweet.language !== user.preferred_language && 自分の投稿でない → button 表示
- 同一言語 / 自分の投稿 → button 非表示
- 翻訳結果差し替え + 「原文を表示」 で revert

### 8.3 E2E (Playwright, stg)

`client/e2e/auto-translate.spec.ts` (実装済):

- TRANSLATE-1/2: test2 (ja user) で英語投稿の tweet card に「翻訳する」 button → 翻訳済 + 「原文を表示」 → revert で原文戻り + 「翻訳する」 再表示
- TRANSLATE-3: 同一言語 (test2 = ja で日本語投稿) は button が出ない
- TRANSLATE-4: 自分の投稿には button が出ない

実行コマンド (env は [docs/local/e2e-stg.md](../local/e2e-stg.md) 参照):

```bash
cd /workspace/client

PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test2 \
PLAYWRIGHT_USER2_EMAIL=test3@gmail.com \
PLAYWRIGHT_USER2_PASSWORD=Sirius01 \
PLAYWRIGHT_USER2_HANDLE=test3 \
  npx playwright test e2e/auto-translate.spec.ts --reporter=line
```

**注意 (P13-08 未完時)**: stg env に `OPENAI_API_KEY` が注入されるまでは `get_translator()` が `NoopTranslator` を返すので、 endpoint の `translated_text` は原文と同じ文字列になる。 「翻訳済 state への遷移」 と「revert」 の UX 検証は NoopTranslator でも通るので問題ないが、 **実際の翻訳品質確認は P13-08 完了後** に行う必要がある。

---

## 9. ロールアウト順序

1. **P13-01** (backend): Tweet.language 自動検出 + migration
2. **P13-02** (backend): Translation service abstraction + Claude Haiku adapter
3. **P13-03** (backend): translate endpoint
4. **P13-04** (both): User language preferences + settings UI
5. **P13-05** (frontend): TweetCard 翻訳 button + show original toggle
6. **P13-06** (frontend): auto translate global toggle
7. **P13-07** (frontend): auto translate auto-render
8. **P13-08** (infra): OPENAI_API_KEY を stg / prod に投入 (ハルナさん手動)

P13-01〜03 で「手動 click 翻訳」 まで動き、 P13-04〜06 で X 同等の UX、 P13-07 で auto-translate も対応。

各 PR ごとに gan-evaluator で UX 採点。

---

## 10. プライバシー / コスト管理

### Privacy

- 翻訳 API には ツイート本文を送る (OpenAI data policy: API 経由 input/output は default で training に使われない)
- DM / 非公開コンテンツは翻訳対象外 (Tweet model のみ、 DMRoomMessage は触らない)
- ユーザー本人の投稿は翻訳しない (button 非表示)

### Cost

- OpenAI GPT-4o-mini: input $0.15/MTok, output $0.60/MTok (2025 pricing)
- ツイート 1 本 ~200 char (~70 token) で input/output 各 100 token 想定 → ~$0.00006 / 翻訳
  (Claude Haiku より約 1/8 安価)
- DB cache で同 ツイートは 1 回だけ呼ぶ → 月間 1 万翻訳でも $1 弱
- rate limit `60/hour` per user で abuse 防止
- ハルナさん設定の $10 limit でも月 16 万翻訳分の余裕
