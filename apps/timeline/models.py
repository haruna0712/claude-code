"""apps.timeline は永続モデルを持たない (P2-08).

Tweet / Follow / Reaction / Block を read-only で参照し、Redis を主キャッシュ
として fan-out-on-read を提供するサービス層。空 module を残しておくのは Django
が migration を期待しないことを明示するため。
"""
