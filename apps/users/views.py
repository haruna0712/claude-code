import logging

from django.conf import settings
from djoser.social.views import ProviderAuthView
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

logger = logging.getLogger(__name__)


def set_auth_cookies(
    response: Response, access_token: str, refresh_token: str | None = None
) -> None:
    access_token_lifetime = settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"].total_seconds()
    cookie_settings = {
        "path": settings.COOKIE_PATH,
        "secure": settings.COOKIE_SECURE,
        "httponly": settings.COOKIE_HTTPONLY,
        "samesite": settings.COOKIE_SAMESITE,
        "max_age": access_token_lifetime,
    }
    response.set_cookie(settings.COOKIE_NAME, access_token, **cookie_settings)

    if refresh_token:
        refresh_token_lifetime = settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()
        refresh_cookie_settings = cookie_settings.copy()
        refresh_cookie_settings["max_age"] = refresh_token_lifetime
        response.set_cookie(
            settings.REFRESH_COOKIE_NAME,
            refresh_token,
            **refresh_cookie_settings,
        )

    logged_in_cookie_settings = cookie_settings.copy()
    logged_in_cookie_settings["httponly"] = False
    response.set_cookie("logged_in", "true", **logged_in_cookie_settings)


class CustomTokenObtainPairView(TokenObtainPairView):
    def post(self, request: Request, *args, **kwargs) -> Response:
        token_res = super().post(request, *args, **kwargs)

        if token_res.status_code == status.HTTP_200_OK:
            access_token = token_res.data.get("access")
            refresh_token = token_res.data.get("refresh")

            if access_token and refresh_token:
                set_auth_cookies(
                    token_res,
                    access_token=access_token,
                    refresh_token=refresh_token,
                )

                token_res.data.pop("access", None)
                token_res.data.pop("refresh", None)

                token_res.data["message"] = "Login Successful."
            else:
                token_res.data["message"] = "Login Failed"
                logger.error("Access or refresh token not found in login response data")

        return token_res


class CustomTokenRefreshView(TokenRefreshView):
    def post(self, request: Request, *args, **kwargs) -> Response:
        refresh_token = request.COOKIES.get("refresh")

        if refresh_token:
            request.data["refresh"] = refresh_token

        refresh_res = super().post(request, *args, **kwargs)

        if refresh_res.status_code == status.HTTP_200_OK:
            access_token = refresh_res.data.get("access")
            refresh_token = refresh_res.data.get("refresh")

            if access_token and refresh_token:
                set_auth_cookies(
                    refresh_res,
                    access_token=access_token,
                    refresh_token=refresh_token,
                )

                refresh_res.data.pop("access", None)
                refresh_res.data.pop("refresh", None)

                refresh_res.data["message"] = "Access tokens refreshed successfully"
            else:
                refresh_res.data["message"] = (
                    "Access or refresh tokens not found in refresh response data"
                )
                logger.error("Access or refresh token not found in refresh response data")

        return refresh_res


class CustomProviderAuthView(ProviderAuthView):
    def post(self, request: Request, *args, **kwargs) -> Response:
        provider_res = super().post(request, *args, **kwargs)

        if provider_res.status_code == status.HTTP_201_CREATED:
            access_token = provider_res.data.get("access")
            refresh_token = provider_res.data.get("refresh")

            if access_token and refresh_token:
                set_auth_cookies(
                    provider_res,
                    access_token=access_token,
                    refresh_token=refresh_token,
                )

                provider_res.data.pop("access", None)
                provider_res.data.pop("refresh", None)

                provider_res.data["message"] = "You are logged in Successful."
            else:
                provider_res.data["message"] = (
                    "Access or refresh token not found in provider response"
                )
                logger.error("Access or refresh token not found in provider response data")

        return provider_res


class LogoutAPIView(APIView):
    def post(self, request: Request, *args, **kwargs):
        response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie("access")
        response.delete_cookie("refresh")
        response.delete_cookie("logged_in")
        return response


