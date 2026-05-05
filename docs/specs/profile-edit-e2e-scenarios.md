# プロフィール編集E2Eシナリオ

> 関連issue: #368
>
> 目的: プロフィール編集ページ `/settings/profile`、自分のプロフィールページからの編集導線、`PATCH /api/v1/users/me/` による保存、画像切り抜きUI入口をstgで確認する。

## 1. 対象

- 自分の公開プロフィールページ: `/u/<handle>`
- プロフィール編集ページ: `/settings/profile`
- 自分のプロフィール取得/更新API: `GET/PATCH /api/v1/users/me/`
- 画像切り抜きUI: `ImageCropper`

## 2. シナリオ

### PROF-01: 自分のプロフィールページに編集導線が表示される

前提:

- actor A がログイン済み。
- A の handle が `<USER1_HANDLE>`。

操作:

- `/u/<USER1_HANDLE>` を開く。

期待結果:

- `プロフィールを編集` リンクが表示される。
- リンク先は `/settings/profile`。

### PROF-02: プロフィール編集ページで表示名と自己紹介を保存できる

前提:

- actor A がログイン済み。
- `GET /api/v1/users/me/` で現在のプロフィールを取得できる。

操作:

- `/settings/profile` を開く。
- 表示名と自己紹介を一時的な値に変更する。
- `保存` を押す。

期待結果:

- `PATCH /api/v1/users/me/` が 200 を返す。
- 保存後 `/u/<USER1_HANDLE>` に遷移する。
- 公開プロフィールに変更後の表示名と自己紹介が表示される。
- テスト後、APIで元の表示名と自己紹介に戻す。

### PROF-03: プロフィール編集ページに画像切り抜きUIの入口が表示される

前提:

- actor A がログイン済み。

操作:

- `/settings/profile` を開く。

期待結果:

- アバター用の `アバターを追加` または `アバターを変更` ボタンが表示される。
- ヘッダー用の `ヘッダーを追加` または `ヘッダーを変更` ボタンが表示される。

### PROF-04: 外部リンクURLはhttpsのみ許可する

前提:

- actor A がログイン済み。

操作:

- `/settings/profile` を開く。
- GitHub欄に `http://example.com` を入力する。
- `保存` を押す。

期待結果:

- `https:// で始まるURLを入力してください` が表示される。
- `PATCH /api/v1/users/me/` は送信されない。

## 3. 実行コマンド

stg実行時は認証情報を環境変数で渡す。

```bash
cd /workspace/client
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=<USER1_EMAIL> PLAYWRIGHT_USER1_PASSWORD=<USER1_PASSWORD> PLAYWRIGHT_USER1_HANDLE=<USER1_HANDLE> \
npx playwright test e2e/profile-edit.spec.ts --workers=1 --reporter=line
```

単独シナリオ実行:

```bash
# PROF-01: 自分のプロフィールページに編集導線が表示される
npx playwright test e2e/profile-edit.spec.ts --workers=1 --reporter=line --grep "PROF-01"

# PROF-02: プロフィール編集ページで表示名と自己紹介を保存できる
npx playwright test e2e/profile-edit.spec.ts --workers=1 --reporter=line --grep "PROF-02"

# PROF-03: プロフィール編集ページに画像切り抜きUIの入口が表示される
npx playwright test e2e/profile-edit.spec.ts --workers=1 --reporter=line --grep "PROF-03"

# PROF-04: 外部リンクURLはhttpsのみ許可する
npx playwright test e2e/profile-edit.spec.ts --workers=1 --reporter=line --grep "PROF-04"
```
