import random
import string
import uuid
from django.contrib.auth.models import AbstractUser, UserManager
from django.db import models
from django.conf import settings
from django.utils import timezone

# Automatically generate a 6-character random code like "A7X9PQ"
def generate_join_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

class SageUserManager(UserManager):
    """Ensures superusers created via `createsuperuser` get role='superadmin'."""

    def create_superuser(self, username, email=None, password=None, **extra_fields):
        extra_fields.setdefault('role', 'superadmin')
        return super().create_superuser(
            username, email=email, password=password, **extra_fields
        )


class User(AbstractUser):

    ROLE_CHOICES = [
        ('superadmin', 'Superadmin'),
        ('educator', 'Educator'),
        ('student', 'Student'),
    ]

    objects = SageUserManager()

    # Single source of truth for the user's role.
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='student')

    # Bumped on role change / deactivation to revoke outstanding JWTs.
    token_version = models.IntegerField(default=0)

    # --- Role flags (kept in sync with `role` for mobile/Firestore compat) ---
    is_student = models.BooleanField(default=False, editable=False)
    is_educator = models.BooleanField(default=False, editable=False)

    firebase_uid = models.CharField(max_length=128, unique=True, null=True, blank=True)

    # Key of the system-provided profile picture (see mobile_app/constants/pfps.ts).
    # Empty string means the app falls back to initials.
    avatar = models.CharField(max_length=50, blank=True, default='')

    # --- Gamification Overview ---
    level = models.IntegerField(default=1)
    current_xp = models.IntegerField(default=0)
    total_points = models.IntegerField(default=0)
    streak = models.IntegerField(default=0)
    last_active = models.DateField(null=True, blank=True)
    
    # --- Statistics Section ---
    courses_completed = models.IntegerField(default=0)
    study_hours = models.FloatField(default=0.0)
    quizzes_taken = models.IntegerField(default=0)
    group_activities_count = models.IntegerField(default=0)

    # 🌟 NEW: The Level-Up Engine
    def add_xp(self, amount):
        self.current_xp += amount
        self.total_points += amount
        
        # Define the leveling curve (e.g., Level 1 needs 1000xp, Level 2 needs 2000xp)
        next_level_xp = self.level * 1000
        
        # Check if they earned enough to level up (loops in case they earned a massive amount of XP)
        while self.current_xp >= next_level_xp:
            self.level += 1
            self.current_xp -= next_level_xp # Reset current XP progress for the new level
            next_level_xp = self.level * 1000 # Calculate the goal for the next iteration
            
        self.save()

    def save(self, *args, **kwargs):
        # Derive the legacy boolean role flags from the canonical `role` field.
        self.is_student = self.role == 'student'
        self.is_educator = self.role == 'educator'
        super().save(*args, **kwargs)

    def __str__(self):
        return self.username

# --- Your Related Models ---

class Badge(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='badges')
    course = models.ForeignKey('Course', on_delete=models.CASCADE, related_name='badges', null=True, blank=True)
    icon = models.CharField(max_length=10)
    name = models.CharField(max_length=100)
    earned_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} - {self.name}" + (f" ({self.course.name})" if self.course else "")

class Recommendation(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='recommendations')
    title = models.CharField(max_length=255)
    description = models.TextField()
    # The course this card sends the learner to. Without it the "Start
    # learning" button had nowhere to go, so every recommendation was a dead
    # card. Null when the generator could not pick a course the learner is
    # actually enrolled in -- the client then falls back to Activities rather
    # than deep-linking somewhere that may not exist.
    course = models.ForeignKey(
        'Course',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='recommendations',
    )
    # The specific topic inside `course` that the card is about. The generator
    # used to pick a course only, so a card titled "Review Quadratics" still
    # dropped the student on whatever node happened to be first-unpassed in that
    # course. A null topic just falls back to the course-level deep link, which
    # is what every recommendation created before this field did.
    # Always set alongside `course`; the serializer drops a topic whose course
    # does not match, since the path route is addressed by course id.
    topic = models.ForeignKey(
        'Topic',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='recommendations',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} - {self.title}"

class Session(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sessions')
    title = models.CharField(max_length=255)
    description = models.TextField()
    participants = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} - {self.title}"

class Activity(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='activities')
    kind = models.CharField(max_length=20, default='other')  # quiz | lesson | checkin | game | offline_game | other
    title = models.CharField(max_length=255)
    description = models.TextField()
    activity_type = models.CharField(max_length=50)
    xp_earned = models.IntegerField(default=0)
    course_name = models.CharField(max_length=255, blank=True, default='')
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user.username} - {self.title}"


# --- 🌟 NEW: GROUP & MULTIPLAYER MODELS ---

class StudyGroup(models.Model):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    join_code = models.CharField(max_length=10, unique=True, default=generate_join_code)
    
    # The teacher/student who made the group
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='created_groups')
    
    # The students inside the group
    members = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name='joined_groups')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.join_code})"

