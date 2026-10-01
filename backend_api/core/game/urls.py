from django.urls import path
from . import views

urlpatterns = [
    path('create/', views.CreateGameView.as_view(), name='create-game'),
    path('join/', views.JoinGameView.as_view(), name='join-game'),
    path('set-quiz/', views.SetQuizView.as_view(), name='set-quiz'),
    path('start/', views.StartGameView.as_view(), name='start-game'),
    path('answer/', views.AnswerQuestionView.as_view(), name='answer-question'),
    path('finish/', views.FinishGameView.as_view(), name='finish-game'),
    path('teams/assign/', views.AssignTeamView.as_view(), name='assign-team'),
    path('teams/add/', views.AddTeamView.as_view(), name='add-team'),
    path('teams/rename/', views.RenameTeamView.as_view(), name='rename-team'),
    path('teams/auto-assign/', views.AutoAssignTeamsView.as_view(), name='auto-assign-teams'),
    path('host/claim/', views.HostClaimView.as_view(), name='host-claim'),
    path('teams/boost/', views.BoostTeammateView.as_view(), name='boost-teammate'),
    path('powerups/freeze/', views.FreezeTimerView.as_view(), name='freeze-timer'),
    path('react/', views.ReactToGameView.as_view(), name='react'),
    path('rooms/<str:room_code>/leaderboard/', views.RoomLeaderboardView.as_view(), name='room-leaderboard'),
    path('offline-results/', views.OfflineResultsView.as_view(), name='offline-results'),
]