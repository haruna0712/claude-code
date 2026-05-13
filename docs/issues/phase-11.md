# Phase 11: メンターマッチング Issue ドラフト

> 関連 spec: [docs/specs/phase-11-mentor-board-spec.md](../specs/phase-11-mentor-board-spec.md)
> milestone: `Phase 11: メンターマッチング`
>
> 全 26 Issue、 合計 ~6000 行規模。 1 Issue = 1 PR、 500 行以内目安。
> **11-A (P11-01〜P11-10) 単独で stg リリース可能**。 11-B 以降は並行 / 後追い。

---

## 11-A: 募集 board (最小 MVP、 10 Issue)

- [ ] **P11-01 [feature][mentorship][backend] apps/mentorship app scaffold + 基底 model 配線**

  - 受け入れ基準: `apps/mentorship/{models,admin,apps,views,urls,serializers,tests}.py` ファイル新設、 INSTALLED_APPS 登録、 空 migration が走る、 既存テスト緑
  - 依存: なし
  - 推定行数: ~200

- [ ] **P11-02 [feature][mentorship][backend] MentorRequest model + admin + migration**

  - 受け入れ基準: model + Status choices + indexes + admin、 pytest で create / unique / status 遷移
  - 依存: P11-01
  - 推定行数: ~250

- [ ] **P11-03 [feature][mentorship][backend] MentorRequest CRUD API (anon GET / owner PATCH)**

  - 受け入れ基準: `/api/v1/mentor/requests/` viewset、 anon list / detail、 auth create / PATCH / DELETE、 owner only、 cursor pagination、 pytest 15+
  - 依存: P11-02
  - 推定行数: ~300

- [ ] **P11-04 [feature][mentorship][backend] MentorProposal model + 投稿 API**

  - 受け入れ基準: model + unique (request, mentor)、 self-proposal 禁止は serializer validate、 `POST /requests/<id>/proposals/`、 pytest 10+
  - 依存: P11-02
  - 推定行数: ~280

- [ ] **P11-05 [feature][mentorship][backend] accept proposal → MentorshipContract + DMRoom**

  - 受け入れ基準: `MentorshipContract` model + service `accept_proposal()` atomic、 既存 `apps.dm.services.create_direct_room()` に MENTORSHIP kind 対応 (kind 引数で分岐)、 pytest 12+ (冪等、 self-accept reject、 既 matched で reject)
  - 依存: P11-04 + apps/dm.DMRoom.Kind 拡張 (本 PR で実施)
  - 推定行数: ~400

- [ ] **P11-06 [feature][mentorship][frontend] /mentor/wanted 一覧 (anon 可) + /mentor/wanted/new**

  - 受け入れ基準: SSR で list fetch、 sticky header「募集を出す」 CTA (auth のみ)、 anon でも 200、 LeftNav に link 追加 (3 click 以内到達)
  - 依存: P11-03
  - 推定行数: ~350

- [ ] **P11-07 [feature][mentorship][frontend] /mentor/wanted/<id> 詳細 + proposal form + accept button**

  - 受け入れ基準: anon は本文のみ可視、 mentor は proposal 投稿 form、 owner は proposal list + accept button、 accept 成功で /messages にトースト遷移
  - 依存: P11-05
  - 推定行数: ~400

- [ ] **P11-08 [feature][mentorship][backend][frontend] DMRoom.Kind.MENTORSHIP + RoomChat banner**

  - 受け入れ基準: backend `DMRoom.Kind.MENTORSHIP` migration、 frontend RoomChat header に「メンタリング契約中」 バナー、 既存 DM テスト緑
  - 依存: P11-05
  - 推定行数: ~150

- [ ] **P11-09 [test][mentorship] Playwright E2E mentor-board.spec.ts (golden path)**

  - 受け入れ基準: stg で test2 投稿 → test3 提案 → test2 accept → room 開く まで 1/1 GREEN、 spec §9.3 シナリオ 1 をコード化
  - 依存: P11-06 + P11-07 + P11-08
  - 推定行数: ~200

- [ ] **P11-10 [docs][mentorship] mentor 募集 spec / scenarios / e2e-commands**
  - 受け入れ基準: `docs/specs/mentor-board-{spec,scenarios,e2e-commands}.md` 3 ファイル、 本 phase-11 spec から派生
  - 依存: P11-09
  - 推定行数: ~250

---

## 11-B: mentor profile + plan + 検索 (6 Issue)

- [ ] **P11-11 [feature][mentorship][backend] MentorProfile model + auto-create + admin**

  - 推定行数: ~200
  - 依存: P11-01

- [ ] **P11-12 [feature][mentorship][backend] MentorPlan model + nested API**

  - 推定行数: ~250
  - 依存: P11-11

- [ ] **P11-13 [feature][mentorship][backend] /mentors/ 検索 API + skill filter**

  - 推定行数: ~280
  - 依存: P11-12

- [ ] **P11-14 [feature][mentorship][frontend] /mentors 検索 + /mentors/<handle> 詳細**

  - 推定行数: ~400
  - 依存: P11-13

- [ ] **P11-15 [feature][mentorship][frontend] /mentors/me/edit (profile + plans 編集)**

  - 推定行数: ~350
  - 依存: P11-14

- [ ] **P11-16 [feature][mentorship][frontend] /u/<handle>?tab=mentor embed**
  - 推定行数: ~150
  - 依存: P11-14

---

## 11-C: contract + DMRoom 統合 (3 Issue)

- [ ] **P11-17 [feature][mentorship][backend] MentorshipContract complete / cancel API**

  - 推定行数: ~250
  - 依存: P11-05

- [ ] **P11-18 [feature][mentorship][frontend] /mentor/contracts/me + /mentor/contracts/<id>**

  - 推定行数: ~400
  - 依存: P11-17

- [ ] **P11-19 [feature][mentorship][frontend] RoomChat 完了時 read-only UI (kind=mentorship + is_archived)**
  - 推定行数: ~200
  - 依存: P11-17 + P11-08

---

## 11-D: review (3 Issue)

- [ ] **P11-20 [feature][mentorship][backend] MentorReview model + API + 集計 (avg_rating)**

  - 推定行数: ~300
  - 依存: P11-17

- [ ] **P11-21 [feature][mentorship][frontend] review form (契約完了後のみ表示) + mentor profile に表示**

  - 推定行数: ~350
  - 依存: P11-20 + P11-18

- [ ] **P11-22 [test][mentorship] Playwright E2E mentor-review.spec.ts**
  - 推定行数: ~200
  - 依存: P11-21

---

## 11-F: skill filter (1 Issue)

- [ ] **P11-23 [feature][mentorship][frontend] /mentor/wanted + /mentors の skill タグ filter UI**
  - 推定行数: ~250
  - 依存: P11-06 + P11-14

---

## 全体 (3 Issue)

- [ ] **P11-24 [chore][mentorship] Celery beat: mentor_request.expire (30 日 auto-expire)**

  - 推定行数: ~100
  - 依存: P11-02

- [ ] **P11-25 [chore][moderation] Report.Target に mentor_request / mentor_proposal / mentor_review 追加**

  - 推定行数: ~80
  - 依存: P11-02 + P11-04 + P11-20

- [ ] **P11-26 [docs][roadmap] ROADMAP.md に Phase 11 行追加 + 各 sub-phase 完了反映**
  - 推定行数: ~50
  - 依存: なし (随時更新)
