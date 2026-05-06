# 掲示板 E2E 実行コマンド

> シナリオ: [boards-scenarios.md](./boards-scenarios.md)
> Spec: [boards-spec.md](./boards-spec.md)
> Playwright spec: `client/e2e/boards-scenarios.spec.ts`

---

## 環境変数

```bash
# stg を叩くとき
export PLAYWRIGHT_BASE_URL=https://stg.codeplace.me
export PLAYWRIGHT_USER1_EMAIL=test1@gmail.com
export PLAYWRIGHT_USER1_PASSWORD=<test1_password>
export PLAYWRIGHT_USER1_HANDLE=test1
export PLAYWRIGHT_USER2_EMAIL=test2@gmail.com
export PLAYWRIGHT_USER2_PASSWORD=<test2_password>
export PLAYWRIGHT_USER2_HANDLE=test2

# ローカルを叩くとき
export PLAYWRIGHT_BASE_URL=http://localhost:8080
```

ローカルでは下記 fixture を migrate / seed:

```bash
docker compose -f local.yml exec api python manage.py migrate
docker compose -f local.yml exec api python manage.py shell -c "
from apps.boards.models import Board
Board.objects.get_or_create(slug='django', defaults={'name':'Django','description':'Django talk','order':1,'color':'#0c4b33'})
Board.objects.get_or_create(slug='nextjs', defaults={'name':'Next.js','description':'Next.js talk','order':2,'color':'#000000'})
"
# テスト用 user 2 名 (既存の register API で作成、または fixture を使用)
```

---

## ローカル E2E (推奨)

```bash
cd /workspace/client
npx playwright test e2e/boards-scenarios.spec.ts --workers=1
```

`--workers=1` は spec 内でグローバル状態 (スレ作成 / 削除) を扱うため必須。

---

## stg を叩く E2E (本番ドメインを直接)

```bash
cd /workspace/client
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
  npx playwright test e2e/boards-scenarios.spec.ts --workers=1
```

---

## 個別シナリオ実行

```bash
# golden path: 板閲覧 → スレ作成 → レス → メンション (S-01〜S-05, S-08)
npx playwright test e2e/boards-scenarios.spec.ts --grep "BO-(01|02|03|04|05|08)"

# 境界 (990 / 1000)
npx playwright test e2e/boards-scenarios.spec.ts --grep "BO-(06|07)"

# 削除系
npx playwright test e2e/boards-scenarios.spec.ts --grep "BO-(09|10|11)"

# レートリミット (CI で flaky になりやすいので分離)
npx playwright test e2e/boards-scenarios.spec.ts --grep "BO-(13|14)"
```

---

## デバッグ (UI 表示 + step 実行)

```bash
npx playwright test e2e/boards-scenarios.spec.ts --debug
```

---

## API 単体での確認 (Playwright を使わずに)

```bash
BASE=http://localhost:8080
# 1. CSRF 取得
curl -c /tmp/cookies1.txt -b /tmp/cookies1.txt $BASE/api/v1/auth/csrf/ > /dev/null

# 2. login (test1)
CSRF=$(grep csrftoken /tmp/cookies1.txt | awk '{print $7}')
curl -X POST -c /tmp/cookies1.txt -b /tmp/cookies1.txt \
  -H "Content-Type: application/json" -H "X-CSRFToken: $CSRF" \
  -H "Referer: $BASE/" \
  -d '{"email":"test1@gmail.com","password":"<test1_password>"}' \
  $BASE/api/v1/auth/jwt/create/

# 3. 板一覧 (匿名 OK)
curl $BASE/api/v1/boards/

# 4. スレ作成
curl -X POST -c /tmp/cookies1.txt -b /tmp/cookies1.txt \
  -H "Content-Type: application/json" -H "X-CSRFToken: $CSRF" \
  -H "Referer: $BASE/" \
  -d '{"title":"テストスレ","first_post_body":"立てました"}' \
  $BASE/api/v1/boards/django/threads/

# 5. レス投稿 (THREAD_ID は 4 のレスポンスから)
curl -X POST -c /tmp/cookies1.txt -b /tmp/cookies1.txt \
  -H "Content-Type: application/json" -H "X-CSRFToken: $CSRF" \
  -H "Referer: $BASE/" \
  -d '{"body":"@test2 hey"}' \
  $BASE/api/v1/threads/<THREAD_ID>/posts/

# 6. test2 として通知確認 (別 cookie jar)
curl -b /tmp/cookies2.txt $BASE/api/v1/notifications/?unread_only=true | jq '.results[] | select(.kind=="mention")'

# 7. レス削除 (本人のみ可)
curl -X DELETE -b /tmp/cookies1.txt -H "X-CSRFToken: $CSRF" \
  -H "Referer: $BASE/" \
  $BASE/api/v1/posts/<POST_ID>/
```

---

## 990 / 1000 境界の seed 投入 (E2E 前準備)

```bash
docker compose -f local.yml exec api python manage.py shell -c "
from apps.boards.models import Board, Thread
from apps.boards.services import append_post
from django.contrib.auth import get_user_model
from django.utils import timezone

User = get_user_model()
admin = User.objects.filter(is_staff=True).first()
board = Board.objects.get(slug='django')
thread = Thread.objects.create(
    board=board, author=admin, title='境界テスト用',
    post_count=0, last_post_at=timezone.now(), locked=False,
)
# 989 件 seed (990 番目以降を実 E2E で投入させて警告 / lock を確認)
for i in range(989):
    append_post(thread, admin, f'seed {i+1}', images=())
print('thread_id =', thread.id, 'post_count =', thread.post_count)
"
```

---

## CI での運用 (将来)

GitHub Actions の workflow `e2e-stg.yml` に追加し、stg secrets を OIDC 経由で注入。本 Phase では手動実行のみとする。
