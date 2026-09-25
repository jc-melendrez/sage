from rest_framework import serializers
from .models import Quiz, QuizAttempt, QuizQuestion

def _display_name(user):
    name = f"{user.first_name} {user.last_name}".strip()
    return name or user.username

def _percent(score, total):
    if not total or score is None:
        return None
    return round((score / total) * 100)

class QuizQuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuizQuestion
        fields = ['id', 'question_text', 'options', 'correct_answer', 'explanation']

class QuizAttemptSerializer(serializers.ModelSerializer):
    """One learner's attempt at a quiz, as an educator sees it."""
    student_id = serializers.IntegerField(source='user_id', read_only=True)
    student_name = serializers.SerializerMethodField()
    score_percent = serializers.SerializerMethodField()

    class Meta:
        model = QuizAttempt
        fields = [
            'id', 'student_id', 'student_name',
            'started_at', 'completed_at',
            'score', 'total', 'score_percent',
        ]
        read_only_fields = fields

    def get_student_name(self, obj):
        return _display_name(obj.user)

    def get_score_percent(self, obj):
        return _percent(obj.score, obj.total)

class QuizSerializer(serializers.ModelSerializer):
    questions = QuizQuestionSerializer(many=True, read_only=True)
    course = serializers.IntegerField(source='course_id', read_only=True)
    attempt_count = serializers.SerializerMethodField()
    class_attempted_count = serializers.SerializerMethodField()
    class_average_percent = serializers.SerializerMethodField()

    class Meta:
        model = Quiz
        fields = [
            'id', 'title', 'created_at', 'quiz_type', 'course', 'available_until',
            'questions', 'attempt_count',
            'class_attempted_count', 'class_average_percent',
        ]
        read_only_fields = fields

    def _request(self):
        return self.context.get('request')

    def _is_educator(self, obj):
        """Only the quiz author or the owning course educator may see class stats."""
        request = self._request()
        if request is None or not request.user.is_authenticated:
            return False
        if request.user == obj.user:
            return True
        return bool(obj.course and obj.course.educator_id == request.user.id)

    def get_attempt_count(self, obj):
        """Attempts made by the requesting user (not a class total)."""
        request = self._request()
        if request is None or not request.user.is_authenticated:
            return 0
        return QuizAttempt.objects.filter(quiz=obj, user=request.user).count()

    def get_class_attempted_count(self, obj):
        """Distinct learners who have opened this quiz. Educators only."""
        if not self._is_educator(obj):
            return None
        return (
            QuizAttempt.objects
            .filter(quiz=obj)
            .values('user_id')
            .distinct()
            .count()
        )

    def get_class_average_percent(self, obj):
        """Mean score of each learner's best completed attempt. Educators only."""
        if not self._is_educator(obj):
            return None
        best = {}
        for attempt in QuizAttempt.objects.filter(quiz=obj, completed_at__isnull=False).select_related('user'):
            if not attempt.total:
                continue
            ratio = attempt.score / attempt.total
            current = best.get(attempt.user_id)
            if current is None or ratio > current:
                best[attempt.user_id] = ratio
        if not best:
            return None
        return round(sum(best.values()) / len(best) * 100)
