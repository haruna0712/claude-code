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

### 7.4 ユーザー検索 (P12-04)

backend pytest (`apps/users/tests/test_user_search_fulltext.py` 9 cases):

- anon 可 / 空 query は空配列 / handle / display_name / bio に部分一致
- is_active=False を除外 / cursor pagination で 20+5 件
- response は user_id / username / display_name / bio / avatar_url のみ (email / is_premium 等は出さない)

frontend vitest (`client/src/lib/api/__tests__/userSearch.test.ts` 4 cases):

- non-empty q を ?q= に / 空 query は param 無し / cursor 引き継ぎ / response shape

E2E (`client/e2e/user-search.spec.ts` 3 cases):

- USER-SEARCH-1 (anon): /search/users が 200、 search form が見える
- USER-SEARCH-2 (golden): 検索 → user card → /u/<handle> プロフィール遷移
- USER-SEARCH-3 (nav): home から「ユーザー検索」 link で 1 click で到達

実行:

```bash
docker compose -f local.yml exec api pytest apps/users/tests/test_user_search_fulltext.py -v --no-cov
cd client && npx vitest run src/lib/api/__tests__/userSearch.test.ts
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me npx playwright test e2e/user-search.spec.ts
```

### 7.5 近所検索 (P12-05)

backend pytest (`apps/users/tests/test_user_search_near_me.py` 10 cases):

- `?near_me=1` は要 auth (401/403)
- `?near_me=1` で自分 residence 未設定 → 400 (`{near_me: "..."}`)
- 半径内の user だけ返る、 大阪 (~400km) は radius 10km で除外
- response に `distance_km` が含まれる (東京駅⇔新宿駅 ≈ 5.5km の妥当性検証)
- `distance_km` 昇順で sort
- `?near=lat,lng&radius_km=N` は anon でも動く (explicit center)
- `q` と near_me 併用で AND (text 一致 AND 半径内)
- 不正 `near=` 値で 400
- `radius_km=1000` でも 200km にクランプ
- residence 未設定の user は結果から除外 (INNER JOIN residence)

haversine SQL は `6371 * acos(cos(radians(lat1)) * cos(radians(lat2)) * cos(...) + sin(radians(lat1)) * sin(radians(lat2)))` を `RawSQL` で annotate、 `__lte=radius_km` で filter。 PostGIS 不要。

frontend vitest (拡張):

- `userSearch.test.ts`: 4 → 8 cases (near_me 1/radius_km / combine q+near_me+cursor / default radius)
- `UserSearchResultCard.test.tsx`: 7 → 10 cases (distance_km バッジ表示 / null 非表示 / 0 km 表示)
- `NearMeFilter.test.tsx` 新規 (7 cases): toggle render / login hint / slider 表示 / navigate URL / drag 中は navigate しない

E2E (`client/e2e/near-me-search.spec.ts` 3 cases):

- NEAR-1 (anon): /search/users?near_me=1 を anon で踏むと「ログインが必要」 が出る
- NEAR-3 (golden): test1 が新宿、 test2 が東京駅で residence 設定 →
  /search/users?near_me=1&radius_km=20 で test2 の card に「約 X km」 バッジ
- NEAR-NAV: home → 「ユーザー検索」 link → 「自分の近所で絞り込む」 toggle

実行:

```bash
docker compose -f local.yml exec api pytest apps/users/tests/test_user_search_near_me.py -v --no-cov
cd client && npx vitest run src/lib/api/__tests__/userSearch.test.ts src/components/search/__tests__/
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me npx playwright test e2e/near-me-search.spec.ts
```

### 7.6 サインアップ wizard 統合 (P12-03)

step 1 (`/onboarding`) の display_name + bio 入力後に step 2 (`/onboarding/residence`)
の prompt を挟む。 prompt 自体は presentational で API call なし、 「今すぐ設定」
は `/settings/residence` (Leaflet editor、 P12-02 と同じ画面)、 「あとで設定」
は `/` に飛ばす。 既存 `useOnboardingGuard` は step 1 完了で `needs_onboarding=False`
が立つので step 2 は anytime 訪問可能な普通の page。

vitest:

- `OnboardingForm.test.tsx` (3 cases): submit 成功で `/onboarding/residence` に
  redirect / submit 失敗で redirect なし / form の input 表示
