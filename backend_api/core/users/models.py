import random
import string
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.conf import settings

# Automatically generate a 6-character random code like "A7X9PQ"
def generate_join_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

class User(AbstractUser):

    # --- Roles ---
    is_student = models.BooleanField(default=False)
    is_educator = models.BooleanField(default=False)
    is_admin = models.BooleanField(default=False)

    firebase_uid = models.CharField(max_length=128, unique=True, null=True, blank=True)
    
    # --- Gamification Overview ---
    level = models.IntegerField(default=1)
    current_xp = models.IntegerField(default=0)
    total_points = models.IntegerField(default=0)
    streak = models.IntegerField(default=0)
    
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