class GroupMessage(models.Model):
    group = models.ForeignKey(StudyGroup, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at'] # Oldest messages at the top

    def __str__(self):
        return f"{self.sender.username}: {self.text[:30]}"


# --- COURSES: each course has its OWN set of students ---

class Course(models.Model):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    join_code = models.CharField(max_length=10, unique=True, default=generate_join_code)

    # The educator who owns this course
    educator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='courses')

    # The students enrolled in THIS course (per-course roster)
    students = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name='enrolled_courses', blank=True)

    # Firestore document id of this course's class chat, or '' when the
    # educator has not enabled one.
    #
    # A string rather than a foreign key because study groups live in Firestore
    # (see `core.firestore_service.create_study_group`), not in the Django
    # `StudyGroup` table, which nothing writes to. The earlier
    # `study_group = OneToOneField(StudyGroup)` could therefore never resolve:
    # `CreateCourseView` looked the id up in an always-empty table and 404'd.
    chat_group_id = models.CharField(max_length=128, blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.join_code})"

    @property
    def has_class_chat(self):
        return bool(self.chat_group_id)


class CourseScore(models.Model):
    """Per-student gamification stats scoped to a single course.

    Node points are derived live from `NodeProgress` (that table is the
    authority for learning-path results). This model only accumulates the
    things NodeProgress can't represent: course-quiz completion XP.
    """

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='scores')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='course_scores')

    quiz_points = models.IntegerField(default=0)
    quizzes_completed = models.IntegerField(default=0)
    last_activity = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('course', 'user')

    def __str__(self):
        return f"{self.user.username} in {self.course.name} ({self.quiz_points} quiz pts)"


class ClassActivity(models.Model):
    """A teacher-set academic task (activity) for a class.

    `note` holds the assignment instructions shown to students, `due_date` is
    the deadline (date *and* time, so "due Friday 5pm" is expressible), and
    `max_points` is the point value students are graded out of. Task-kind
    activities additionally collect `TaskSubmission` turn-ins.
    """

    KIND_CHOICES = [
        ('quiz', 'Quiz'),
        ('lesson', 'Lesson'),
        ('game', 'Live Game'),
        ('task', 'Task'),
    ]
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('published', 'Published'),
    ]

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='activities')
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default='quiz')
    title = models.CharField(max_length=255)
    # Optional reference to the attached Quiz (ai_assistant.Quiz); lessons and
    # live games have no Django object, so this stays null for those kinds.
    ref_id = models.IntegerField(null=True, blank=True)
    note = models.TextField(blank=True, default='')
    due_date = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    max_points = models.PositiveIntegerField(default=100)
    allow_multiple_files = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.course.name} - {self.title} ({self.status})"


class TaskSubmission(models.Model):
    """A student's turn-in for a task-kind class activity.

    One turn-in per student per task. The turn-in holds any number of files
    (see `TaskSubmissionFile`) plus the student's own note to the educator, and
    carries the grade. File bytes are stored in the database so uploads survive
    redeploys (no filesystem storage).
    """

    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
    MAX_FILES = 10

    activity = models.ForeignKey(ClassActivity, on_delete=models.CASCADE, related_name='submissions')
    student = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='task_submissions')
    # Optional note from the student to their educator ("I wasn't sure about Q3").
    description = models.TextField(blank=True, default='')
    submitted_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    score = models.IntegerField(null=True, blank=True)
    feedback = models.TextField(blank=True, default='')
    graded_at = models.DateTimeField(null=True, blank=True)
    graded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='graded_submissions')

    class Meta:
        unique_together = ('activity', 'student')
        ordering = ['submitted_at']

    @property
    def is_late(self):
        """True when the turn-in landed after the assignment's due date."""
        if not self.activity.due_date:
            return False
        return self.submitted_at > self.activity.due_date

    def __str__(self):
        return f"{self.student.username} -> {self.activity.title}"


class TaskSubmissionFile(models.Model):
    """A single file inside a student's turn-in."""

    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

    submission = models.ForeignKey(TaskSubmission, on_delete=models.CASCADE, related_name='files')
    file_name = models.CharField(max_length=255)
    file_mime = models.CharField(max_length=120, default='application/octet-stream')
    file_size = models.IntegerField(default=0)
    file_data = models.BinaryField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{self.submission} - {self.file_name}"


class ClassActivityAttachment(models.Model):
    """Teacher-uploaded attachment for a class activity (e.g., task worksheet)."""

    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
    MAX_FILES = 10

    activity = models.ForeignKey(ClassActivity, on_delete=models.CASCADE, related_name='attachments')
    file_name = models.CharField(max_length=255)
    file_mime = models.CharField(max_length=120, default='application/octet-stream')
    file_size = models.IntegerField(default=0)
    file_data = models.BinaryField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.activity.title} - {self.file_name}"


# --- Lesson Progress (persisted course progression) ---

class LessonProgress(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='lesson_progress')
    course_id = models.CharField(max_length=255)
    level_id = models.IntegerField(default=1)
    score = models.IntegerField(default=0)
    total = models.IntegerField(default=0)
    passed = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'course_id', 'level_id')

    def __str__(self):
        return f"{self.user.username} - {self.course_id} L{self.level_id} ({'pass' if self.passed else 'fail'})"


