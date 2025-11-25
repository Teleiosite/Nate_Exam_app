
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from django.utils import timezone
from .models import ExamAssignment, StudentResponse, SuspiciousActivity, AuditLog, Exam
from .serializers import (ExamAssignmentSerializer, StudentResponseSerializer, 
                          SuspiciousActivitySerializer, SuspiciousActivityCreateSerializer, AuditLogSerializer)

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

    @action(detail=False, methods=['post'], url_path='start_new')
    def start_new_exam(self, request):
        exam_id = request.data.get('exam_id')
        if not exam_id:
            return Response({'error': 'exam_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            exam = Exam.objects.get(id=exam_id)
        except Exam.DoesNotExist:
            return Response({'error': 'Exam not found'}, status=status.HTTP_404_NOT_FOUND)
            
        from .services import ExamAssignmentService
        try:
            assignment = ExamAssignmentService.start_exam(exam, request.user)
            serializer = self.get_serializer(assignment)
            return Response(serializer.data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='start')
    def start_exam(self, request, pk=None):
        # We use get_object() to ensure permission checks pass
        # But we might need to fetch the exam first if the assignment doesn't exist yet?
        # Actually, the flow is: Student requests to start an Exam. 
        # If assignment exists, resume it. If not, create it.
        # However, this ViewSet is for ExamAssignment, so it assumes assignment ID is known.
        # If the frontend calls this with an Exam ID, we need a different approach.
        # Let's assume for now the frontend creates the assignment via a POST to /assignments/ 
        # OR we change this to accept exam_id in the body.
        
        # Better approach: POST /assignments/start/ with body { exam_id: ... }
        # But since we are in detail route, we are operating on an existing assignment.
        assignment = self.get_object()
        
        from .services import ExamAssignmentService
        try:
            assignment = ExamAssignmentService.start_exam(assignment.exam, request.user)
            serializer = self.get_serializer(assignment)
            return Response(serializer.data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='submit-answer')
    def submit_answer(self, request, pk=None):
        assignment = self.get_object()
        question_id = request.data.get('question_id')
        print(f"SUBMIT ANSWER: Assignment {assignment.id}, Question {question_id}")
        print(f"Request Data: {request.data}")
        
        answer_data = {
            'answer_text': request.data.get('answer_text'),
            'answer_options': request.data.get('answer_options')
        }
        
        from .services import ExamAssignmentService
        try:
            response = ExamAssignmentService.submit_answer(assignment, question_id, answer_data)
            print(f"Answer saved. Auto score: {response.auto_score}")
            return Response({'status': 'saved', 'auto_score': response.auto_score})
        except Exception as e:
            print(f"ERROR saving answer: {e}")
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='submit')
    def submit_exam(self, request, pk=None):
        assignment = self.get_object()
        
        from .services import ExamAssignmentService
        try:
            assignment = ExamAssignmentService.submit_exam(assignment)
            return Response(self.get_serializer(assignment).data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

class StudentResponseViewSet(viewsets.ModelViewSet):
    queryset = StudentResponse.objects.all()
    serializer_class = StudentResponseSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return StudentResponse.objects.filter(assignment__student=user)

    def perform_create(self, serializer):
        serializer.save()

class SuspiciousActivityViewSet(viewsets.ModelViewSet):
    queryset = SuspiciousActivity.objects.all()
    serializer_class = SuspiciousActivitySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'create':
            return SuspiciousActivityCreateSerializer
        return SuspiciousActivitySerializer

    def perform_create(self, serializer):
        # Ensure the student matches the current user
        assignment_id = serializer.validated_data.get('assignment_id')
        try:
            assignment = ExamAssignment.objects.get(id=assignment_id)
            if assignment.student != self.request.user:
                raise ValidationError("You can only log activity for your own exams.")
            serializer.save(student=self.request.user, assignment=assignment)
        except ExamAssignment.DoesNotExist:
            raise ValidationError("Invalid assignment ID.")

class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.all().order_by('-timestamp')
    serializer_class = AuditLogSerializer
    permission_classes = [permissions.IsAdminUser]
