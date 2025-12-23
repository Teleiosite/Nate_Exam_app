from django.utils import timezone
from django.db import transaction
from django.core.exceptions import ValidationError, ObjectDoesNotExist
from .models import ExamAssignment, StudentResponse
from exams.models import Exam, Question, QuestionOption
from django.contrib.auth import get_user_model
import random

User = get_user_model()

class AnswerValidationService:
    @staticmethod
    def validate_answer(question, answer_data):
        if question.question_type == Question.QuestionType.MULTIPLE_CHOICE:
            if not answer_data.get('answer_options') or len(answer_data['answer_options']) != 1:
                return False, "Multiple choice requires exactly one selected option."
            try:
                option_id = answer_data['answer_options'][0]
                if not QuestionOption.objects.filter(id=option_id, question=question).exists():
                    return False, "Invalid option selected."
            except (ValueError, TypeError):
                 return False, "Invalid option format."

        elif question.question_type == Question.QuestionType.MULTIPLE_SELECT:
            if not answer_data.get('answer_options'):
                return False, "At least one option must be selected."
            option_ids = answer_data['answer_options']
            if not isinstance(option_ids, list):
                return False, "Answer options must be a list."
            count = QuestionOption.objects.filter(id__in=option_ids, question=question).count()
            if count != len(option_ids):
                return False, "One or more invalid options selected."

        elif question.question_type in [Question.QuestionType.SHORT_ANSWER, Question.QuestionType.ESSAY]:
            if not answer_data.get('answer_text'):
                return False, "Answer text cannot be empty."

        return True, None

    @staticmethod
    def auto_grade_answer(question, answer_data):
        if question.question_type == Question.QuestionType.MULTIPLE_CHOICE:
            selected_option_id = answer_data['answer_options'][0]
            selected_option = QuestionOption.objects.get(id=selected_option_id)
            return question.points if selected_option.is_correct else 0

        elif question.question_type == Question.QuestionType.MULTIPLE_SELECT:
            selected_ids = set(map(str, answer_data['answer_options']))
            correct_options = set(map(str, QuestionOption.objects.filter(question=question, is_correct=True).values_list('id', flat=True)))
            return question.points if selected_ids == correct_options else 0

        return None


class ExamAssignmentService:
    @staticmethod
    def start_exam(exam_id, student_id):
        try:
            exam = Exam.objects.get(id=exam_id)
            student = User.objects.get(id=student_id)
        except ObjectDoesNotExist:
            raise ValidationError("Invalid exam or student ID.")

        if student.specialization != exam.specialization:
            raise ValidationError("This exam is not available for your specialization.")

        assignment, created = ExamAssignment.objects.get_or_create(
            exam=exam, 
            student=student,
            defaults={
                'status': ExamAssignment.Status.IN_PROGRESS,
                'started_at': timezone.now()
            }
        )

        if not created and assignment.status not in [ExamAssignment.Status.NOT_STARTED, ExamAssignment.Status.IN_PROGRESS]:
             raise ValidationError("Exam already submitted and cannot be retaken.")

        if assignment.status == ExamAssignment.Status.NOT_STARTED:
            assignment.status = ExamAssignment.Status.IN_PROGRESS
            assignment.started_at = timezone.now()
            assignment.save()

        return assignment

    @staticmethod
    def submit_answer(assignment_id, question_id, student_id, answer_data):
        try:
            assignment = ExamAssignment.objects.get(id=assignment_id, student_id=student_id)
            question = Question.objects.get(id=question_id, exam=assignment.exam)
        except ObjectDoesNotExist:
            raise ValidationError("Invalid assignment or question ID.")

        if assignment.status != ExamAssignment.Status.IN_PROGRESS:
            raise ValidationError("Exam is not in progress.")

        is_valid, error = AnswerValidationService.validate_answer(question, answer_data)
        if not is_valid:
            raise ValidationError(error)

        response, _ = StudentResponse.objects.update_or_create(
            exam_assignment=assignment,
            question=question,
            student=assignment.student,
            defaults={
                'answer_text': answer_data.get('answer_text'),
                'answer_options': answer_data.get('answer_options', []),
                'is_answered': True,
                'auto_score': AnswerValidationService.auto_grade_answer(question, answer_data)
            }
        )
        return response

    @staticmethod
    def submit_exam(assignment_id, student_id):
        try:
            assignment = ExamAssignment.objects.get(id=assignment_id, student_id=student_id)
        except ObjectDoesNotExist:
            raise ValidationError("Invalid assignment ID.")

        if assignment.status != ExamAssignment.Status.IN_PROGRESS:
            raise ValidationError("Exam is not in progress.")

        assignment.status = ExamAssignment.Status.SUBMITTED
        assignment.submitted_at = timezone.now()

        total_score = 0
        responses = assignment.responses.filter(is_answered=True)
        needs_manual_grading = False
        
        for resp in responses:
            if resp.auto_score is not None:
                total_score += resp.auto_score
            elif resp.question.question_type in [Question.QuestionType.ESSAY, Question.QuestionType.SHORT_ANSWER]:
                needs_manual_grading = True
        
        assignment.score = total_score
        
        if not needs_manual_grading:
             assignment.status = ExamAssignment.Status.GRADED

        assignment.save()
        return assignment
