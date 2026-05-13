# Phase 12: 居住地マップ + ユーザー検索 — 仕様

> Issue: #673〜#677 (Milestone "Phase 12: 住所マップ + ユーザー検索" #15)
> 関連: [docs/issues/phase-12.md](../issues/phase-12.md) (未整備、本 spec が暫定 source of truth)

---

## 1. 背景

X / Mixi / Facebook など主要 SNS には「居住地マップ」 / 「近所のユーザー検索」 機能がある。
本機能で実現したいのは:

- プロフィールに **円** で居住地を表示する (ピンポイント禁止 — プライバシー保護)
- 任意のタイミング (signup / 設定画面) で **円の中心と半径を変更** できる
- 「自分の近くに住んでいる人」 を検索できる
- そもそも欠けていた **汎用ユーザー検索 page** (handle / display_name / bio で full-text) も整備する

ハルナさん要件:

> 完璧にピンポイントに公開されては困るので、最低でも500mの半径を持たせて欲しい。

---

## 2. スコープ (Phase 12-A 〜 12-E)

| ID     | 内容                                                | Issue |
| ------ | --------------------------------------------------- | ----- |
| P12-01 | UserResidence model + CRUD API (PATCH/GET/DELETE)   | #673  |
| P12-02 | プロフィール表示 map + 設定画面 (Leaflet + OSM)     | #674  |
| P12-03 | サインアップ wizard に居住地ステップ追加            | #675  |
| P12-04 | 汎用ユーザー検索 page (handle / display_name / bio) | #676  |
| P12-05 | 近所検索 (haversine SQL, `?near_me=1&radius_km=N`)  | #677  |

---

## 3. データモデル (P12-01)

```python
class UserResidence(models.Model):
    MIN_RADIUS_M = 500
    MAX_RADIUS_M = 50_000

    user        = OneToOneField(User, on_delete=CASCADE, related_name="residence")
    latitude    = DecimalField(max_digits=9, decimal_places=6)   # WGS84
    longitude   = DecimalField(max_digits=9, decimal_places=6)
    radius_m    = PositiveIntegerField(default=MIN_RADIUS_M)
    created_at  = DateTimeField(auto_now_add=True)
    updated_at  = DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            CheckConstraint(check=Q(latitude__gte=-90,  latitude__lte=90),  name="user_residence_lat_range"),
            CheckConstraint(check=Q(longitude__gte=-180, longitude__lte=180), name="user_residence_lng_range"),
            CheckConstraint(check=Q(radius_m__gte=500, radius_m__lte=50_000), name="user_residence_radius_range"),
        ]
```

- WGS84 precision 6 = 約 11cm 単位。 居住地表現として十分。
- **CheckConstraint で DB 側にも min 500m を強制** (serializer すり抜け対策)。
- PostGIS は使わない (RDS の拡張インストール不要、 MVP 規模なら haversine SQL で十分)。

---

## 4. API (P12-01)

### 4.1 `GET /api/v1/users/me/residence/` — 自分の居住地取得

- 認証必須 (Cookie + CSRF)
- 200 + JSON `{latitude, longitude, radius_m, updated_at}`
- 未設定なら 404

### 4.2 `PATCH /api/v1/users/me/residence/` — upsert

- 認証必須
- body: `{latitude, longitude, radius_m}`
- **radius_m < 500** は 400 (privacy enforce)
- **radius_m > 50000** は 400 (UX 上 50km 以上の円は意味なし)
- lat ∉ [-90, 90] / lng ∉ [-180, 180] は 400
- 既存 row があれば更新、 無ければ作成 (`update_or_create`)
- 200 + 同じ shape

### 4.3 `DELETE /api/v1/users/me/residence/` — 削除

- 認証必須
- 204 (居住地が無くても 204 を返す = 冪等)

### 4.4 `GET /api/v1/users/<handle>/residence/` — 他人の居住地

- 認証不要 (anon でもプロフィール page から map を表示できる必要)
- 未設定 / unknown user は 404
- 200 + 同じ shape (radius_m は本人が制御している = ピンポイント漏れの心配なし)

### 4.5 後続 endpoint (P12-04 / P12-05)

```
GET /api/v1/users/?q=<text>              # text 検索 (handle / display_name / bio)
GET /api/v1/users/?near_me=1&radius_km=N # 近所検索 (haversine, 認証必須)
```

