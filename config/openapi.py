"""drf-yasg の `openapi.Info` を module-level に切り出す.

`generate_swagger` management command が `SWAGGER_SETTINGS["DEFAULT_INFO"]` を
import string として要求するため、`config.openapi.api_info` のように import 可能な
場所に置く。`config/urls.py` の `schema_view` も本オブジェクトを参照する。

Frontend (`client/`) はこの schema を openapi-typescript に流して
`client/src/types/api.generated.ts` を生成する。再生成は
`cd client && npm run gen:api-types`。
"""

from drf_yasg import openapi

api_info = openapi.Info(
    title="Alpha Apartments API",
    default_version="v1",
    description="エンジニア向け SNS API (Phase 3 時点)。Frontend codegen の source。",
    contact=openapi.Contact(email="api.imperfect@gmail.com"),
    license=openapi.License(name="MIT License"),
)