- `app/onboarding/residence/__tests__/page.test.tsx` (3 cases): heading / 2 つの
  link href / step indicator が「居住地 (任意)」 を current にする

E2E (`client/e2e/onboarding-residence.spec.ts` 3 cases):

- ONBOARD-RES-1 (anon): /onboarding/residence は anon でも 200 (prompt は
  public、 link 先で auth gate される)
- ONBOARD-RES-2 (skip): 「あとで設定する」 → `/` 遷移
- ONBOARD-RES-3 (golden): 「今すぐ設定する」 → /settings/residence の保存 button

実行:

```bash
cd client && npx vitest run src/components/forms/onboarding/__tests__/ src/app/onboarding/residence/__tests__/
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me npx playwright test e2e/onboarding-residence.spec.ts
```

---

## 8. ロールアウト順序

1. ✅ **P12-01** (#678 merged): model + API + tests
2. ✅ **P12-02** (#679 merged): 設定 UI + プロフィール map 表示 (Leaflet + OSM)
3. ✅ **P12-04** (#680 merged): 汎用 user search page (full-text、 cursor pagination)
4. ✅ **P12-05** (#681 merged): 近所検索 (haversine SQL, near_me=1 / near=lat,lng)
5. ✅ **P12-03** (merged): signup wizard step 2 (居住地 prompt)
6. ✅ **P12-06** (#815 backend / #818 frontend merged): `Occupation` model + 多選択編集 UI (本 spec §9)
7. ✅ **P12-07** (#816 merged / PR #823, E2E hotfix #826): `/api/v1/users/search/?occupation=` filter + chip filter UI (本 spec §10、 stg E2E 4/4 pass、 gan-evaluator 8.0/10、 ui-ux-tester CRITICAL 0 → follow-up #827 / #828)
8. **P12-08** (#817): `/search/users` に Leaflet 地図 view toggle + bbox query (本 spec §11、 backend=P12-08a / frontend=P12-08b の 2 PR)

各段階で `gan-evaluator` agent に採点させて UX を確認 (新 route 追加なので Phase 11 同様の必須運用)。

---

## 9. 職業 (Occupation) model — P12-06

### 9.1 背景

ハルナさん要望: 「ユーザー検索で地図上で検索できるようにならないかな？地図の上に検索欄があって、職業がデザイナーの人を検索する」

地図 view (P12-08) と職業フィルタ (P12-07) を実装する前提として、 **そもそも User に「職業」 フィールドが無い**。 これを最初に整える。

設計判断:

- 自由 string では「フロントエンド」 「Frontend」 「frontend」 が一致せず検索品質が低い
- 既存 `apps.tags.Tag` (技術タグ用、 user-proposed + moderator approval) とは目的が違う
  - `Tag` = community-grown taxonomy (TypeScript / Next.js 等、 何百件にもなる)
  - `Occupation` = curated, fixed vocabulary (~16 件、 admin が seed/管理)
- → **別 model `Occupation` (apps/users) + User との M2M** で実装

### 9.2 データモデル

```python
# apps/users/models.py
class Occupation(models.Model):
    """エンジニア職業の controlled vocabulary (P12-06)。

    Tag (apps.tags) と違って admin seed/管理で、 ユーザー側からは作成・編集不可。
    M2M で User と紐付ける (1 user あたり最大 3 件)。
    """

    slug          = SlugField(max_length=50, unique=True)
    display_name  = CharField(max_length=50)
    display_order = PositiveSmallIntegerField(default=100)
    is_active     = BooleanField(default=True)
    created_at    = DateTimeField(auto_now_add=True)
    updated_at    = DateTimeField(auto_now=True)

    class Meta:
        ordering = ["display_order", "slug"]
        indexes = [
            models.Index(fields=["is_active", "display_order"], name="users_occ_active_order_idx"),
        ]


class UserOccupation(models.Model):
    """User ↔ Occupation の through (P12-06)。

    将来「主な職業 (1件)」 を強調するための ``is_primary`` を追加できるよう through 化。
    """

    MAX_PER_USER = 3

    user        = ForeignKey(User, on_delete=CASCADE, related_name="user_occupations")
    occupation  = ForeignKey(Occupation, on_delete=CASCADE, related_name="user_occupations")
    created_at  = DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            UniqueConstraint(fields=["user", "occupation"], name="user_occupation_unique"),
        ]
        indexes = [
            models.Index(fields=["occupation"], name="user_occupation_occ_idx"),
        ]


# User に M2M 追加
class User(AbstractUser):
    ...
    occupations = models.ManyToManyField(
        Occupation,
        through="UserOccupation",
        related_name="users",
        blank=True,
    )
```

**制約**:

- 1 user あたり **最大 3 件** (serializer 層で enforce)
- `Occupation.is_active=False` は API list / PUT で除外
- User 削除 → `UserOccupation` も CASCADE
- Occupation 削除 → `UserOccupation` も CASCADE (admin は soft delete `is_active=False` を推奨)

### 9.3 初期 seed (data migration)

```python
INITIAL_OCCUPATIONS = [
    ("designer",   "デザイナー",                    10),
    ("frontend",   "フロントエンドエンジニア",       20),
    ("backend",    "バックエンドエンジニア",         30),
    ("fullstack",  "フルスタックエンジニア",         40),
    ("mobile",     "モバイルエンジニア",             50),
    ("ml",         "ML / AI エンジニア",             60),
    ("data",       "データエンジニア / アナリスト",  70),
    ("sre",        "SRE / インフラ",                 80),
    ("security",   "セキュリティ",                   90),
    ("game",       "ゲーム開発",                    100),
    ("embedded",   "組み込み / ハードウェア",       110),
    ("qa",         "QA / テスト",                   120),
    ("pm",         "プロダクトマネージャ",          130),
    ("em",         "エンジニアリングマネージャ",    140),
    ("student",    "学生",                          150),
    ("other",      "その他",                        999),
]
```

seed は **冪等** (`update_or_create`)。 将来 admin から増減可能。

### 9.4 API

| Method | Path                            | 認証 | 内容                                                                |
| ------ | ------------------------------- | ---- | ------------------------------------------------------------------- |
| GET    | `/api/v1/occupations/`          | anon | `is_active=True` を `display_order` 順で返す                        |
| GET    | `/api/v1/users/me/occupations/` | auth | 自分の slug 配列                                                    |
| PUT    | `/api/v1/users/me/occupations/` | auth | body `{"slugs": [...]}` で **置換** (最大 3、 4 件以上は 400)       |
| GET    | `/api/v1/users/<handle>/`       | anon | 既存 profile response に `occupations: [{slug, display_name}, ...]` |

PUT を **置換** にする理由: M2M の add/remove を逐次 API で叩くより、 client が「最終的にこの 3 つ」 を declarative に渡せる方がシンプル + 競合に強い。

**バリデーション**:

- `slugs` が array でない / non-string element / 空文字混入 → 400
- `len(slugs) > 3` → 400
- 未知 slug → 400 (`{slugs: ["unknown slug: ..."]}`)
- `is_active=False` slug → 400 (廃止済み職業は選択不可)
- 重複 slug (`["a", "a"]`) → 400

### 9.5 frontend (本 PR では未実装、 follow-up issue で対応)

P12-06 の frontend (`/settings/profile` chip 多選択 + `/u/<handle>` 表示) は backend が緑になった後の follow-up PR で実装する。 backend PR を軽く保つ + frontend は a11y / E2E のレビュー量が backend と独立で大きいため。

### 9.6 backend テスト (P12-06)

`apps/users/tests/test_occupation.py`:

- `TestOccupationModel`: slug unique / `__str__` / ordering (display_order ASC)
- `TestUserOccupationModel`: 同一 (user, occupation) は IntegrityError / User CASCADE / Occupation CASCADE
- `TestOccupationListAPI`: anon 200 / is_active=False 除外 / display_order 順 / shape = `[{slug, display_name, display_order}]`
- `TestMyOccupationsAPI`:
  - GET 認証必須 (401/403)
  - GET 未設定 → 空配列 `{"slugs": []}`
  - GET 設定済み → slug 配列
  - PUT 認証必須
  - PUT で置換 (既存 0 → 2、 2 → 3、 3 → 1)
  - PUT 空配列で全消し
  - PUT 4 件で 400
  - PUT 未知 slug で 400
  - PUT is_active=False slug で 400
  - PUT 重複 slug で 400
  - PUT non-array で 400
- `TestUserProfileOccupationField`: GET `/api/v1/users/<handle>/` で `occupations` 配列が含まれる、 未設定 user は空配列

実行:

```bash
docker compose -f local.yml exec api pytest apps/users/tests/test_occupation.py -v --no-cov
```

### 9.7 frontend テスト (P12-06 follow-up)

follow-up issue で実装。 概要は P12-07 / P12-08 と同様の chip 多選択 vitest + Playwright E2E。

---

## 10. 検索 API の occupation filter + chip UI — P12-07 (#816)

### 10.1 背景

P12-06 (#815 / #818) で User に `Occupation` M2M が入った。 これを **ユーザー検索 API + UI** から
filter できるようにする。 ハルナさん要望「職業がデザイナーの人を検索する」 の中核。

既存 `UserFullTextSearchView` (`GET /api/v1/users/search/`, §7.4 / §7.5) に occupation filter を
**追加** する。 地図 view は P12-08 (#817) で別 PR、 本 PR は **list 表示のままの chip filter** に閉じる。

### 10.2 API 仕様

`GET /api/v1/users/search/?occupation=designer&occupation=frontend`

| query                 | 意味                                                               |
| --------------------- | ------------------------------------------------------------------ |
| `occupation=<slug>`   | 繰り返し可。 **複数指定は OR 結合** (designer **または** frontend) |
| `q` との併用          | AND (`q` 部分一致 **かつ** いずれかの occupation を持つ)           |
| `near_me=1` / `near=` | AND (近所 **かつ** occupation)                                     |

ルール:

- **未知 slug は無視** (存在 + `is_active=True` の slug だけ採用)。 bookmark URL を将来の vocabulary 変更で壊さないため。
- 有効な occupation slug が **1 件も無ければ occupation filter は適用しない** (q / near 単独検索と同じ挙動)。
- M2M JOIN で同一 user が重複しうるので **`.distinct()`** で重複排除。
- occupation だけ指定 (q も near も無し) でも検索成立 → `is_active=True` user を `username` 順で返す。
- 検索成立条件は「`q` あり **or** `near` 系あり **or** 有効な occupation slug が 1 件以上」。 どれも無ければ従来通り空配列。

レスポンス形は §7.4 の `UserFullTextSerializer` をそのまま流用 (occupation を列に増やさない。 表示は frontend が catalog と突き合わせる必要が無いので最小に保つ)。

### 10.3 実装方針 (backend)

`UserFullTextSearchView.get_queryset`:

1. `params.getlist("occupation")` で slug 配列を取得 (DRF `query_params` は `QueryDict`)。
2. `Occupation.objects.filter(slug__in=raw_slugs, is_active=True).values_list("slug", flat=True)` で
   **有効 slug に正規化** (未知 / inactive を落とす)。
3. 検索成立判定に「有効 occupation slug が 1 件以上」 を OR で加える。
4. `qs = qs.filter(occupations__slug__in=valid_slugs).distinct()` で OR filter。
   - near 検索 (haversine annotate) と併用する場合も `.distinct()` を最後に維持する。
   - 既存 `order_by` の前に `.distinct()` を挟んでも cursor pagination は安定 (ordering 列は username / distance のまま)。

### 10.4 実装方針 (frontend)

- `lib/api/userSearch.ts`: `UserSearchOptions` に `occupations?: string[]` 追加。 `fetchUserSearch` で
  `occupations.forEach((slug) => params.append("occupation", slug))` (URLSearchParams は append で繰り返し可)。
- **新規** `components/search/OccupationFilter.tsx` (client component):
  - props: `occupations: Occupation[]` (catalog), `selected: string[]`, `query`, `nearMe`, `radiusKm`。
  - chip を `role="group"`、 各 chip は `<button role="switch" aria-checked>` (OccupationChipPicker と同じ a11y パターンを踏襲)。
  - toggle で `router.push("/search/users?...&occupation=slug")` に URL 同期。 既存 q / near_me / radius_km は維持。
  - 選択 chip は `--a-accent-deep` 塗り + ✓、 未選択は border のみ (OccupationChipPicker と一貫)。
- `app/(template)/search/users/page.tsx`:
  - `searchParams.occupation` は string | string[] (Next.js は重複 key を配列化)。 正規化 helper で `string[]` に。
  - SSR で `fetchOccupations()` を呼んで catalog を取得 (fail-safe: 失敗時 console.error + [], filter UI 非表示)。
  - `loadUserSearch` / `buildSearchHref` に occupation を織り込む。 hasAnyQuery 判定に occupation を追加。
  - `OccupationFilter` を `NearMeFilter` の下に配置。
- catalog が空 (取得失敗) のとき chip UI は描画しない (q / near は従来通り動く)。

### 10.5 テスト (P12-07)

#### backend pytest — `apps/users/tests/test_user_search_occupation.py`

| case                                 | 期待                                                              |
| ------------------------------------ | ----------------------------------------------------------------- |
| `?occupation=designer`               | designer を持つ user のみ、 持たない user は出ない                |
| `?occupation=designer&=frontend`     | designer **OR** frontend を持つ user (和集合)、 重複 user は 1 件 |
| 複数 occupation 持つ user の重複排除 | designer+frontend 両方の user が結果に 1 回だけ (`.distinct()`)   |
| `?q=react&occupation=frontend`       | bio/handle/name に react を含み **かつ** frontend (AND)           |
| `?near_me=1&occupation=designer`     | auth 必須 + 近所 **かつ** designer (AND)、 anon は 401            |
| `?near=lat,lng&occupation=designer`  | anon 可 + 近所 **かつ** designer (AND)                            |
| 未知 slug 単独 `?occupation=xxx`     | 有効 slug 0 件 + q/near 無し → **空配列** (検索条件なし扱い)      |
| inactive slug 単独                   | 採用しない → 有効 slug 0 件 → **空配列**                          |
| valid + invalid 混在                 | invalid を drop し valid slug だけで filter                       |
| occupation 単独 (有効 slug あり)     | 検索成立、 該当 user を username 順                               |
| 何も指定無し (occupation も無し)     | 空配列 (従来挙動維持)                                             |

#### frontend vitest — `lib/api/__tests__/userSearch.test.ts` (追記) + `components/search/__tests__/OccupationFilter.test.tsx`

- `fetchUserSearch` が `occupations: ["designer","frontend"]` を `?occupation=designer&occupation=frontend` に展開
- 空配列 / 未指定なら occupation param を付けない
- OccupationFilter: chip click で `router.push` が呼ばれ URL に occupation slug が入る
- 選択済み chip 再 click で URL から外れる
- selected prop の chip が `aria-checked="true"`

#### E2E — `client/e2e/user-search-occupation.spec.ts`

| ID          | 誰が | 何をする                                       | 何が見える                                                 |
| ----------- | ---- | ---------------------------------------------- | ---------------------------------------------------------- |
| OCCSEARCH-1 | anon | `/search/users` で「デザイナー」 chip を click | URL に `?occupation=designer`、 designer user が結果に出る |
| OCCSEARCH-2 | anon | designer + frontend の 2 chip を選択           | 両方の OR 和集合が出る、 URL に 2 つの occupation          |
| OCCSEARCH-3 | anon | chip 選択した URL を直接 reload                | chip が選択状態を保持 (URL → 初期 selected 復元)           |
| OCCSEARCH-4 | anon | `?q=...&occupation=designer` で q と併用       | q AND occupation で絞られる                                |

実行:

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me npx playwright test e2e/user-search-occupation.spec.ts
```

---

## 11. 地図 view toggle + bbox query — P12-08 (#817)

### 11.1 背景

ハルナさん要望の最終形:「ユーザー検索で地図上で検索できる。 地図の上に検索欄があって、 職業がデザイナーの人を検索する」。 P12-06 (職業 model) / P12-07 (職業 filter) が揃ったので、 `/search/users` に **地図 view** を載せる。 地図上で職業 chip + bbox pan が効く。

スコープを 2 PR に分割 (500 行 guideline + review 量):

- **P12-08a (backend)**: search response に `residence` / `occupations` を追加 + `?bbox=` filter
- **P12-08b (frontend)**: `UserMapView` + `SearchViewToggle` + page 統合 + E2E

### 11.2 プライバシー設計 (最重要)

- 地図に出すのは各 user が **自分で設定した residence の円** (中心 + 半径、 min 500m)。 P12-01 で既にピンポイント漏れは防いである (DB CheckConstraint で radius ≥ 500m)。
- **中心 marker (ピン) は描かない**。 Circle (塗り) のみ。 ピンを描くと「ここに住んでいる」 と誤読されるため。 円の中心は user が粗く設定した点であって自宅ではない、 という P12-02 の設計を踏襲。
- residence 未設定 user は **地図 view から除外** (bbox filter は residence INNER JOIN)。 list view には従来通り出る。

### 11.3 API 仕様 (P12-08a)

#### search response に residence / occupations を追加

`UserFullTextSerializer` (`GET /api/v1/users/search/`) に nested field を追加:

```jsonc
{
	"user_id": "...",
	"username": "...",
	"display_name": "...",
	"bio": "...",
	"avatar_url": "...",
	"distance_km": null,
	"residence": {
		"latitude": "35.681236",
		"longitude": "139.767125",
		"radius_m": 500,
	}, // 未設定なら null
	"occupations": [{ "slug": "designer", "display_name": "デザイナー" }], // 空配列可
}
```

- `residence` は `select_related("residence")` で N+1 回避。 未設定は `null`。
- `occupations` は `prefetch_related("occupations")` で N+1 回避。 map の Circle 配色 + popup chip 用。
- list view (既存) はこの 2 field を無視するだけ。 後方互換。

#### `?bbox=south,west,north,east` filter

> **privacy 判断 (council 2026-05)**: bbox は「矩形内の全 user の residence を一括取得」 する
> **地理的総ざらい列挙**。 個々の円は 500m で粗いが、 occupation filter + 矩形 sweep で
> 「この界隈の designer を全部出す」 ができてしまう。 anon の drive-by / scraper sweep を
> 防ぐため、 **bbox は near_me と同様 auth 必須** にする (occupation/text 検索は anon のまま)。
> 「profile で公開済」 ≠ 「地図で sweep 列挙可」。

| query                              | 意味                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `bbox=sw_lat,sw_lng,ne_lat,ne_lng` | residence center が矩形内の user のみ。 **auth 必須** (anon は 401)     |
| `occupation` との併用              | AND (bbox 内 **かつ** その職業)                                         |
| `q` との併用                       | AND                                                                     |
| `near_me` / `near` との併用        | **near 系を優先** (bbox は無視)。 両方 distance/矩形 は UX 上両立しない |

ルール:

- **auth check を最優先**: anon が bbox を付けたら parse 前に **401** (near_me と一貫)。
- 4 値 comma 区切り、 各 float、 `south ≤ north` / 緯度 ∈ [-90,90] / 経度 ∈ [-180,180]。 不正は **400**。
- 経度の日付変更線跨ぎ (west > east) は MVP では非対応 (400 でなく east<west も許容し単純 `BETWEEN`、 跨ぎは結果 0 でよい)。 → シンプルに `latitude BETWEEN south AND north AND longitude BETWEEN west AND east`。
- residence INNER JOIN (lat/lng の範囲 lookup が自動で INNER JOIN するので未設定 user は除外)、 self 除外は near と異なり **しない** (bbox は自分も地図に出てよい)。
- `bbox` 単独 (q / near / occupation 無し) でも検索成立 (ただし auth 済み)。
- 並びは `username` (距離概念が無いので proximity paginator は使わない)。
- 結果上限の注意: bbox が広いと大量 hit しうる。 pagination (cursor, page_size=20) はそのまま効く。 frontend は「50 件超なら zoom in 促し」 を出すが、 **backend は通常 pagination で返す** (count を別途返さず、 frontend は 1 page 目 + `next` 有無で「多すぎ」 を判定)。

### 11.4 frontend 設計 (P12-08b)

- **`SearchViewToggle.tsx`**: list ↔ map の切替。 `role=switch` ではなく **2 つの `role=tab` / もしくは aria-pressed の toggle button 2 個** が素直 (#824 の議論を踏まえ button + `aria-pressed`)。 `?view=map` / `?view=list` (default list) を URL 同期。 keyboard 操作可。

  > **scope 判断 (council 2026-05)**: **pan-to-update (地図 pan/zoom → `?bbox=` 再取得) は P12-08b では作らない**。
  > MVP は「occupation chip で絞る → 該当 user の residence 円を地図に出す → tap でプロフィール」。
  > 地図は**現在の検索結果 (text/occupation filter) を別レンダリングしたもの**で、 anon のまま動く
  > (= owner 要望「地図で designer を探す」 を満たす)。 pan で矩形を sweep する「この area を検索」 機能は
  > bbox endpoint (auth 必須) を使う **follow-up issue** に切り出す (debounce/race の複雑さ + privacy の
  > sweep 面を分離)。 PR A の bbox endpoint は follow-up までは dormant (auth-gated)。

- **`UserMapView.tsx`** (`next/dynamic` + `ssr:false`、 Leaflet):
  - 描画対象は**現在の検索結果**(occupation/text filter 済み) のうち residence を持つ user。 bbox は使わない。
  - 地図中心 / zoom は描画する円に **auto-fit** (`fitBounds`)。 結果 0 なら東京駅 default + 空 state 文言。
  - 各 user の residence を `Circle` で描画。 配色は先頭 occupation の slug→色 (固定 palette、 無職業は neutral gray)。 **中心 marker は描かない** (§11.2)。
  - Circle click → popup (display_name / @handle / occupation chip / 「プロフィールを見る」 link)。 ESC で閉じる。
  - 職業 chip filter (`OccupationFilter`) は list/map 共通で上部に出す → map でも Circle が増減。
- **`SearchViewToggle.tsx`**: list ↔ map の切替。 `aria-pressed` の toggle button 2 個。 `?view=map` / `?view=list` (default list) を URL 同期、 keyboard 操作可。
- **a11y**: 地図は keyboard-only user に厳しいので **list view を常に並存** (toggle で戻れる)。 map view でも「一覧で見る」 link を出す (dead-end 回避)。
- **TileLayer (`map/MapTileLayer.tsx` で集約)**: OSM 標準 URL を **env var (`NEXT_PUBLIC_MAP_TILE_URL` / attribution) で差し替え可能**にして 1 箇所に集約する (council 全員一致 — prod で OSM 規約に当たる前に MapTiler/Protomaps 等へ env 変更だけで swap できる seam を今作る)。 既存 `ResidenceCircleMap` のインライン URL も将来この集約に寄せる (本 PR では新規 map view のみ)。

### 11.5 OSM タイル使用ポリシー

OSM 公式タイルは production heavy traffic で規約違反になりうる。 MVP / stg は OSM 標準で OK。 prod DAU 増加時に Carto / Stadia / 自前 tile server に切替 (follow-up issue)。

### 11.6 テスト

#### backend pytest — `apps/users/tests/test_user_search_bbox.py` (P12-08a)

| case                                      | 期待                                                    |
| ----------------------------------------- | ------------------------------------------------------- |
| anon の `?bbox=`                          | **401** (auth 必須、 sweep 列挙の privacy 防御)         |
| (auth) `?bbox=` 内の residence user のみ  | 矩形内 user が出る、 矩形外は出ない                     |
| (auth) residence 未設定 user は除外       | 未設定は結果に出ない                                    |
| (auth) `?bbox=...&occupation=designer`    | bbox 内 AND designer                                    |
| (auth) 不正 bbox (3値/非数値/範囲外/反転) | 400                                                     |
| `?bbox=` + `?near_me=1`                   | near_me 優先 (bbox 無視、 distance 順)                  |
| response に residence / occupations 含む  | residence={lat,lng,radius_m} or null、 occupations 配列 |
| residence の N+1 が無い                   | `django_assert_max_num_queries` で query 数を bound     |

#### frontend vitest (P12-08b)

- `SearchViewToggle`: list/map click で `?view=` 同期、 `aria-pressed` 反映
- `userSearch.ts`: `bbox` / `view` を query に織り込む (buildUserSearchParams 拡張)
- `UserMapView`: react-leaflet を mock し、 residence ありの user 数だけ Circle、 未設定は描かない、 occupation 配色

#### E2E — `client/e2e/user-search-map.spec.ts` (P12-08b)

| ID    | 誰が | 何をする                                    | 何が見える                                     |
| ----- | ---- | ------------------------------------------- | ---------------------------------------------- |
| MAP-1 | anon | `/search/users?view=map` を開く             | `.leaflet-container` が描画される              |
| MAP-2 | anon | list ↔ map toggle を keyboard で操作       | `?view=map` / `?view=list` が URL 同期         |
| MAP-3 | anon | map view で職業 chip を選ぶ                 | `?occupation=` + `view=map` 維持、 Circle 増減 |
| MAP-4 | anon | 地図 view から「一覧で見る」 で list へ戻る | list view に戻れる (dead-end 無し)             |

実行:

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me npx playwright test e2e/user-search-map.spec.ts
```