---

## 5. プライバシー設計

| 攻撃                                               | 対策                                                      |
| -------------------------------------------------- | --------------------------------------------------------- |
| クライアント側 slider min=1 改竄でピンポイント公開 | serializer `min_value=500` + DB `CheckConstraint` 二重    |
| `lat/lng` 整数桁を弄って overflow                  | `DecimalField(max_digits=9, decimal_places=6)` で物理制限 |
| 同一 user に複数 residence 作る                    | `OneToOneField` で 1:1                                    |
| User 削除後の orphan                               | `on_delete=CASCADE`                                       |

「未設定」 をユーザーが選べる権利は `DELETE` で保証。

---

## 6. フロントエンド設計 (P12-02 〜 P12-05)

### 6.1 ライブラリ選定: Leaflet + OpenStreetMap

- API key 不要、 商用利用無料、 タイル無料
- Google Maps / Mapbox は key + 課金が発生するので除外
- `react-leaflet` を thin wrapper として採用
- **SSR-safe**: `next/dynamic` + `ssr: false` で client-only コンポーネントにする

### 6.2 主要画面

1. **プロフィール詳細 `/profile/[handle]`**: 居住地が設定されていれば map (Circle) を表示 (静的、 zoom 固定、 ドラッグのみ)
2. **設定 `/settings/residence`**: 中心を地図クリック / ドラッグで設定、 radius を slider (500m 〜 50km) で調整 → 保存
3. **サインアップ wizard 最終ステップ**: 任意 (skip 可)。 「あとで設定」 リンクで skip。
4. **`/search/users`**: text 検索結果一覧 (handle / display_name / bio から hit)。 「自分の近くで絞る」 トグルで近所検索

---

## 7. テスト

### 7.1 backend pytest (P12-01)

`apps/users/tests/test_user_residence.py` で 21 cases:

- `TestMyUserResidence`:
  - GET 認証必須 (401/403)
  - 未設定で 404
  - PATCH で create
  - PATCH で update
  - radius < 500 (0/1/100/499) は 400 ×4
  - radius > 50000 は 400
  - lat/lng range 外 (4 cases) は 400
  - DELETE で消える + 冪等
- `TestPublicUserResidence`:
  - anon でも他人の居住地 GET 200
  - 未設定 / unknown は 404
- `TestUserResidenceModel`:
  - User 削除で CASCADE
  - DB CheckConstraint も radius=1 を reject (二重防御)
  - 同一 user に 2 個作れない (OneToOne)

実行:

```bash
docker compose -f local.yml exec api pytest apps/users/tests/test_user_residence.py -v --no-cov
```

### 7.2 frontend vitest (P12-02)

`client/src/lib/api/__tests__/residence.test.ts` で 6 cases:

- 定数 `RESIDENCE_MIN_RADIUS_M` / `RESIDENCE_MAX_RADIUS_M` 露出
- `fetchMyResidence` 200 / 404 (null) / 500 (rethrow)
- `saveMyResidence` PATCH + CSRF bootstrap
- `deleteMyResidence` DELETE + CSRF bootstrap

実行:

```bash
cd client && npx vitest run src/lib/api/__tests__/residence.test.ts
```

### 7.3 E2E (Playwright, P12-02 で追加)

`client/e2e/residence.spec.ts` で stg 検証:

- RESIDENCE-1 (golden): ログイン → API で設定 → /u/<self> で `.leaflet-container` 描画確認 →
  /settings/residence で「保存する」 button が見える (ログイン経路の確認)
- RESIDENCE-2 (anon view): 別 user のプロフィール page を anon で踏んで「居住地」 region が見える
- RESIDENCE-3 (min enforce): radius=100 を API に投げて 400 が返る (frontend slider すり抜け不可)

実行:

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me npx playwright test e2e/residence.spec.ts
```

---

## 8. ロールアウト順序

1. ✅ **P12-01** (#678 merged): model + API + tests
2. **P12-02** (本 PR): 設定 UI + プロフィール map 表示 (Leaflet + OSM)
3. P12-03: signup wizard 統合
4. P12-04: 汎用 user search page
5. P12-05: 近所検索 (haversine SQL)

各段階で `gan-evaluator` agent に採点させて UX を確認 (新 route 追加なので Phase 11 同様の必須運用)。
