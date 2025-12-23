from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from accounts.models import EngineeringSpecialization
from exams.models import Exam, Question, QuestionOption
from submissions.models import ExamAssignment
from submissions.services import ExamAssignmentService

User = get_user_model()

class ExamFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        
        # Create Specialization
        self.spec = EngineeringSpecialization.objects.create(name="Computer Science Engineering", code="CSE")

        # Create Users
        self.instructor = User.objects.create_user(email='inst@test.com', password='password', first_name='Inst', role='instructor')
        self.student = User.objects.create_user(
            email='student@test.com', 
            password='password', 
            first_name='Student', 
            role='student',
            specialization=self.spec
        )
        
        # Create Exam
        self.exam = Exam.objects.create(
            title='Test Exam',
            instructor=self.instructor,
            specialization=self.spec,
            duration_minutes=60,
            total_points=10
        )
        
        # Create Question (MCQ)
        self.question = Question.objects.create(
            exam=self.exam,
            question_text='What is 2+2?',
            question_type=Question.QuestionType.MULTIPLE_CHOICE,
            points=5,
            order_index=0
        )
        self.option1 = QuestionOption.objects.create(question=self.question, option_text='3', is_correct=False, order_index=0)
        self.option2 = QuestionOption.objects.create(question=self.question, option_text='4', is_correct=True, order_index=1)
        
        # Authenticate as student
        self.client.force_authenticate(user=self.student)

    def test_full_exam_flow(self):
        # 1. Start Exam
        response = self.client.post('/api/submissions/exam-assignments/start_exam/', {'exam_id': str(self.exam.id)}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        assignment_id = response.data['id']
        self.assertEqual(response.data['status'], 'in_progress')
        
        # 2. Submit Answer (Correct)
        answer_data = {
            'question_id': str(self.question.id),
            'answer_options': [str(self.option2.id)]
        }
        response = self.client.post(f'/api/submissions/exam-assignments/{assignment_id}/submit_answer/', answer_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(float(response.data['auto_score']), 5.0)
        
        # 3. Submit Exam
        response = self.client.post(f'/api/submissions/exam-assignments/{assignment_id}/submit_exam/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'graded')
        self.assertEqual(float(response.data['score']), 5.0)

    def test_start_exam_service(self):
        assignment = ExamAssignmentService.start_exam(self.exam.id, self.student.id)
        self.assertIsNotNone(assignment)
        self.assertEqual(assignment.status, ExamAssignment.Status.IN_PROGRESS)
        
        # Test idempotency
        assignment2 = ExamAssignmentService.start_exam(self.exam.id, self.student.id)
        self.assertEqual(assignment.id, assignment2.id)