# ---------------------------------------------------------------------------
# P1-12a: HttpOnly Cookie 専用の login / refresh / logout (ADR-0003 準拠)
#
# security-reviewer (PR #83 HIGH) 指摘:
#   djoser の /users/activation/ は email 経由のリンクから叩かれる可能性があり、
#   activation endpoint 自体で JWT を発行すると CSRF / メール転送でログイン状態を
#   奪取できるリスクがある。よって activation と login は明示的に分け、login は
#   必ず email + password (+ CSRF token) の POST で行うフローとする。
#
# 既存の CustomTokenObtainPairView / CustomTokenRefreshView / LogoutAPIView は
# ADR-0003 移行期間中の互換目的で残すが、新しい frontend / 試験はこちらを使う。
# ---------------------------------------------------------------------------


class CookieTokenObtainView(TokenObtainPairView):
    """email + password で Cookie に JWT を載せる login view.

    レスポンス body に access/refresh を含めない (JS から JWT を読めないようにする)。
    """

    def post(self, request: Request, *args, **kwargs) -> Response:
        token_res = super().post(request, *args, **kwargs)

        if token_res.status_code != status.HTTP_200_OK:
            return token_res

        access_token = token_res.data.get("access")
        refresh_token = token_res.data.get("refresh")

        if not (access_token and refresh_token):
            logger.error("Access or refresh token not found in login response data")
            return token_res

        response = Response(
            {"detail": "Login successful"},
            status=status.HTTP_200_OK,
        )
        set_auth_cookies(
            response,
            access_token=access_token,
            refresh_token=refresh_token,
        )
        return response


class CookieTokenRefreshView(TokenRefreshView):
    """Cookie から refresh token を読み、ローテ後の新 access/refresh を Cookie に再 set する.

    `ROTATE_REFRESH_TOKENS=True` + `BLACKLIST_AFTER_ROTATION=True` なので、旧 refresh は
    blacklist に追加され再利用不可。
    """

    def post(self, request: Request, *args, **kwargs) -> Response:
        refresh_token = request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
        if refresh_token:
            # simplejwt の parent view は request.data から refresh を読む。
            request.data["refresh"] = refresh_token

        refresh_res = super().post(request, *args, **kwargs)

        if refresh_res.status_code != status.HTTP_200_OK:
            return refresh_res

        access_token = refresh_res.data.get("access")
        new_refresh_token = refresh_res.data.get("refresh")

        if not access_token:
            logger.error("Access token not found in refresh response data")
            return refresh_res

        response = Response(
            {"detail": "Token refreshed"},
            status=status.HTTP_200_OK,
        )
        set_auth_cookies(
            response,
            access_token=access_token,
            refresh_token=new_refresh_token,
        )
        return response


class LogoutView(APIView):
    """認証済みユーザーのみ logout を許可し、refresh を blacklist に登録する.

    - permission_classes = [IsAuthenticated]: 未ログイン状態でログアウトを叩くのは
      操作として無意味、かつ refresh cookie が偽物だった場合は blacklist 処理が
      不要 (むしろ攻撃ベクタになり得る) ため。
    - Cookie は max_age=0 で削除。
    - refresh は blacklist に追加 (rotation 以降の再利用も防ぐ)。
    """

    permission_classes = [IsAuthenticated]

    def post(self, request: Request, *args, **kwargs) -> Response:
        refresh_token = request.COOKIES.get(settings.REFRESH_COOKIE_NAME)

        if refresh_token:
            try:
                token = RefreshToken(refresh_token)
                token.blacklist()
            except TokenError as exc:
                # 期限切れ / 不正 token は既にログアウト相当なので握り潰さず warn に留める。
                logger.warning("Logout called with invalid refresh token: %s", exc)

        response = Response(
            {"detail": "Logged out"},
            status=status.HTTP_200_OK,
        )
        response.delete_cookie(settings.COOKIE_NAME, path=settings.COOKIE_PATH)
        response.delete_cookie(settings.REFRESH_COOKIE_NAME, path=settings.COOKIE_PATH)
        response.delete_cookie("logged_in", path=settings.COOKIE_PATH)
        return response
