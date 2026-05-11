# /login submit button が透明 / 非表示で見えない (#609)

> 関連 Issue: #609
> 関連 PR: TBD
> 種別: bug fix (frontend, UX critical)

## 1. 背景

`gan-evaluator` MEDIUM M3 として発見。 Phase 6 で他の bug を踏んで anon が `/login?next=...` にリダイレクトされた際、 **submit button が透明で見えず**、 user はログインできずに詰む状態だった。

Phase 6 関連の他 bug (`#606` SSR auth gate / `#608` anon 誤誘導) を 1 個直すごとに /login に飛ばされる頻度が増えるので、 ここを潰さないと「ログイン詰み」 の出口が無くなる。

## 2. 原因

`client/src/components/forms/auth/LoginForm.tsx:94` の `<Button>` className:

```
h4-semibold bg-eerieBlack dark:bg-pumpkin w-full text-white
```

- `h4-semibold`: tailwind / globals.css に未定義 → 効かない
- `bg-eerieBlack`: tailwind.config.ts の `colors` に **未定義** → 効かない
- `dark:bg-pumpkin`: 同上 → 効かない
- `text-white`: 効く → **白文字 + 透明背景** で 真っ白な login frame の上では完全に見えない

shadcn `<Button>` の default variant は `bg-primary text-primary-foreground shadow hover:bg-primary/90` を当てるが、 `text-white` が `text-primary-foreground` を上書きする上に背景は無効 class のため透明になる。

同じ class pattern は以下 4 ファイルでも繰り返し使われていて、 同じ問題:

| ファイル                       | submit text                                 |
| ------------------------------ | ------------------------------------------- |
| `LoginForm.tsx`                | "Sign In" (日本語 SNS なのに英語のまま放置) |
| `RegisterForm.tsx`             | "アカウント作成"                            |
| `PasswordResetRequestForm.tsx` | "再設定リンクを送信"                        |
| `PasswordResetConfirmForm.tsx` | "パスワードを再設定"                        |
| `OnboardingForm.tsx`           | "はじめる"                                  |

5 箇所 全て同じ bug。

## 3. 直し方

不要な未定義 class を全削除し、 shadcn `<Button>` の default variant (`bg-primary text-primary-foreground`) に任せる。 layout 用の `w-full` だけ残す:

```diff
- <Button
-   type="submit"
-   className="h4-semibold bg-eerieBlack dark:bg-pumpkin w-full text-white"
-   disabled={isLoading}
- >
-   {isLoading ? <Spinner size="sm" /> : `Sign In`}
- </Button>
+ <Button type="submit" className="w-full" disabled={isLoading}>
+   {isLoading ? <Spinner size="sm" /> : "ログイン"}
+ </Button>
```

LoginForm はついでに label を "Sign In" → "ログイン" に 日本語化 (日本語話者エンジニア向け SNS なので)。 他 4 form は 既に 日本語 label なので変更不要。

### 採用しない選択肢

- **`bg-eerieBlack` / `pumpkin` を tailwind config に定義する**: 設計意図が不明、 1 箇所しか使われていない (Pagination / UsersSearch にも見えるが装飾レベル)。 default variant に統一するほうがメンテ容易。
- **dark mode で別 accent**: shadcn の default variant は dark mode 自動対応 (`bg-primary` は CSS variable `--primary` で切り替わる) なので追加対応不要。

## 4. 受け入れ基準

- [ ] `/login` で「ログイン」 submit button が **見える** (background 不透明、 boundingBox.height > 20px)
- [ ] click → POST `/api/v1/auth/cookie/create/` → cookie 取得 → home redirect (regression なし)
- [ ] `/register` / `/forgot-password` / `/password-reset-confirm/...` / `/onboarding` の submit button も同様に見える
- [ ] `npx tsc --noEmit` 通過
- [ ] Playwright e2e LOGIN-1 で button visible + background opaque を assert

## 5. テスト

### E2E (Playwright)

`client/e2e/login-button-visibility.spec.ts` を新規追加:

| ID      | シナリオ                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| LOGIN-1 | `/login` の「ログイン」 button が visible + background-color が `rgba(0,0,0,0)` / `transparent` でない + boundingBox の height > 20px |

### 手動視認 (Playwright MCP)

- `/login`, `/register`, `/forgot-password`, `/onboarding` で submit button を screenshot し、 文字 + 背景が両方視認できるか目視

## 6. ロールアウト

- `fix/issue-609-login-button` branch で PR、 CI 緑なら squash merge
- stg CD 反映後 `/login` を Playwright MCP で踏んで完了
- gan-evaluator 再採点で M3 解消
