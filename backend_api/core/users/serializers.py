from rest_framework import serializers
from .models import Badge, Recommendation, Session, Activity, Course
# --- Your Related Serializers (Unchanged, these are great!) ---
from django.contrib.auth import get_user_model

User = get_user_model()


class BadgeSerializer(serializers.ModelSerializer):

    class Meta:
        model = Badge
        fields = ['id', 'icon', 'name', 'earned_at']


class UserProfileSerializer(serializers.ModelSerializer):
    next_level_xp = serializers.SerializerMethodField()
    badges = BadgeSerializer(many=True, read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', # 🌟 Unhidden here!
            'is_student', 'is_educator', 'is_admin', 'level', 'current_xp', 
            'next_level_xp', 'total_points', 'streak',
            'courses_completed', 'study_hours', 'quizzes_taken', 
            'group_activities_count', 'badges', 'date_joined'
        ]
        read_only_fields = ['id', 'username', 'email', 'date_joined']
        
    def get_next_level_xp(self, obj):
        return obj.level * 1000





class RecommendationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Recommendation
        fields = ['id', 'title', 'description', 'created_at']

class SessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Session
        fields = ['id', 'title', 'description', 'participants', 'created_at']

class ActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Activity
        fields = ['id', 'title', 'description', 'activity_type', 'created_at']

# --- Updated User Serializers ---

# Use this when you want to send profile data to the mobile app
class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        # Fixed field names to match the actual User model
        fields = ['id', 'username', 'email', 'is_student', 'is_educator', 'level', 'current_xp', 'total_points', 'streak', 'courses_completed', 'study_hours', 'quizzes_taken', 'group_activities_count']

# Use this ONLY when a brand new user is signing up
class UserRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True) # Hides the password from the API response

    class Meta:
        model = User
        # 🌟 Added first_name and last_name here so the API accepts them
        fields = ['username', 'email', 'password', 'first_name', 'last_name', 'is_student', 'is_educator', 'is_admin']
        extra_kwargs = {'password': {'write_only': True}}

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''), # 🌟 Safely grab the first name
            last_name=validated_data.get('last_name', ''),   # 🌟 Safely grab the last name
            is_student=validated_data.get('is_student', False),
            is_educator=validated_data.get('is_educator', False),
            is_admin=validated_data.get('is_admin', False)
        )
        return user

# --- Course Serializers (each course has its own roster of students) ---

class CourseSerializer(serializers.ModelSerializer):
    educator = serializers.SerializerMethodField()
    student_count = serializers.SerializerMethodField()
    study_group_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Course
        fields = [
            'id', 'name', 'description', 'join_code', 'educator',
            'students', 'student_count', 'study_group_id', 'created_at',
        ]
        read_only_fields = ['join_code', 'students', 'created_at']

    def get_educator(self, obj):
        display_name = f"{obj.educator.first_name} {obj.educator.last_name}".strip()
        return {
            'id': obj.educator.id,
            'username': obj.educator.username,
            'display_name': display_name or obj.educator.username,
        }

    def get_student_count(self, obj):
        return obj.students.count()


class CourseRosterSerializer(CourseSerializer):
    students = UserSerializer(many=True, read_only=True)