from django.urls import path
from . import views

urlpatterns = [
    path('create/', views.CreateGameView.as_view(), name='create-game'),
    path('join/', views.JoinGameView.as_view(), name='join-game'),
    path('start/', views.StartGameView.as_view(), name='start-game'),
    path('answer/', views.AnswerQuestionView.as_view(), name='answer-question'),
    path('finish/', views.FinishGameView.as_view(), name='finish-game'),
]