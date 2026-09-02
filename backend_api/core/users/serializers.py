from rest_framework import serializers
from .models import Badge, Recommendation, Session, Activity, Course, School, User, RoleChangeLog, Topic, LearningNode, NodeProgress
# --- Your Related Serializers (Unchanged, these are great!) ---
from django.contrib.auth import get_user_model


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
            'role', 'school_id', 'firebase_uid',
            'is_student', 'is_educator', 'is_admin', 'level', 'current_xp', 
            'next_level_xp', 'total_points', 'streak',
            'courses_completed', 'study_hours', 'quizzes_taken', 
            'group_activities_count', 'badges', 'date_joined'
        ]
        read_only_fields = ['id', 'username', 'email', 'date_joined', 'role', 'school_id', 'firebase_uid']
        
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
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'role', 'school_id', 'is_student', 'is_educator', 'is_admin', 'level', 'current_xp', 'total_points', 'streak', 'courses_completed', 'study_hours', 'quizzes_taken', 'group_activities_count']

# Use this ONLY when a brand new user is signing up.
# Role and school are NEVER accepted from the client — they are assigned server-side.
class UserRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True) # Hides the password from the API response

    class Meta:
        model = User
        # 🌟 Added first_name and last_name here so the API accepts them
        fields = ['username', 'email', 'password', 'first_name', 'last_name']
        extra_kwargs = {'password': {'write_only': True}}

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''), # 🌟 Safely grab the first name
            last_name=validated_data.get('last_name', ''),   # 🌟 Safely grab the last name
            role='student',
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


# --- School / Admin / Superadmin Serializers ---

class SchoolSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = School
        fields = ['id', 'name', 'address', 'contact_email', 'contact_phone', 'is_active', 'created_at', 'member_count']
        read_only_fields = ['id', 'created_at', 'member_count']


class SchoolCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = School
        fields = ['name', 'address', 'contact_email', 'contact_phone']
        extra_kwargs = {
            'address': {'required': False, 'allow_blank': True},
            'contact_email': {'required': False, 'allow_blank': True},
            'contact_phone': {'required': False, 'allow_blank': True},
        }


class SchoolAdminCreateSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError('A user with that username already exists.')
        return value

    def create(self, validated_data):
        school = self.context['school']
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            role='admin',
            school=school,
        )
        return user


class AdminUserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8, required=False)
    role = serializers.ChoiceField(choices=['student', 'educator'], default='student')

    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'first_name', 'last_name', 'role']

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        validated_data['school'] = self.context['school']
        user = User.objects.create_user(**validated_data)
        if password:
            user.set_password(password)
            user.save(update_fields=['password'])
        return user


class AdminUserUpdateSerializer(serializers.ModelSerializer):
    is_active = serializers.BooleanField(required=False)

    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'email', 'is_active']


class AdminRoleUpdateSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=['student', 'educator', 'admin'])


class SuperadminUserUpdateSerializer(serializers.ModelSerializer):
    role = serializers.ChoiceField(choices=['student', 'educator', 'admin', 'superadmin'], required=False)
    school = serializers.PrimaryKeyRelatedField(queryset=School.objects.all(), required=False, allow_null=True)
    is_active = serializers.BooleanField(required=False)

    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'email', 'role', 'school', 'is_active']


class SuperadminCreateUserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    role = serializers.ChoiceField(choices=['student', 'educator', 'admin', 'superadmin'], default='student')
    school = serializers.PrimaryKeyRelatedField(queryset=School.objects.all(), required=False, allow_null=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'first_name', 'last_name', 'role', 'school']

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError('A user with that username already exists.')
        return value

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('A user with that email already exists.')
        return value

    def create(self, validated_data):
        role = validated_data.pop('role', 'student')
        password = validated_data.pop('password')
        school = validated_data.pop('school', None)
        if role == 'superadmin':
            # create_superuser (via SageUserManager) sets role='superadmin',
            # is_staff=True and is_superuser=True.
            return User.objects.create_superuser(
                username=validated_data['username'],
                email=validated_data['email'],
                password=password,
                first_name=validated_data.get('first_name', ''),
                last_name=validated_data.get('last_name', ''),
            )
        return User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=password,
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            role=role,
            school=school,
        )


class RoleChangeLogSerializer(serializers.ModelSerializer):
    changed_by_username = serializers.CharField(source='changed_by.username', read_only=True)
    target_username = serializers.CharField(source='target_user.username', read_only=True)

    class Meta:
        model = RoleChangeLog
        fields = ['id', 'changed_by', 'changed_by_username', 'target_user', 'target_username', 'from_role', 'to_role', 'created_at']


# --- Learning Path Serializers ---

class TopicSerializer(serializers.ModelSerializer):
    node_count = serializers.SerializerMethodField()

    class Meta:
        model = Topic
        fields = ['id', 'course', 'title', 'description', 'order', 'node_count', 'created_at']
        read_only_fields = ['created_at', 'course']

    def get_node_count(self, obj):
        return obj.nodes.count()


class LearningNodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LearningNode
        fields = ['id', 'topic', 'node_type', 'title', 'description', 'content_json', 'order', 'xp_reward', 'required_score', 'estimated_minutes', 'created_at']
        read_only_fields = ['created_at', 'topic']


class NodeProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model = NodeProgress
        fields = ['id', 'user', 'node', 'score', 'passed', 'completed_at', 'attempts', 'updated_at']
        read_only_fields = ['completed_at', 'updated_at']


class CoursePathTopicSerializer(serializers.ModelSerializer):
    """Topic with nested nodes and user progress — used in the course path endpoint."""
    nodes = serializers.SerializerMethodField()

    class Meta:
        model = Topic
        fields = ['id', 'title', 'description', 'order', 'nodes']

    def get_nodes(self, obj):
        request = self.context.get('request')
        user = request.user if request else None
        nodes = obj.nodes.all()
        result = []
        for node in nodes:
            node_data = LearningNodeSerializer(node).data
            if user:
                try:
                    progress = NodeProgress.objects.get(user=user, node=node)
                    node_data['progress'] = NodeProgressSerializer(progress).data
                except NodeProgress.DoesNotExist:
                    node_data['progress'] = None
            result.append(node_data)
        return result
