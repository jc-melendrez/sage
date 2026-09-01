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

class School(models.Model):
    name = models.CharField(max_length=255, unique=True)
    address = models.TextField(blank=True, default="")
    contact_email = models.EmailField(blank=True, default="")
    contact_phone = models.CharField(max_length=30, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='created_schools',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


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
        ('admin', 'Admin'),
        ('educator', 'Educator'),
        ('student', 'Student'),
    ]

    objects = SageUserManager()

    # Single source of truth for the user's role.
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='student')

    # Tenant (school) scope. Null for superadmins / unassigned users.
    school = models.ForeignKey(
        School, null=True, blank=True,
        on_delete=models.PROTECT, related_name='members',
    )

    # Bumped on role change / deactivation to revoke outstanding JWTs.
    token_version = models.IntegerField(default=0)

    # --- Role flags (kept in sync with `role` for mobile/Firestore compat) ---
    is_student = models.BooleanField(default=False, editable=False)
    is_educator = models.BooleanField(default=False, editable=False)
    is_admin = models.BooleanField(default=False, editable=False)

    firebase_uid = models.CharField(max_length=128, unique=True, null=True, blank=True)
    
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
        self.is_admin = self.role == 'admin'
        super().save(*args, **kwargs)

    def __str__(self):
        return self.username

# --- Your Related Models ---

class Badge(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='badges')
    icon = models.CharField(max_length=10)
    name = models.CharField(max_length=100)
    earned_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} - {self.name}"

class Recommendation(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='recommendations')
    title = models.CharField(max_length=255)
    description = models.TextField()
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
    title = models.CharField(max_length=255)
    description = models.TextField()
    activity_type = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)

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

    # Optional link to a study group for chat/collaboration
    study_group = models.OneToOneField(StudyGroup, on_delete=models.SET_NULL, null=True, blank=True, related_name='course')

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.join_code})"


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


class RoleChangeLog(models.Model):
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='role_changes_made',
    )
    target_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='role_changes_received',
    )
    school = models.ForeignKey(School, null=True, on_delete=models.SET_NULL)
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
