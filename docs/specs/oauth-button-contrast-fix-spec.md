# Google ログイン button のコントラスト修正 (#615)

> 関連 Issue: #615
> 関連 PR: TBD
> 種別: a11y / UX fix (frontend)

## 1. 背景

`gan-evaluator` 再採点 (2026-05-11) で HIGH-NEW-1 として発見。

`/login` `/register` の「Google でログイン」 button が **黒文字 on 紺背景** で計測コントラスト比 **≈ 1.06:1** (WCAG AA 4.5:1 を大幅違反)。 事実上 文字が見えず Google OAuth 経路が **死んでいた**。

PR #614 (`fix(auth): /login submit button の透明化 bug を修正、 5 form 共通`) が `bg-eerieBlack` / `pumpkin` / `h4-semibold` の未定義 class を 5 form から一斉削除したが、 `client/src/components/shared/OauthButton.tsx` は scope 外で取り残されていた。

## 2. 原因

`OauthButton.tsx` (line 11-23):

```tsx
const className = clsx(
	"text-babyPowder mt-3 flex-1 rounded-md px-3 py-2 font-medium",
	{
		"electricIndigo-gradient hover:bg-blue-700": provider === "google",
	},
);
```

- `text-babyPowder` → tailwind config に未定義 → 効かず、 親要素から継承された 既定色 (≈ 黒) のまま
- `electricIndigo-gradient` → 同上、 効かず、 shadcn `<Button>` default variant の `bg-primary` (= navy CSS variable) がそのまま残る
- 結果: navy bg + 黒文字 = コントラスト 1.06

## 3. 直し方

PR #614 と同じく、 未定義 class を全削除して shadcn `<Button>` の default variant に任せる。 layout 用の `w-full` だけ残す:

```diff
- const className = clsx(
-   "text-babyPowder mt-3 flex-1 rounded-md px-3 py-2 font-medium",
-   {
-     "electricIndigo-gradient hover:bg-blue-700": provider === "google",
-   },
- );
+ const className = clsx("mt-3 w-full");
```

shadcn `<Button>` の default variant は `bg-primary text-primary-foreground` で navy bg + 白文字 → コントラスト ≈ 15+:1 (WCAG AAA も余裕)。

### 採用しない選択肢

- **`text-babyPowder` を tailwind config に定義する**: 既存 component (LoginForm 等) は同じ理由で全部 default variant に統一されたので、 OauthButton だけ legacy 維持しても意味がない。
- **Google 公式 brand color (white bg / Google logo) に変更**: 採用しても良いが、 spec を超える変更で別 PR (ブランディング考慮) のほうが適切。 今回は最小修正 (contrast 違反だけ潰す) に絞る。

## 4. 受け入れ基準

- [ ] `/login` の「Google でログイン」 button text と background のコントラスト比 ≥ 4.5
- [ ] `/register` でも同様
- [ ] click → Google OAuth flow に進む (regression なし、 `onGoogleClick` handler は変更しない)
- [ ] `npx tsc --noEmit` 通過
- [ ] Playwright e2e `login-button-visibility.spec.ts` LOGIN-2 で WCAG AA 比率を assert (4.5:1+)

## 5. テスト

### E2E (Playwright)

`client/e2e/login-button-visibility.spec.ts` に 1 ケース追加:

| ID      | シナリオ                                                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| LOGIN-2 | `/login` の Google button の computed `background-color` と `color` を取り、 相対輝度 (WCAG 2.x 式) でコントラスト比を算出。 4.5 以上を assert |

### 手動視認 (Playwright MCP / Chrome)

`/login` で button を screenshot → 文字「Google でログイン」 が読める + click で `/google` への OAuth redirect (regression なし)

## 6. ロールアウト

- `fix/issue-615-oauth-button-contrast` branch で PR、 CI 緑なら squash merge
- stg CD 反映後 gan-evaluator 再採点で HIGH-NEW-1 解消を確認
