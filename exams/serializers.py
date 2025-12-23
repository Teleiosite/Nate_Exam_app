

from rest_framework import serializers
from .models import Exam, Question, QuestionOption, QuestionBank
from accounts.serializers import EngineeringSpecializationSerializer, CustomUserSerializer
from accounts.models import EngineeringSpecialization

class QuestionOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuestionOption
        fields = ('id', 'option_text', 'is_correct', 'order_index')

class QuestionSerializer(serializers.ModelSerializer):
    options = QuestionOptionSerializer(many=True, required=False)

    class Meta:
        model = Question
        fields = ['id', 'question_text', 'question_type', 'points', 'explanation', 'image_url', 'order_index', 'is_required', 'options']
    
    def to_representation(self, instance):
        """Explicitly include options in the serialized output"""
        ret = super().to_representation(instance)
        ret['options'] = QuestionOptionSerializer(instance.options.all(), many=True).data
        return ret

class ExamListSerializer(serializers.ModelSerializer):
    specialization = EngineeringSpecializationSerializer(read_only=True)
    instructor = CustomUserSerializer(read_only=True)
    question_count = serializers.SerializerMethodField()

    class Meta:
        model = Exam
        fields = ('id', 'title', 'specialization', 'duration_minutes', 'total_points', 'question_count', 'instructor')
    
    def get_question_count(self, obj):
        return obj.questions.count()

class ExamDetailSerializer(serializers.ModelSerializer):
    questions = QuestionSerializer(many=True, required=False)
    specialization = serializers.PrimaryKeyRelatedField(
        queryset=EngineeringSpecialization.objects.all()
    )
    instructor = CustomUserSerializer(read_only=True)

    class Meta:
        model = Exam
        fields = '__all__'
        read_only_fields = ('instructor',)
    
    def to_representation(self, instance):
        """Use nested serializer for reading"""
        ret = super().to_representation(instance)
        ret['specialization'] = EngineeringSpecializationSerializer(instance.specialization).data
        ret['instructor'] = CustomUserSerializer(instance.instructor).data
        # Ensure questions are represented with their own serializer logic, including options
        ret['questions'] = QuestionSerializer(instance.questions.all(), many=True).data
        return ret

    def create(self, validated_data):
        questions_data = validated_data.pop('questions', [])
        exam = Exam.objects.create(**validated_data)
        
        for question_data in questions_data:
            options_data = question_data.pop('options', [])
            question_data.pop('id', None)  # FIX: Remove temporary ID before creating question
            question = Question.objects.create(exam=exam, **question_data)
            for option_data in options_data:
                option_data.pop('id', None) # FIX: Remove temporary ID before creating option
                QuestionOption.objects.create(question=question, **option_data)
        
        return exam

    def update(self, instance, validated_data):
        questions_data = validated_data.pop('questions', [])
        
        # Update exam fields
        instance.title = validated_data.get('title', instance.title)
        instance.specialization = validated_data.get('specialization', instance.specialization)
        instance.duration_minutes = validated_data.get('duration_minutes', instance.duration_minutes)
        instance.retake_limit = validated_data.get('retake_limit', instance.retake_limit)
        # Add any other fields from the Exam model that should be updatable
        instance.save()

        existing_questions = {str(q.id): q for q in instance.questions.all()}
        kept_question_ids = []

        for question_data in questions_data:
            question_id = question_data.get('id')
            options_data = question_data.pop('options', [])
            
            # If ID is present and it's a real one (not a temp frontend ID)
            if question_id and str(question_id) in existing_questions:
                question = existing_questions[str(question_id)]
                # Update question fields
                question.question_text = question_data.get('question_text', question.question_text)
                question.question_type = question_data.get('question_type', question.question_type)
                question.points = question_data.get('points', question.points)
                question.order_index = question_data.get('order_index', question.order_index)
                # ... any other fields
                question.save()
                kept_question_ids.append(str(question.id))
                
                # For options, a delete-and-recreate strategy is simpler and safer
                question.options.all().delete()
                for option_data in options_data:
                    option_data.pop('id', None) # Remove ID before creating
                    QuestionOption.objects.create(question=question, **option_data)
            else:
                # Create new question if ID is missing or temporary
                question_data.pop('id', None)
                new_question = Question.objects.create(exam=instance, **question_data)
                kept_question_ids.append(str(new_question.id))
                for option_data in options_data:
                    option_data.pop('id', None)
                    QuestionOption.objects.create(question=new_question, **option_data)

        # Delete questions that were removed in the frontend
        for q_id, q in existing_questions.items():
            if q_id not in kept_question_ids:
                q.delete()

        # Recalculate total points after all updates
        instance.total_points = sum(q.points for q in instance.questions.all())
        instance.save()
        
        return instance

class QuestionBankSerializer(serializers.ModelSerializer):
    specialization = EngineeringSpecializationSerializer(read_only=True)
    instructor = CustomUserSerializer(read_only=True)

    class Meta:
        model = QuestionBank
        fields = '__all__'
