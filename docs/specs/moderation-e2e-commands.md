# モデレーション E2E 実行コマンド

> シナリオ: [moderation-scenarios.md](./moderation-scenarios.md)
> Spec: [moderation-spec.md](./moderation-spec.md)
> Playwright spec: `client/e2e/moderation-scenarios.spec.ts`

---

## 環境変数

```bash
# stg (推奨)
export PLAYWRIGHT_BASE_URL=https://stg.codeplace.me
# ローカル
# export PLAYWRIGHT_BASE_URL=http://localhost:8080

export PLAYWRIGHT_USER1_EMAIL=alice@example.com
export PLAYWRIGHT_USER1_PASSWORD=<test1_password>
export PLAYWRIGHT_USER1_HANDLE=alice
export PLAYWRIGHT_USER2_EMAIL=bob@example.com
export PLAYWRIGHT_USER2_PASSWORD=<test2_password>
export PLAYWRIGHT_USER2_HANDLE=bob
```

## ローカル / stg 共通実行

```bash
cd /workspace/client
npx playwright test e2e/moderation-scenarios.spec.ts --workers=1
```

`--workers=1` は spec 内でグローバル状態 (Block / Mute) を扱うため必須。

## 個別シナリオ実行

```bash
# Block 系
npx playwright test e2e/moderation-scenarios.spec.ts --grep "B-0"

# Mute 系
npx playwright test e2e/moderation-scenarios.spec.ts --grep "M-0"

# Report 系
npx playwright test e2e/moderation-scenarios.spec.ts --grep "R-0"

# UI / a11y 系
npx playwright test e2e/moderation-scenarios.spec.ts --grep "U-0"
```

## API 単体での確認 (Playwright を使わずに)

```bash
BASE=https://stg.codeplace.me
# 1. CSRF + alice login
rm -f /tmp/c1.txt
curl -sS -c /tmp/c1.txt $BASE/api/v1/auth/csrf/ -o /dev/null
CSRF=$(grep csrftoken /tmp/c1.txt | awk '{print $7}')
curl -sS -c /tmp/c1.txt -b /tmp/c1.txt -X POST \
  -H "Content-Type: application/json" -H "X-CSRFToken: $CSRF" \
  -H "Referer: $BASE/login" \
  -d "{\"email\":\"alice@example.com\",\"password\":\"$PLAYWRIGHT_USER1_PASSWORD\"}" \
  $BASE/api/v1/auth/cookie/create/

# 2. ブロック
CSRF=$(grep csrftoken /tmp/c1.txt | awk '{print $7}')
curl -sS -c /tmp/c1.txt -b /tmp/c1.txt -X POST \
  -H "Content-Type: application/json" -H "X-CSRFToken: $CSRF" \
  -H "Referer: $BASE/" \
  -d '{"target_handle":"bob"}' \
  $BASE/api/v1/moderation/blocks/

# 3. ブロック一覧
curl -sS -b /tmp/c1.txt $BASE/api/v1/moderation/blocks/ | python3 -m json.tool

# 4. ブロック解除
curl -sS -b /tmp/c1.txt -X DELETE \
  -H "X-CSRFToken: $CSRF" -H "Referer: $BASE/" \
  $BASE/api/v1/moderation/blocks/bob/ -w "%{http_code}\n"

# 5. ミュート
curl -sS -c /tmp/c1.txt -b /tmp/c1.txt -X POST \
  -H "Content-Type: application/json" -H "X-CSRFToken: $CSRF" \
  -H "Referer: $BASE/" \
  -d '{"target_handle":"bob"}' \
  $BASE/api/v1/moderation/mutes/

# 6. ミュート一覧
curl -sS -b /tmp/c1.txt $BASE/api/v1/moderation/mutes/ | python3 -m json.tool

# 7. 通報
curl -sS -b /tmp/c1.txt -X POST \
  -H "Content-Type: application/json" -H "X-CSRFToken: $CSRF" \
  -H "Referer: $BASE/" \
  -d '{"target_type":"tweet","target_id":"1","reason":"spam","note":"test"}' \
  $BASE/api/v1/moderation/reports/

# 8. (admin) 通報一覧
# Django admin で /admin/moderation/report/ を開く
```

## 検証用テストデータ生成 (ECS run-task 経由 stg)

```bash
aws ecs run-task --cluster sns-stg-cluster \
  --task-definition sns-stg-django-migrate \
  --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-08a506157dcf3ab3f,subnet-09a7cc6860afa62ce],securityGroups=[sg-0aba93917efca98ec],assignPublicIp=DISABLED}' \
  --overrides '{
    "containerOverrides": [{
      "name": "django",
      "command": ["python", "manage.py", "shell", "-c",
        "from django.contrib.auth import get_user_model; U=get_user_model(); a=U.objects.get(username='\''alice'\''); b=U.objects.get(username='\''bob'\''); print('\''alice id:'\'', a.id); print('\''bob id:'\'', b.id)"
      ]
    }]
  }'
```

## CI での運用 (将来)

GitHub Actions の workflow `e2e-stg.yml` に追加し、stg secrets を OIDC 経由で注入。本 Phase では手動実行のみ。
