from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers
from .models import Badge, Recommendation, Session, Activity, Course, User, RoleChangeLog, Topic, LearningNode, NodeProgress, ClassActivity, TaskSubmission, TaskSubmissionFile, ClassActivityAttachment
# --- Your Related Serializers (Unchanged, these are great!) ---
from django.contrib.auth import get_user_model


# Keys of the system-provided profile pictures (same set as the mobile app,
# see mobile_app/constants/pfps.ts). Empty string = initials fallback.
AVATAR_KEYS = {
    'bear', 'bear2', 'beaver', 'cat', 'chicken', 'duck', 'giraffe', 'hen',
    'hippopotamus', 'meerkat', 'panda', 'penguin', 'polar-bear', 'rabbit',
    'sea-lion', 'shark', 'sloth',
}


class BadgeSerializer(serializers.ModelSerializer):
    course_name = serializers.SerializerMethodField()

    class Meta:
        model = Badge
        fields = ['id', 'icon', 'name', 'earned_at', 'course', 'course_name']

    def get_course_name(self, obj):
        return obj.course.name if obj.course else None


class UserProfileSerializer(serializers.ModelSerializer):
    next_level_xp = serializers.SerializerMethodField()
    badges = BadgeSerializer(many=True, read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', # 🌟 Unhidden here!
            'role', 'firebase_uid',
            'avatar',
            'is_student', 'is_educator', 'level', 'current_xp',
            'next_level_xp', 'total_points', 'streak',
            'courses_completed', 'study_hours', 'quizzes_taken',
            'group_activities_count', 'badges', 'date_joined'
        ]
        read_only_fields = ['id', 'email', 'date_joined', 'role', 'firebase_uid']

    def validate_username(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Username is required.')
        return value

    def validate_avatar(self, value):
        value = (value or '').strip()
        if value and value not in AVATAR_KEYS:
            raise serializers.ValidationError('Unknown avatar.')
        return value

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
        fields = ['id', 'title', 'description', 'activity_type', 'created_at', 'kind', 'xp_earned', 'course_name', 'payload']

# --- Updated User Serializers ---

# Use this when you want to send profile data to the mobile app
class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        # Fixed field names to match the actual User model
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'role', 'is_student', 'is_educator', 'level', 'current_xp', 'total_points', 'streak', 'courses_completed', 'study_hours', 'quizzes_taken', 'group_activities_count']

# Use this ONLY when a brand new user is signing up.
# Role is NEVER accepted from the client — it is assigned server-side.
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
            email=validated_data.get('email', ''),
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


class ClassActivityAttachmentListSerializer(serializers.ModelSerializer):
    """Attachment metadata only (no file bytes) for list views."""
    activity = serializers.IntegerField(source='activity_id', read_only=True)

    class Meta:
        model = ClassActivityAttachment
        fields = [
            'id', 'activity', 'file_name', 'file_mime', 'file_size', 'created_at',
        ]
        read_only_fields = fields


class ClassActivityAttachmentSerializer(serializers.ModelSerializer):
    """Full attachment, including file bytes (base64 over the wire)."""
    activity = serializers.IntegerField(source='activity_id', read_only=True)

    class Meta:
        model = ClassActivityAttachment
        fields = [
            'id', 'activity', 'file_name', 'file_mime', 'file_size', 'file_data', 'created_at',
        ]
        read_only_fields = fields


class TaskSubmissionFileListSerializer(serializers.ModelSerializer):
    """Submission-file metadata only (no file bytes) for list views."""

    class Meta:
        model = TaskSubmissionFile
        fields = [
            'id', 'file_name', 'file_mime', 'file_size', 'created_at',
        ]
        read_only_fields = fields


class TaskSubmissionFileSerializer(serializers.ModelSerializer):
    """Full submission file, including bytes (base64 over the wire)."""

    class Meta:
        model = TaskSubmissionFile
        fields = [
            'id', 'file_name', 'file_mime', 'file_size', 'file_data', 'created_at',
        ]
        read_only_fields = fields


# --- Class Activities (teacher-set academic tasks) ---

