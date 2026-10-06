from django.conf import settings
from django.db import models


class GameRoom(models.Model):
    """
    Durable archive of a hosted multiplayer game.

    Live room state stays in Firestore -- it is the real-time layer the phone
    apps read and write, and the backend is the only writer. But Firestore
    rooms are addressed only by document id (the room code), so there is no
    query that can answer "which games did this educator run for this class",
    and nothing survives a rematch: RematchView deletes `finishedAt` and
    `teamResults`. This row is the historical record.

    It is an archive, not a mirror: Firestore stays authoritative for a game
    in progress, and this row is only useful once the game is over.
    """

    STATUS_WAITING = 'waiting'
    STATUS_ACTIVE = 'active'
    STATUS_FINISHED = 'finished'
    STATUS_CHOICES = [
        (STATUS_WAITING, 'Waiting'),
        (STATUS_ACTIVE, 'In progress'),
        (STATUS_FINISHED, 'Finished'),
    ]

    room_code = models.CharField(max_length=16, unique=True)

    # Mirrors the Firestore room's immutable `ownerId`, NOT `hostId`. `hostId`
    # moves to another user when a host hands the room over (HostClaimView), so
    # keying history on it would make a room disappear from the educator's
    # history the moment it was handed over.
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='hosted_game_rooms',
    )

    # SET_NULL: deleting a course must not delete the game's history.
    course = models.ForeignKey(
        'users.Course',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='game_rooms',
    )

    # A bare id, not an FK, matching OfflineGameResult.quiz_id. A deleted or
    # transferred quiz must not cascade into, or invalidate, a past game.
    quiz_id = models.IntegerField(null=True, blank=True)

    topic = models.CharField(max_length=255, blank=True, default='')
    mode = models.CharField(max_length=20, blank=True, default='classic')
    team_mode = models.BooleanField(default=False)
    question_count = models.IntegerField(default=0)
    time_per_question = models.IntegerField(default=15)
    player_count = models.IntegerField(default=0)

    # The host is recorded separately from the results because an educator host
    # is deliberately excluded from the standings (see FinishGameView.
    # _get_standings), so the results alone cannot say who ran the game.
    host_name = models.CharField(max_length=255, blank=True, default='')

    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_WAITING,
    )

    # Settled results, shaped like Activity.payload['results'] so the app can
    # feed both to the same ActivityResultsView: {'mode', 'roomCode',
    # 'questionCount', and either 'participants' or 'teams'}.
    final_payload = models.JSONField(null=True, blank=True)

    # A rematch reuses the room code, so the first round's results are copied
    # here instead of being overwritten. Only the latest round is ever in
    # final_payload.
    previous_round = models.JSONField(null=True, blank=True)
    previous_round_finished_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            # The course Games tab reads exactly this shape.
            models.Index(fields=['course', '-created_at']),
            models.Index(fields=['owner', '-created_at']),
        ]

    def __str__(self):
        return f"{self.room_code} - {self.topic} ({self.status})"


class OfflineGameResult(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='offline_game_results',
    )
    session_key = models.CharField(max_length=64, unique=True)
    quiz_id = models.IntegerField(null=True, blank=True)
    quiz_title = models.CharField(max_length=255, blank=True, default='')
    quiz_type = models.CharField(max_length=50, blank=True, default='')
    time_per_question = models.IntegerField(default=15)
    score = models.IntegerField(default=0)
    correct_count = models.IntegerField(default=0)
    answered_count = models.IntegerField(default=0)
    total_questions = models.IntegerField(default=0)
    completed_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-completed_at']

    def __str__(self):
        return f"{self.user} - {self.quiz_title} ({self.score})"
