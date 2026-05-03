# Frontend API 型の自動生成 (openapi-typescript + drf-spectacular)

> **対応 issue**: post-Phase 3 fix
> **背景**: Phase 3 frontend で `DMRoomMembership` 等の型を手書きで「想像形」を書いて
> 実 backend serializer (`apps/dm/serializers.py`) と乖離した結果、E2E 寸前で
> 全 PR が動かない状態になった ([learned skill: verify-api-contract-before-typing](.))。
> 同じ事故を防ぐために TypeScript 型を OpenAPI schema から自動生成する。

---

## 1. 全体像

```
Django serializer (apps/*/serializers.py)
        │
        ▼
drf-spectacular  (config.urls /api/schema/)
        │  HTTP GET → OpenAPI 3.0 YAML
        ▼
openapi-typescript (client/scripts)
        │
        ▼
client/src/types/api.generated.ts   ← 手書き禁止、自動生成
        │
        ▼
TypeScript 型として Component / RTK Query / hooks から import
```

**人間向け UI**:

- `/redoc/` (drf-yasg) — 既存ブックマーク互換、人間がブラウザで閲覧する用 (互換維持目的で残置)
- `/api/schema/swagger-ui/` (drf-spectacular) — 新しい Swagger UI、対話的試験向け
- `/api/schema/redoc/` (drf-spectacular) — drf-spectacular の redoc UI

**機械向け**:

- `/api/schema/` — OpenAPI 3.0 YAML を返す (codegen 用の正本)

---

## 2. ローカルでの再生成手順

```bash
# 1. local stack を起動
cd /workspace
docker compose -f local.yml up -d --build api

# 2. schema endpoint が応答することを確認
docker run --rm --network workspace_app_nw curlimages/curl:latest \
  -s -H "Host: localhost" http://api:8000/api/schema/ | head -3
# 期待: openapi: 3.0.3 ...

# 3. client で codegen 実行
cd client
API_SCHEMA_URL=http://localhost:8080/api/schema/ npm run gen:api-types
# → src/types/api.generated.ts を上書き + prettier
```

`API_SCHEMA_URL` 未指定なら `http://localhost:8080/api/schema/` がデフォルト。stg を
ターゲットにするなら `https://stg.codeplace.me/api/schema/` を指定。

---

## 3. 型の使い方

### 3.1 schema からの基本的な抽出

```typescript
import type { components, paths } from "@/types/api.generated";

// schema (request/response の object 型)
type DMRoom = components["schemas"]["DMRoom"];
type DMRoomMembership = components["schemas"]["DMRoomMembership"];

// 特定 endpoint の response
type ListRoomsResponse =
	paths["/api/v1/dm/rooms/"]["get"]["responses"]["200"]["content"]["application/json"];

// 特定 endpoint の request body
type CreateRoomBody =
	paths["/api/v1/dm/rooms/"]["post"]["requestBody"]["content"]["application/json"];
```

### 3.2 既存 hand-written 型からの移行

`client/src/lib/redux/features/dm/types.ts` のような既存ファイルは段階的に移行する。
新規開発は **必ず `api.generated.ts` から import** する。

```typescript
// ❌ 旧: 手書き型 (実 contract と乖離するリスク)
export interface DMRoomMembership {
  id: number;
  user_id: number;
  handle: string;
  ...
}

// ✅ 新: schema から再 export
import type { components } from "@/types/api.generated";
export type DMRoomMembership = components["schemas"]["DMRoomMembership"];
```

---

## 4. CI での drift 検知

`npm run gen:api-types:check` を CI に追加する想定 (本 PR 範囲外、フォローアップ
issue 推奨)。流れ:

1. ephemeral postgres + redis で api を起動
2. `curl http://api:8000/api/schema/ -o /tmp/schema.yaml`
3. `npx openapi-typescript /tmp/schema.yaml --output src/types/api.generated.ts`
4. `git diff --exit-code -- src/types/api.generated.ts`
5. diff があれば fail (= backend serializer が変わったが frontend が再生成してない)

CI 統合まで未実装なので、当面は **PR 投げる前にローカルで `npm run gen:api-types` を
実行してから commit する** 運用で。

---

## 5. drf-yasg と drf-spectacular の役割分担

| 用途                                      | パッケージ      | URL                       |
| ----------------------------------------- | --------------- | ------------------------- |
| 人間向け API UI (既存ブックマーク互換)    | drf-yasg        | `/redoc/`                 |
| 人間向け Swagger UI                       | drf-spectacular | `/api/schema/swagger-ui/` |
| 人間向け Redoc UI (新)                    | drf-spectacular | `/api/schema/redoc/`      |
| machine-readable OpenAPI 3.0 (codegen 用) | drf-spectacular | `/api/schema/`            |

drf-yasg は APIView (非 ViewSet) で `action_map=None` を踏んで落ちる ため、
codegen には使えない。`/redoc/` の人間向け UI のみで残置している。
将来 drf-yasg を完全撤去する場合は別 issue で:

- `/redoc/` を `/api/schema/redoc/` にリダイレクト or 移行
- `requirements/base.txt` から drf-yasg を削除
- `config/urls.py` の drf-yasg import を削除

---

## 6. トラブルシュート

### 6.1 `Incompatible AutoSchema used on View`

`REST_FRAMEWORK["DEFAULT_SCHEMA_CLASS"]` が `drf_spectacular.openapi.AutoSchema`
を指していない。`config/settings/base.py` で確認。

### 6.2 schema 生成が遅い (10s 以上)

Django app 全部 introspect するため、初回は遅い。`/api/schema/` のレスポンスは
`@cache_page` で短期キャッシュしても良い (CD pipeline では fresh が欲しいので
キャッシュなしが推奨)。

### 6.3 `'NoneType' object is not iterable` (drf-yasg)

drf-yasg は APIView の `action_map=None` を扱えない。codegen 用途では
`/api/schema/` (drf-spectacular) を使うこと。`/redoc/` の人間向け UI のみ
drf-yasg のまま OK。

---

## 7. 関連

- 教訓 (skill): `~/.claude/skills/learned/verify-api-contract-before-typing.md`
- 教訓 (skill): `~/.claude/skills/learned/reviewer-high-on-type-cast-needs-root-cause.md`
- frontend 型: `client/src/types/api.generated.ts`
- backend schema config: `config/settings/base.py` SPECTACULAR_SETTINGS
- backend URL: `config/urls.py` SpectacularAPIView
