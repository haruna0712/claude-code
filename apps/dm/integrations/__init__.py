"""Phase 4 (Notifications / Moderation) との疎結合インターフェース層.

Phase 3 の DM 機能は Phase 4A (通知) / Phase 4B (Block/Mute) より前に出荷される。
両 Phase が未実装の段階で DM Consumer / API が呼び出せるよう、本 package に
**no-op スタブ**を置き、Phase 4 着手時に中身を差し替えるだけで結線が完了する設計とする。

差し替え手順は ``docs/operations/phase-3-stub-bridges.md`` を参照。
"""
