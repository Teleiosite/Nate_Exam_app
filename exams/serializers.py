

from rest_framework import serializers
from .models import Exam, Question, QuestionOption, QuestionBank
from accounts.serializers import EngineeringSpecializationSerializer, CustomUserSerializer
from accounts.models import EngineeringSpecialization

class QuestionOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuestionOption
        fields = ('id', 'option_text', 'is_correct', 'order_index')

class QuestionSerializer(serializers.ModelSerializer):
    # Don't make options read_only - we need to accept them for create/update
    # But we'll ensure they're included in the response via to_representation
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
    # Read-only fields
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
        return ret

    def create(self, validated_data):
        questions_data = validated_data.pop('questions', [])
        exam = Exam.objects.create(**validated_data)
        
        for question_data in questions_data:
            options_data = question_data.pop('options', [])
            question = Question.objects.create(exam=exam, **question_data)
            for option_data in options_data:
                QuestionOption.objects.create(question=question, **option_data)
        
        return exam

    def update(self, instance, validated_data):
        questions_data = validated_data.pop('questions', [])
        
        # Update exam fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Handle questions (simple replacement strategy for now, or update existing)
        # For simplicity in this phase, we can delete existing and recreate, 
        # BUT that destroys student response links. 
        # So we should update existing ones if ID is present.
        
        # Map existing questions
        existing_questions = {q.id: q for q in instance.questions.all()}
        kept_question_ids = []

        for question_data in questions_data:
            question_id = question_data.get('id')
            options_data = question_data.pop('options', [])
            
            if question_id and question_id in existing_questions:
                # Update existing
                question = existing_questions[question_id]
                for attr, value in question_data.items():
                    setattr(question, attr, value)
                question.save()
                kept_question_ids.append(question.id)
                
                # Handle options for this question (delete/recreate is safer for options as they are small)
                question.options.all().delete()
                print(f"UPDATE: Question {question.id}, Options data: {options_data}")
                for opt_idx, option_data in enumerate(options_data):
                    print(f"  Creating option {opt_idx}: {option_data}")
                    # option_data already contains order_index from frontend, don't pass it again
                    QuestionOption.objects.create(question=question, **option_data)
            else:
                # Create new
                question = Question.objects.create(exam=instance, **question_data)
                kept_question_ids.append(question.id)
                print(f"CREATE: Question {question.id}, Options data: {options_data}")
                for opt_idx, option_data in enumerate(options_data):
                    print(f"  Creating option {opt_idx}: {option_data}")
                    # option_data already contains order_index from frontend, don't pass it again
                    QuestionOption.objects.create(question=question, **option_data)

        # Delete removed questions
        for q_id, q in existing_questions.items():
            if q_id not in kept_question_ids:
                q.delete()

        return instance

class QuestionBankSerializer(serializers.ModelSerializer):
    specialization = EngineeringSpecializationSerializer(read_only=True)
    instructor = CustomUserSerializer(read_only=True)

    class Meta:
        model = QuestionBank
        fields = '__all__'
