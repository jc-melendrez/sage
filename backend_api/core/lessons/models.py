from django.conf import settings
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models


class LearningModule(models.Model):
    title = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="learning_modules"
    )

    def __str__(self):
        return self.title


class LessonPart(models.Model):
    module = models.ForeignKey(
        LearningModule,
        on_delete=models.CASCADE,
        related_name="lesson_parts"
    )
    part_number = models.PositiveSmallIntegerField(
        choices=[(1, 1), (2, 2), (3, 3)],
        validators=[MinValueValidator(1), MaxValueValidator(3)]
    )
    part_title = models.CharField(max_length=255)
    beginner_summary = models.TextField()
    advanced_summary = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['module', 'part_number']

    def __str__(self):
        return f"Part {self.part_number}: {self.part_title}"


class QuizQuestion(models.Model):
    lesson_part = models.ForeignKey(
        LessonPart,
        on_delete=models.CASCADE,
        related_name="questions"
    )
    question_text = models.TextField()
    explanation = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['lesson_part', 'id']

    def __str__(self):
        return self.question_text[:80]


class QuizOption(models.Model):
    question = models.ForeignKey(
        QuizQuestion,
        on_delete=models.CASCADE,
        related_name="options"
    )
    option_text = models.CharField(max_length=500)
    is_correct = models.BooleanField(default=False)

    class Meta:
        ordering = ['question', 'id']

    def __str__(self):
        return f"{self.option_text} ({'correct' if self.is_correct else 'incorrect'})"
