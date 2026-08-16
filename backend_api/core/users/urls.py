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

    path('test-xp/', views.AddXpTestView.as_view(), name='add_xp_test'),
    path('test-model-config/', views.TestModelConfigView.as_view(), name='test_model_config'),
    path('lessons/generate/', views.generate_lesson, name='generate_lesson'),

    path('firebase-login/', views.FirebaseLoginView.as_view(), name='firebase_login'),

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
