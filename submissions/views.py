from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import ExamAssignment, StudentResponse, SuspiciousActivity
from .serializers import (ExamAssignmentSerializer, StudentResponseSerializer, 
                          SuspiciousActivitySerializer, SuspiciousActivityCreateSerializer)
from .services import ExamAssignmentService

class ExamAssignmentViewSet(viewsets.ModelViewSet):
    queryset = ExamAssignment.objects.all()
    serializer_class = ExamAssignmentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'instructor':
            return ExamAssignment.objects.filter(exam__instructor=user)
        elif user.role == 'student':
            return ExamAssignment.objects.filter(student=user)
        return ExamAssignment.objects.none()

    @action(detail=False, methods=['post'], url_path='start_exam')
    def start_exam(self, request):
        exam_id = request.data.get('exam_id')
        if not exam_id:
            return Response({'error': 'exam_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            assignment = ExamAssignmentService.start_exam(exam_id, request.user.id)
            serializer = self.get_serializer(assignment)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='submit_answer')
    def submit_answer(self, request, pk=None):
        assignment = self.get_object()
        question_id = request.data.get('question_id')
        answer_data = request.data
        
        try:
            response = ExamAssignmentService.submit_answer(assignment.id, question_id, request.user.id, answer_data)
            return Response(StudentResponseSerializer(response).data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='submit_exam')
    def submit_exam(self, request, pk=None):
        assignment = self.get_object()
        try:
            assignment = ExamAssignmentService.submit_exam(assignment.id, request.user.id)
            return Response(self.get_serializer(assignment).data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class StudentResponseViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = StudentResponse.objects.all()
    serializer_class = StudentResponseSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return StudentResponse.objects.filter(student=user)

class SuspiciousActivityViewSet(viewsets.ModelViewSet):
    queryset = SuspiciousActivity.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'create':
            return SuspiciousActivityCreateSerializer
        return SuspiciousActivitySerializer

    def perform_create(self, serializer):
        serializer.save(student=self.request.user)