class Announcement(models.Model):
    """
    An educator's message to their students, addressed to one or more courses.

    The audience is stored as M2M targets rather than a denormalised recipient
    list so "who should see this" stays answerable from live rosters: drop a
    student from a course and they immediately stop being an audience, and a
    student who joins later starts seeing the history.

    Study groups are deliberately not a target here. Groups live in Firestore
    with string document ids (see `core.firestore_service.get_user_groups`)
    and the Django `StudyGroup` table is essentially never populated, so an FK
    to it would be a field that can never match anything. When group
    announcements are wanted they need a Firestore id (or a synced group
    table) and their own resolution path.
    """

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='sent_announcements',
    )
    title = models.CharField(max_length=255, blank=True, default='')
    message = models.TextField()

    # A scheduled announcement is written now but withheld from students until
    # `scheduled_at`. The read endpoint does the withholding, so no background
    # job is needed to flip a flag.
    is_scheduled = models.BooleanField(default=False)
    scheduled_at = models.DateTimeField(null=True, blank=True)

    courses = models.ManyToManyField('Course', blank=True, related_name='announcements')

    published_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-published_at']

    def __str__(self):
        preview = self.title or self.message[:40]
        return f"{self.author.username}: {preview}"


class RoleChangeLog(models.Model):
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='role_changes_made',
    )
    target_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='role_changes_received',
    )
    from_role = models.CharField(max_length=20)
    to_role = models.CharField(max_length=20)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.changed_by.username} {self.from_role}->{self.to_role} for {self.target_user.username}"


class LoginOtpChallenge(models.Model):
    """
    A pending email-OTP challenge issued during Firebase email/password login.

    The mobile app is stateless (JWT only, no sessions), so the OTP challenge
    lives in the DB keyed by a random UUID token that the client holds until
    the code is verified. Codes are stored HMAC-hashed, never in plaintext.
    """
    OTP_TTL_MINUTES = 5
    MAX_ATTEMPTS = 5

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='otp_challenges',
    )
    challenge_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    otp_hash = models.CharField(max_length=64)  # HMAC-SHA256 hex digest
    expires_at = models.DateTimeField()
    attempts = models.IntegerField(default=0)
    verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    @property
    def is_expired(self):
        return timezone.now() >= self.expires_at

    @property
    def is_locked(self):
        return self.attempts >= self.MAX_ATTEMPTS

    def __str__(self):
        return f"OTP challenge for {self.user.username} ({'verified' if self.verified else 'pending'})"


# --- LEARNING PATH: Topics, Nodes, and Progress ---

class Topic(models.Model):
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='topics')
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default='')
    order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order']

    def __str__(self):
        return f"{self.course.name} > {self.title}"


class LearningNode(models.Model):
    NODE_TYPES = [
        ('learn', 'Learn'),
        ('practice', 'Practice'),
        ('challenge', 'Challenge'),
        ('group_activity', 'Group Activity'),
        ('review', 'Review'),
        ('mastery', 'Mastery'),
    ]

    topic = models.ForeignKey(Topic, on_delete=models.CASCADE, related_name='nodes')
    node_type = models.CharField(max_length=20, choices=NODE_TYPES)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default='')
    content_json = models.JSONField(default=dict)
    order = models.IntegerField(default=0)
    xp_reward = models.IntegerField(default=25)
    required_score = models.IntegerField(default=70)
    estimated_minutes = models.IntegerField(default=5)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order']

    def __str__(self):
        return f"{self.topic.title} > {self.title} ({self.node_type})"


class NodeProgress(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='node_progress')
    node = models.ForeignKey(LearningNode, on_delete=models.CASCADE)
    score = models.IntegerField(default=0)
    passed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    attempts = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'node')

    def __str__(self):
        return f"{self.user.username} - {self.node.title} ({'pass' if self.passed else 'fail'})"


class AIUsage(models.Model):
    """One row per user per day: what their AI budget was spent on.

    The throttles in core/throttling.py bound bursts over minutes. This is the
    daily budget, and it is measured in *points* rather than calls because a
    call is not a unit of cost: one lesson generation asks for 12000 output
    tokens plus the whole extracted document, while a chat turn asks for 2048
    output plus twenty replayed turns. Counting both as "1" would let a single
    request exhaust an entire day's allowance. See users/ai_usage.py for the
    weights.

    One row per (user, day) so the budget check is a single atomic UPDATE
    rather than a read-then-write, which would race between the two gunicorn
    workers and let a burst overshoot.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='ai_usage',
    )
    day = models.DateField()

    # The currency the budget is enforced in. `calls` and the token counters
    # are observability only: nothing rejects a request on them.
    points = models.PositiveIntegerField(default=0)
    calls = models.PositiveIntegerField(default=0)
    prompt_tokens = models.PositiveIntegerField(default=0)
    completion_tokens = models.PositiveIntegerField(default=0)
    # Fallback estimate for providers that return no usage block. Kept
    # separately from prompt_tokens so a guess is never mistaken for a count.
    prompt_chars = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'day'], name='uniq_ai_usage_user_day',
            ),
        ]
        ordering = ['-day']

    def __str__(self):
        return f"{self.user.username} {self.day}: {self.points}pts / {self.calls} calls"

