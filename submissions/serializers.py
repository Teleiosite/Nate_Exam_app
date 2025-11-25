
from rest_framework import serializers
from .models import ExamAssignment, StudentResponse, SuspiciousActivity, AuditLog
from accounts.serializers import CustomUserSerializer
from exams.serializers import ExamDetailSerializer

class StudentResponseSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentResponse
        fields = ('id', 'exam_assignment', 'question', 'answer_text', 'answer_options', 'is_answered', 'auto_score', 'manual_score')

class ExamAssignmentSerializer(serializers.ModelSerializer):
    student = CustomUserSerializer(read_only=True)
    exam = ExamDetailSerializer(read_only=True)
    responses = StudentResponseSerializer(many=True, read_only=True)

    class Meta:
        model = ExamAssignment
        fields = ('id', 'student', 'exam', 'started_at', 'submitted_at', 'score', 'status', 'responses', 'time_taken_seconds', 'retake_count')

class SuspiciousActivitySerializer(serializers.ModelSerializer):
    assignment = ExamAssignmentSerializer(read_only=True)

    class Meta:
        model = SuspiciousActivity
        fields = ('id', 'assignment', 'activity_type', 'timestamp', 'metadata', 'severity')

class SuspiciousActivityCreateSerializer(serializers.ModelSerializer):
    assignment_id = serializers.UUIDField()

    class Meta:
        model = SuspiciousActivity
        fields = ('assignment_id', 'activity_type', 'metadata', 'severity')


class AuditLogSerializer(serializers.ModelSerializer):
    user = CustomUserSerializer(read_only=True)

    class Meta:
        model = AuditLog
        fields = '__all__'
