from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from . import views

urlpatterns = [
    # --- Authentication Routes ---
    path('register/', views.RegisterUserView.as_view(), name='register'),
    path('login/', TokenObtainPairView.as_view(), name='token_obtain_pair'), # This is your login!
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    
    path('me/', views.CurrentUserProfileView.as_view(), name='current_user_profile'),

    # --- Gamification Routes ---
    path('me/check-in/', views.CheckInView.as_view(), name='daily_check_in'),
    path('me/complete-quiz/', views.CompleteQuizView.as_view(), name='complete_quiz'),
    path('me/complete-lesson/', views.CompleteLessonView.as_view(), name='complete_lesson'),
    path('me/progress/', views.MyProgressView.as_view(), name='my_progress'),
    path('leaderboard/', views.LeaderboardView.as_view(), name='leaderboard'),

    # --- User Data Routes ---
    path('<int:user_id>/', views.user_detail, name='user_detail'),
    path('<int:user_id>/recommendations/', views.user_recommendations, name='user_recommendations'),
    path('<int:user_id>/sessions/', views.user_sessions, name='user_sessions'),
    path('<int:user_id>/activities/', views.user_activities, name='user_activities'),
    path('<int:user_id>/badges/', views.user_badges, name='user_badges'),

    path('groups/create/', views.CreateGroupView.as_view(), name='create_group'),
    path('groups/join/', views.JoinGroupView.as_view(), name='join_group'),
    path('groups/mine/', views.MyGroupsView.as_view(), name='my_groups'),
    path('groups/<str:group_id>/chat/', views.GroupChatView.as_view(), name='group_chat'),
    path('groups/<str:group_id>/chat/<str:message_id>/reactions/', views.GroupChatReactionView.as_view(), name='group_chat_reactions'),

    path('courses/create/', views.CreateCourseView.as_view(), name='create_course'),
    path('courses/mine/', views.MyCoursesView.as_view(), name='my_courses'),
    path('courses/enrolled/', views.EnrolledCoursesView.as_view(), name='enrolled_courses'),
    path('courses/join/', views.JoinCourseView.as_view(), name='join_course'),
    path('courses/<int:course_id>/', views.CourseDetailView.as_view(), name='course_detail'),
    path('courses/<int:course_id>/add-student/', views.AddStudentToCourseView.as_view(), name='course_add_student'),
    path('courses/<int:course_id>/remove-student/', views.RemoveStudentFromCourseView.as_view(), name='course_remove_student'),

    # --- Learning Path ---
    path('courses/<int:course_id>/topics/', views.CourseTopicsView.as_view(), name='course_topics'),
    path('courses/<int:course_id>/path/', views.CoursePathView.as_view(), name='course_path'),
    path('courses/<int:course_id>/topics/create/', views.TopicCreateView.as_view(), name='topic_create'),
    path('courses/<int:course_id>/generate-topic/', views.GenerateTopicView.as_view(), name='generate_topic'),
    path('topics/<int:topic_id>/nodes/create/', views.NodeCreateView.as_view(), name='node_create'),
    path('topics/<int:topic_id>/mistakes/', views.TopicMistakesView.as_view(), name='topic_mistakes'),
    path('nodes/<int:node_id>/', views.NodeDetailView.as_view(), name='node_detail'),
    path('nodes/<int:node_id>/complete/', views.CompleteNodeView.as_view(), name='node_complete'),

    path('test-xp/', views.AddXpTestView.as_view(), name='add_xp_test'),
    path('test-model-config/', views.TestModelConfigView.as_view(), name='test_model_config'),
    path('lessons/generate/', views.generate_lesson, name='generate_lesson'),

    path('firebase-login/', views.FirebaseLoginView.as_view(), name='firebase_login'),
    path('firebase-login/verify-otp/', views.FirebaseLoginVerifyOtpView.as_view(), name='firebase_login_verify_otp'),

    # --- Superadmin (global scope) ---
    path('superadmin/analytics/', views.SuperadminAnalyticsView.as_view(), name='superadmin_analytics'),
    path('superadmin/schools/<int:school_id>/admins/', views.SuperadminSchoolAdminCreateView.as_view(), name='superadmin_school_admin_create'),
    path('superadmin/schools/<int:school_id>/', views.SuperadminSchoolDetailView.as_view(), name='superadmin_school_detail'),
    path('superadmin/schools/', views.SuperadminSchoolListView.as_view(), name='superadmin_schools'),
    path('superadmin/users/<int:user_id>/', views.SuperadminUserDetailView.as_view(), name='superadmin_user_detail'),
    path('superadmin/users/', views.SuperadminUserListView.as_view(), name='superadmin_users'),

    # --- Admin (school-scoped) ---
    path('schools/<int:school_id>/users/<int:user_id>/role/', views.AdminUserRoleView.as_view(), name='admin_user_role'),
    path('schools/<int:school_id>/users/<int:user_id>/', views.AdminUserDetailView.as_view(), name='admin_user_detail'),
    path('schools/<int:school_id>/role-logs/', views.SchoolRoleChangeLogView.as_view(), name='school_role_logs'),
    path('schools/<int:school_id>/users/', views.AdminUserListView.as_view(), name='admin_users'),
    
]
