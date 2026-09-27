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

    `quiz` is nullable so the row survives the source quiz being deleted. That
    used to be a CASCADE, which silently revoked access from everyone the
    moment the educator tidied up their quiz list: the card stayed in the chat
    history pointing at a 404. Instead the share keeps a full copy of the
    questions (`package`) and the title, and read access for a deleted source
    is decided against `group_members` -- the roster captured at share time.

    Recording that roster is the whole reason former members keep working. A
    live share asks Firestore "is this person in the group right now?", which
    answers no the moment they leave and would make the snapshot just as
    ephemeral. The user asked for shares to be durable for the people they
    were shared with, so the answer is frozen here: a uid in `group_members`
    keeps access to the snapshot even after leaving the group, forever, unless
    the row is deleted. A uid that was never in the roster never gets it.
    """

    quiz = models.ForeignKey(
        Quiz,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='group_shares',
    )
    # The quiz's id at share time. Kept separately from `quiz_id` so the id
    # survives deletion and the uniqueness rule still collapses a re-share of
    # the same (possibly deleted) source into one row.
    source_quiz_id = models.PositiveIntegerField(null=True, blank=True)
    # A full copy of the quiz as a portable package document, so a deleted
    # source can still be read. See `quiz_package.build_quiz_package`.
    package = models.JSONField(null=True, blank=True)
    # Denormalised so a card can be rendered from the share row alone once the
    # source is gone, without deserialising the whole package.
    title = models.CharField(max_length=255, blank=True)
    # Firebase uids of the group members at the moment of sharing.
    group_members = models.JSONField(default=list, blank=True)
    group_id = models.CharField(max_length=128)
    shared_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='quiz_group_shares',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('source_quiz_id', 'group_id')]
        ordering = ['-created_at']

    def __str__(self):
        source = self.source_quiz_id or self.quiz_id
        return f"quiz {source} -> group {self.group_id}"

    def member_may_read_snapshot(self, firebase_uid):
        """
        Whether `firebase_uid` may read this share's snapshot.

        Only ever consulted when the source quiz is gone -- a live quiz always
        goes through the owner/enrolled/group checks, so a snapshot can never
        widen access to something that still exists.
        """
        if not firebase_uid:
            return False
        return firebase_uid in (self.group_members or [])
