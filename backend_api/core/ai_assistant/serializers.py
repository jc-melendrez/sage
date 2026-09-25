from rest_framework import serializers
from .models import Quiz, QuizAttempt, QuizQuestion

class QuizQuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuizQuestion
        fields = ['id', 'question_text', 'options', 'correct_answer', 'explanation']

class QuizSerializer(serializers.ModelSerializer):
    questions = QuizQuestionSerializer(many=True, read_only=True)
    course = serializers.IntegerField(source='course_id', read_only=True)
    attempt_count = serializers.SerializerMethodField()

    class Meta:
        model = Quiz
        fields = ['id', 'title', 'created_at', 'quiz_type', 'course', 'available_until', 'questions', 'attempt_count']

    def get_attempt_count(self, obj):
        request = self.context.get('request')
        if request is None or not request.user.is_authenticated:
            return 0
        return QuizAttempt.objects.filter(quiz=obj, user=request.user).count()