from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from . import views

urlpatterns = [
    # --- Authentication Routes ---
    path('register/', views.RegisterUserView.as_view(), name='register'),
    path('login/', TokenObtainPairView.as_view(), name='token_obtain_pair'), # This is your login!
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    
    path('me/', views.CurrentUserProfileView.as_view(), name='current_user_profile'),

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

    path('courses/create/', views.CreateCourseView.as_view(), name='create_course'),
    path('courses/mine/', views.MyCoursesView.as_view(), name='my_courses'),
    path('courses/enrolled/', views.EnrolledCoursesView.as_view(), name='enrolled_courses'),
    path('courses/join/', views.JoinCourseView.as_view(), name='join_course'),
    path('courses/<int:course_id>/', views.CourseDetailView.as_view(), name='course_detail'),
    path('courses/<int:course_id>/add-student/', views.AddStudentToCourseView.as_view(), name='course_add_student'),
    path('courses/<int:course_id>/remove-student/', views.RemoveStudentFromCourseView.as_view(), name='course_remove_student'),

    path('test-xp/', views.AddXpTestView.as_view(), name='add_xp_test'),
    path('test-model-config/', views.TestModelConfigView.as_view(), name='test_model_config'),
    path('lessons/generate/', views.generate_lesson, name='generate_lesson'),

    path('firebase-login/', views.FirebaseLoginView.as_view(), name='firebase_login'),
    
]
