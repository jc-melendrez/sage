from django.contrib import admin
from .models import ChatSession, ChatMessage, Quiz, QuizQuestion, QuizAttempt

@admin.register(Quiz)
class QuizAdmin(admin.ModelAdmin):
    list_display = ('title', 'user', 'created_at', 'available_until')
    search_fields = ('title', 'user__username')

@admin.register(QuizQuestion)
class QuizQuestionAdmin(admin.ModelAdmin):
    list_display = ('question_text', 'quiz')

@admin.register(QuizAttempt)
class QuizAttemptAdmin(admin.ModelAdmin):
    list_display = ('quiz', 'user', 'started_at', 'completed_at', 'score', 'total')

admin.site.register(ChatSession)
admin.site.register(ChatMessage)
