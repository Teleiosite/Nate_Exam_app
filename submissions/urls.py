
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ExamAssignmentViewSet, 
    StudentResponseViewSet, 
    SuspiciousActivityViewSet
)

router = DefaultRouter()
router.register(r'exam_assignments', ExamAssignmentViewSet)
router.register(r'responses', StudentResponseViewSet)
router.register(r'suspicious-activity', SuspiciousActivityViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
