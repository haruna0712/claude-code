"""URL routing for /api/v1/mentor/... endpoints.

P11-01: 空 router。 endpoint は後続 Issue で追加。
"""

from rest_framework.routers import DefaultRouter

router = DefaultRouter()
# Future:
# router.register(r"requests", MentorRequestViewSet, basename="mentor-request")
# router.register(r"proposals", MentorProposalViewSet, basename="mentor-proposal")
# router.register(r"contracts", MentorshipContractViewSet, basename="mentor-contract")
# (P11-13 で /mentors/ は別 prefix で config/urls.py 直接 register)

urlpatterns = router.urls
