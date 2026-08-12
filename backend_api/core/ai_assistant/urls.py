from django.urls import path
from . import views

urlpatterns = [
    path('ask/', views.AskSAGEView.as_view(), name='ask_sage'),
    path('sessions/', views.SessionListView.as_view(), name='session_list'),
    path('sessions/<int:session_id>/history/', views.SessionHistoryView.as_view(), name='session_history'),
    path('generate-quiz/', views.GenerateQuizView.as_view(), name='generate_quiz'),
    path('quizzes/', views.QuizListView.as_view(), name='quiz_list'),
    path('quizzes/<int:quiz_id>/', views.QuizDetailView.as_view(), name='quiz_detail'),
]