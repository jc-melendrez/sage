from django.db import models
from django.conf import settings

class ChatSession(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='chat_sessions')
    title = models.CharField(max_length=255, default="New Conversation")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    pinned = models.BooleanField(default=False)

    class Meta:
        ordering = ['-pinned', '-updated_at']

    def __str__(self):
        return f"{self.user.username} - {self.title}"

class ChatMessage(models.Model):
    # 🌟 We keep the User field just like you asked!
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='chat_messages')
    
    # 🌟 We add the Session field, but make it optional (null=True, blank=True)
    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name='messages', null=True, blank=True)
    
    text = models.TextField()
    is_ai = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{'AI' if self.is_ai else 'User'}: {self.text[:30]}"

class Quiz(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='quizzes')
    # Optional class (Course) this quiz belongs to — quizzes are class-scoped.
    course = models.ForeignKey(
        'users.Course',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='quizzes',
    )
    title = models.CharField(max_length=255)
    quiz_type = models.CharField(max_length=50, default="Multiple Choice")
    created_at = models.DateTimeField(auto_now_add=True)
    # Optional deadline: the quiz can't be started/completed after this time.
    # null/blank = always open.
    available_until = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.title

class QuizAttempt(models.Model):
    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name='attempts')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='quiz_attempts')
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    score = models.IntegerField(null=True, blank=True)
    total = models.IntegerField(null=True, blank=True)

    class Meta:
        ordering = ['-started_at']

class QuizQuestion(models.Model):
    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name='questions')
    question_text = models.TextField()
    options = models.JSONField()  # Stores the list of choices
    correct_answer = models.TextField()
    explanation = models.TextField(blank=True, null=True)