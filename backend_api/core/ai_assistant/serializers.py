from rest_framework import serializers
from .models import Quiz, QuizQuestion

class QuizQuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuizQuestion
        fields = ['id', 'question_text', 'options', 'correct_answer', 'explanation']

class QuizSerializer(serializers.ModelSerializer):
    questions = QuizQuestionSerializer(many=True, read_only=True)
    course = serializers.IntegerField(source='course_id', read_only=True)

    class Meta:
        model = Quiz
        fields = ['id', 'title', 'created_at', 'quiz_type', 'course', 'questions']