from django.conf import settings
from django.db import models


class OfflineGameResult(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='offline_game_results',
    )
    session_key = models.CharField(max_length=64, unique=True)
    quiz_id = models.IntegerField(null=True, blank=True)
    quiz_title = models.CharField(max_length=255, blank=True, default='')
    quiz_type = models.CharField(max_length=50, blank=True, default='')
    time_per_question = models.IntegerField(default=15)
    score = models.IntegerField(default=0)
    correct_count = models.IntegerField(default=0)
    answered_count = models.IntegerField(default=0)
    total_questions = models.IntegerField(default=0)
    completed_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-completed_at']

    def __str__(self):
        return f"{self.user} - {self.quiz_title} ({self.score})"