class ClassActivitySerializer(serializers.ModelSerializer):
    course = serializers.IntegerField(source='course_id', read_only=True)
    course_name = serializers.SerializerMethodField()
    submission_count = serializers.SerializerMethodField()
    graded_count = serializers.SerializerMethodField()
    attachments = ClassActivityAttachmentListSerializer(many=True, read_only=True)

    class Meta:
        model = ClassActivity
        fields = [
            'id', 'course', 'course_name', 'kind', 'title',
            'ref_id', 'note', 'due_date', 'status', 'created_at',
            'max_points', 'allow_multiple_files',
            'submission_count', 'graded_count',
            'attachments',
        ]
        read_only_fields = [
            'id', 'course', 'course_name', 'created_at',
            'submission_count', 'graded_count', 'attachments',
        ]

    def get_course_name(self, obj):
        return obj.course.name

    def get_submission_count(self, obj):
        return obj.submissions.count()

    def get_graded_count(self, obj):
        return obj.submissions.exclude(score__isnull=True).count()

    def to_internal_value(self, data):
        # A multipart form can only send strings, so a client that wants to
        # clear an optional field has to send a blank value. Treat that as
        # null instead of failing validation on an empty datetime.
        if hasattr(data, 'dict'):
            data = data.dict()
        if isinstance(data, dict):
            data = data.copy()
            for field in ('due_date', 'ref_id'):
                if data.get(field) == '':
                    data[field] = None
        return super().to_internal_value(data)

    def validate_due_date(self, value):
        if value is None:
            return value
        if value < timezone.now() - timedelta(days=365):
            raise serializers.ValidationError('Due date is too far in the past.')
        return value

    def validate_max_points(self, value):
        if value < 1:
            raise serializers.ValidationError('Points must be at least 1.')
        return value


class TaskSubmissionSerializer(serializers.ModelSerializer):
    """Full submission, including file bytes (base64 over the wire)."""
    activity = serializers.IntegerField(source='activity_id', read_only=True)
    student_id = serializers.IntegerField(read_only=True)
    student_name = serializers.SerializerMethodField()
    max_points = serializers.IntegerField(source='activity.max_points', read_only=True)
    graded_by_name = serializers.SerializerMethodField()
    is_late = serializers.BooleanField(read_only=True)
    files = TaskSubmissionFileListSerializer(many=True, read_only=True)

    class Meta:
        model = TaskSubmission
        fields = [
            'id', 'activity', 'student_id', 'student_name',
            'description', 'files', 'is_late',
            'submitted_at',
            'score', 'feedback', 'graded_at', 'graded_by', 'graded_by_name', 'max_points',
        ]
        read_only_fields = fields

    def get_student_name(self, obj):
        display_name = f"{obj.student.first_name} {obj.student.last_name}".strip()
        return display_name or obj.student.username

    def get_graded_by_name(self, obj):
        if obj.graded_by:
            display_name = f"{obj.graded_by.first_name} {obj.graded_by.last_name}".strip()
            return display_name or obj.graded_by.username
        return None


class TaskSubmissionListSerializer(serializers.ModelSerializer):
    """Submission metadata only (no file bytes) for list views."""
    activity = serializers.IntegerField(source='activity_id', read_only=True)
    student_id = serializers.IntegerField(read_only=True)
    student_name = serializers.SerializerMethodField()
    max_points = serializers.IntegerField(source='activity.max_points', read_only=True)
    is_late = serializers.BooleanField(read_only=True)
    files = TaskSubmissionFileListSerializer(many=True, read_only=True)

    class Meta:
        model = TaskSubmission
        fields = [
            'id', 'activity', 'student_id', 'student_name',
            'description', 'files', 'is_late',
            'submitted_at',
            'score', 'feedback', 'graded_at', 'graded_by', 'max_points',
        ]
        read_only_fields = fields

    def get_student_name(self, obj):
        display_name = f"{obj.student.first_name} {obj.student.last_name}".strip()
        return display_name or obj.student.username


# --- Superadmin Serializers ---

class SuperadminUserUpdateSerializer(serializers.ModelSerializer):
    role = serializers.ChoiceField(choices=['student', 'educator', 'superadmin'], required=False)
    is_active = serializers.BooleanField(required=False)

    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'email', 'role', 'is_active']


class SuperadminCreateUserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    role = serializers.ChoiceField(choices=['student', 'educator', 'superadmin'], default='student')

    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'first_name', 'last_name', 'role']

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

    def to_internal_value(self, data):
        data = dict(data)
        valid_types = {choice[0] for choice in LearningNode.NODE_TYPES}
        if data.get('node_type') not in valid_types:
            data['node_type'] = 'learn'
        for field in ('xp_reward', 'required_score', 'estimated_minutes'):
            value = data.get(field)
            if value is not None:
                try:
                    data[field] = int(float(value))
                except (TypeError, ValueError):
                    pass
        title = data.get('title')
        if title is not None:
            data['title'] = str(title)[:255]
        return super().to_internal_value(data)


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
