from django.utils import timezone
from django.db import transaction
from django.core.exceptions import ValidationError
from .models import ExamAssignment, StudentResponse, SuspiciousActivity, AuditLog
from exams.models import Exam, Question, QuestionOption
import random

class AnswerValidationService:
    @staticmethod
    def validate_answer(question, answer_data):
        """
        Validates the format of the answer based on question type.
        Returns (is_valid, error_message)
        """
        if question.question_type == Question.QuestionType.MULTIPLE_CHOICE:
            if not answer_data.get('answer_options') or len(answer_data['answer_options']) != 1:
                return False, "Multiple choice requires exactly one selected option."
            # Verify option exists
            option_id = answer_data['answer_options'][0]
            if not QuestionOption.objects.filter(id=option_id, question=question).exists():
                return False, "Invalid option selected."

        elif question.question_type == Question.QuestionType.MULTIPLE_SELECT:
            if not answer_data.get('answer_options'):
                return False, "At least one option must be selected."
            # Verify all options exist
            option_ids = answer_data['answer_options']
            count = QuestionOption.objects.filter(id__in=option_ids, question=question).count()
            if count != len(option_ids):
                return False, "One or more invalid options selected."

        elif question.question_type in [Question.QuestionType.SHORT_ANSWER, Question.QuestionType.ESSAY]:
            if not answer_data.get('answer_text'):
                return False, "Answer text cannot be empty."

        return True, None

    @staticmethod
    def auto_grade_answer(question, answer_data):
        """
        Calculates the score for a given answer.
        Returns score (Decimal) or None if manual grading is required.
        """
        if question.question_type == Question.QuestionType.MULTIPLE_CHOICE:
            selected_option_id = answer_data['answer_options'][0]
            selected_option = QuestionOption.objects.get(id=selected_option_id)
            return question.points if selected_option.is_correct else 0

        elif question.question_type == Question.QuestionType.MULTIPLE_SELECT:
            selected_ids = set(answer_data['answer_options'])
            correct_options = set(QuestionOption.objects.filter(question=question, is_correct=True).values_list('id', flat=True))
            
            # Exact match required for full points (simplest logic for now)
            # Could be enhanced for partial credit later
            if selected_ids == {str(uid) for uid in correct_options}:
                return question.points
            return 0

        elif question.question_type == Question.QuestionType.SHORT_ANSWER:
            # Simple exact match (case-insensitive) against any correct option text if we had it stored
            # For now, let's assume short answers need manual review or exact keyword match
            # Returning None implies manual grading needed or not implemented yet
            return None 

        elif question.question_type == Question.QuestionType.ESSAY:
            return None  # Always manual grading

        return 0

class ExamAssignmentService:
    @staticmethod
    def start_exam(exam, student):
        """
        Starts an exam for a student.
        """
        # Check if already started
        existing = ExamAssignment.objects.filter(exam=exam, student=student).first()
        if existing:
            if existing.status != ExamAssignment.Status.NOT_STARTED:
                return existing
            
            existing.status = ExamAssignment.Status.IN_PROGRESS
            existing.started_at = timezone.now()
            existing.save()
            return existing

        # Create new assignment
        assignment = ExamAssignment.objects.create(
            exam=exam,
            student=student,
            status=ExamAssignment.Status.IN_PROGRESS,
            started_at=timezone.now()
        )
        
        # Initialize empty responses for all questions
        questions = list(exam.questions.all())
        if exam.randomize_questions:
            random.shuffle(questions)
            
        responses = []
        for q in questions:
            responses.append(StudentResponse(
                exam_assignment=assignment,
                question=q,
                student=student
            ))
        StudentResponse.objects.bulk_create(responses)
        
        return assignment

    @staticmethod
    def submit_answer(assignment, question_id, answer_data):
        """
        Submits an answer for a specific question.
        answer_data: { 'answer_text': str, 'answer_options': [id, id] }
        """
        if assignment.status != ExamAssignment.Status.IN_PROGRESS:
            raise ValidationError("Exam is not in progress.")

        try:
            question = Question.objects.get(id=question_id, exam=assignment.exam)
        except Question.DoesNotExist:
            raise ValidationError("Question not found in this exam.")

        # Validate
        is_valid, error = AnswerValidationService.validate_answer(question, answer_data)
        if not is_valid:
            raise ValidationError(error)

        # Get or create response
        response, created = StudentResponse.objects.get_or_create(
            exam_assignment=assignment,
            question=question,
            defaults={'student': assignment.student}
        )

        # Update response
        response.answer_text = answer_data.get('answer_text')
        response.answer_options = answer_data.get('answer_options', [])
        response.is_answered = True
        
        # Auto-grade
        score = AnswerValidationService.auto_grade_answer(question, answer_data)
        if score is not None:
            response.auto_score = score
        
        response.save()
        return response

    @staticmethod
    def submit_exam(assignment):
        """
        Finalizes the exam submission.
        """
        if assignment.status != ExamAssignment.Status.IN_PROGRESS:
            raise ValidationError("Exam is not in progress.")

        assignment.status = ExamAssignment.Status.SUBMITTED
        assignment.submitted_at = timezone.now()
        
        # Calculate total score (sum of auto_scores)
        total_score = 0
        responses = assignment.responses.all()
        all_graded = True
        
        for resp in responses:
            if resp.auto_score is not None:
                total_score += resp.auto_score
            else:
                all_graded = False # Needs manual grading
        
        assignment.score = total_score
        
        # If all questions were auto-graded, we can mark it as GRADED
        # Otherwise it stays SUBMITTED until instructor reviews
        if all_graded and not assignment.exam.questions.filter(question_type__in=[Question.QuestionType.ESSAY, Question.QuestionType.SHORT_ANSWER]).exists():
             assignment.status = ExamAssignment.Status.GRADED

        assignment.save()
        return assignment
