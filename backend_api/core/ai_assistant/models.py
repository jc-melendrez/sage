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
        # Only one conversation may be pinned at a time. The API also clears
        # the previous pin inside a transaction, but the database is what
        # stops two pins from sneaking in through a concurrent request or a
        # manual admin edit.
        constraints = [
            models.UniqueConstraint(
                fields=['user'],
                condition=models.Q(pinned=True),
                name='uniq_pinned_session_per_user',
            ),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.title}"

class ChatMessage(models.Model):
    # 🌟 We keep the User field just like you asked!
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='chat_messages')
    
    # 🌟 We add the Session field, but make it optional (null=True, blank=True)
    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name='messages', null=True, blank=True)
    
    text = models.TextField(blank=True, default="")
    is_ai = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    # Attachment metadata for the file the user uploaded with this turn.
    # The extracted text is folded into `text` before it reaches the model,
    # so reloading a conversation previously showed a bare AI answer with no
    # trace of the document that prompted it. We store the metadata only --
    # never the file bytes -- and the name is what the bubble chip renders.
    file_name = models.CharField(max_length=255, blank=True, default="")
    file_mime = models.CharField(max_length=100, blank=True, default="")
    file_size = models.IntegerField(null=True, blank=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        if self.file_name:
            return f"{'AI' if self.is_ai else 'User'}: [{self.file_name}]"
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


class QuizGroupShare(models.Model):
    """
    "This quiz was shared into that group", recorded so the group can be
    granted read access afterwards.

    Without this, a quiz card posted in a group chat was a dead end for anyone
    who was not already on the quiz's course: `_validate_quiz_embed` (sharing)
    and `QuizShareView` (fetching) both require owner-or-enrolled, so a student
    who was invited to the group but not the class could see the title and
    question count and nothing else.

    Recording the share closes that gap without loosening either existing
    check, because access is still per user and still revocable -- remove the
    member from the group, or delete the row, and the copy they already made
    stays theirs while new fetches are denied.

    The group itself lives in Firestore (groups are `studyGroups` documents
    keyed by a string id with firebase uids in `members`), so this stores the
    document id rather than a foreign key to `users.StudyGroup`, which is not
    populated for groups created after the move to Firestore.
    """

    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name='group_shares')
    group_id = models.CharField(max_length=128)
    shared_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='quiz_group_shares',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('quiz', 'group_id')]
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.quiz_id} -> group {self.group_id}"
