from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from users.models import Activity, Course, User
from ai_assistant.models import Quiz, QuizQuestion
from game.test_firestore_fake import FakeFirestoreClient
from users.gamification import GAME_DEFAULT_XP, GAME_PLACEMENT_XP


class TeamModeGameTests(TestCase):
    def setUp(self):
        self.host = User.objects.create_user(username='host', password='pass')
        self.player2 = User.objects.create_user(username='player2', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        self.mock_firestore = patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()

    def make_quiz(self, user, question_count=4):
        quiz = Quiz.objects.create(user=user, title='Team Test Quiz')
        for i in range(question_count):
            QuizQuestion.objects.create(
                quiz=quiz,
                question_text=f'Question {i + 1}',
                options=['one', 'two', 'three', 'four'],
                correct_answer='one',
                explanation='',
            )
        return quiz

    def create_team_room(self, team_count=2, question_count=4):
        quiz = self.make_quiz(self.host, question_count)
        self.client.force_authenticate(user=self.host)
        return self.client.post(reverse('create-game'), {
            'quizId': quiz.id,
            'teamMode': 'true',
            'teamCount': str(team_count),
        }, format='json')

    def seed_team_room(self, room_code='ABC123'):
        room_ref = self.store.collection('gameRooms').document(room_code)
        room_ref.set({
            'status': 'active',
            'hostId': self.host.id,
            'teamMode': True,
            'teamCount': 2,
            'maxTeamSize': 10,
            'timePerQuestion': 15,
            'questions': [
                {'type': 'mcq', 'question': 'What is 2+2?', 'choices': ['A. 4', 'B. 5', 'C. 6', 'D. 7'], 'correctAnswer': 'A. 4'},
                {'type': 'mcq', 'question': 'What is 1+1?', 'choices': ['A. 2', 'B. 3', 'C. 4', 'D. 5'], 'correctAnswer': 'A. 2'},
            ],
        })
        teams_ref = room_ref.collection('teams')
        teams_ref.document('1').set({
            'name': 'Team 1', 'color': '#22D3EE', 'score': 0,
            'correctCount': 0, 'answeredCount': 0,
            'memberIds': [str(self.player2.id)], 'memberCount': 1,
        })
        teams_ref.document('2').set({
            'name': 'Team 2', 'color': '#10B981', 'score': 0,
            'correctCount': 0, 'answeredCount': 0,
            'memberIds': [], 'memberCount': 0,
        })
        player_ref = room_ref.collection('players').document(str(self.player2.id))
        player_ref.set({
            'displayName': 'Player 2', 'score': 0, 'answeredCount': 0,
            'questionOrder': [0, 1], 'isReady': True, 'isFinished': False,
            'teamId': '1',
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        return room_ref

    def test_create_team_room_persists_teams(self):
        resp = self.create_team_room(team_count=3, question_count=4)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['teamMode'])
        self.assertEqual(len(body['teams']), 3)
        self.assertEqual(body['teams'][0]['name'], 'Team 1')

        room_ref = self.store.collection('gameRooms').document(body['roomCode'])
        room = room_ref.get().to_dict()
        self.assertTrue(room['teamMode'])
        self.assertEqual(room['teamCount'], 3)
        # maxTeamSize is ceil(MAX_PLAYERS / teamCount). 60 players over 3 teams
        # is 20 each -- previously MAX_PLAYERS was 20, so this was 7 and a
        # 40-student class would have been split into teams of 7.
        self.assertEqual(room['maxTeamSize'], 20)

        teams = list(room_ref.collection('teams').stream())
        by_id = {t.id: t.to_dict() for t in teams}
        self.assertEqual(len(by_id), 3)
        self.assertEqual(by_id['1']['name'], 'Team 1')
        self.assertEqual(by_id['1']['color'], '#22D3EE')
        self.assertEqual(by_id['2']['color'], '#10B981')
        self.assertEqual(by_id['3']['color'], '#F59E0B')

        player = room_ref.collection('players').document(str(self.host.id)).get().to_dict()
        self.assertIsNone(player['teamId'])

    def test_create_room_stores_host_name(self):
        # Rooms carry hostName so the dashboard's live-rooms list can show
        # who is hosting without a separate user lookup.
        quiz = self.make_quiz(self.host, 2)
        self.client.force_authenticate(user=self.host)
        resp = self.client.post(reverse('create-game'), {
            'quizId': quiz.id,
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        room_code = resp.json()['roomCode']
        room = self.store.collection('gameRooms').document(room_code).get().to_dict()
        self.assertEqual(room['hostId'], self.host.id)
        self.assertEqual(room['hostName'], 'host')  # username fallback (no first/last name)

    def test_create_team_count_validation(self):
        self.client.force_authenticate(user=self.host)
        resp = self.client.post(reverse('create-game'), {
            'teamMode': 'true', 'teamCount': '21',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('teamCount', resp.json()['error'])

    def test_create_rejects_team_count_above_max_teams(self):
        # 20 teams is the cap (one colour per team), not MAX_PLAYERS.
        self.client.force_authenticate(user=self.host)
        resp = self.client.post(reverse('create-game'), {
            'teamMode': 'true', 'teamCount': '21',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        # The message is interpolated, so it names the real cap rather than a
        # hardcoded 20 that silently went stale when the constants split.
        self.assertIn('20', resp.json()['error'])

    def test_create_not_enough_questions(self):
        self.client.force_authenticate(user=self.host)
        quiz = self.make_quiz(self.host, 2)
        resp = self.client.post(reverse('create-game'), {
            'quizId': quiz.id, 'teamMode': 'true', 'teamCount': '4',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Not enough questions', resp.json()['error'])

    def test_join_returns_teams(self):
        resp = self.create_team_room(team_count=2)
        room_code = resp.json()['roomCode']

        self.client.force_authenticate(user=self.player2)
        resp = self.client.post(reverse('join-game'), {'roomCode': room_code}, format='json')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['teamMode'])
        self.assertEqual(len(body['teams']), 2)

        player = self.store.collection('gameRooms').document(room_code) \
            .collection('players').document(str(self.player2.id)).get().to_dict()
        self.assertIsNone(player['teamId'])

    def test_start_requires_all_players_assigned(self):
        resp = self.create_team_room(team_count=2)
        room_code = resp.json()['roomCode']
        room_ref = self.store.collection('gameRooms').document(room_code)

        room_ref.collection('players').document(str(self.host.id)).update({'teamId': '1'})

        self.client.force_authenticate(user=self.player2)
        self.client.post(reverse('join-game'), {'roomCode': room_code}, format='json')

        self.client.force_authenticate(user=self.host)
        resp = self.client.post(reverse('start-game'), {'roomCode': room_code}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('team', resp.json()['error'])

        room_ref.collection('players').document(str(self.player2.id)).update({'teamId': '2'})
        resp = self.client.post(reverse('start-game'), {'roomCode': room_code}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(room_ref.get().to_dict()['status'], 'active')

    def test_team_answer_scores_once(self):
        room_ref = self.seed_team_room()
        teams_ref = room_ref.collection('teams')
        url = reverse('answer-question')

        self.client.force_authenticate(user=self.player2)
        resp = self.client.post(url, {
            'roomCode': 'ABC123', 'questionIndex': 0, 'answer': 'A. 4', 'timeTaken': '1',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['correct'])

        player = room_ref.collection('players').document(str(self.player2.id)).get().to_dict()
        team = teams_ref.document('1').get().to_dict()
        self.assertEqual(player['answeredCount'], 1)
        self.assertEqual(player['score'], team['score'])
        self.assertGreater(team['score'], 0)
        self.assertEqual(team['correctCount'], 1)
        self.assertEqual(team['answeredCount'], 1)
        self.assertEqual(teams_ref.document('2').get().to_dict()['score'], 0)

    def test_team_answer_idempotent_retry(self):
        room_ref = self.seed_team_room()
        url = reverse('answer-question')
        payload = {'roomCode': 'ABC123', 'questionIndex': 0, 'answer': 'A. 4', 'timeTaken': '1'}

        self.client.force_authenticate(user=self.player2)
        self.client.post(url, payload, format='json')
        resp2 = self.client.post(url, payload, format='json')
        self.assertEqual(resp2.status_code, 200)

        team = room_ref.collection('teams').document('1').get().to_dict()
        self.assertEqual(team['answeredCount'], 1)
        self.assertEqual(team['correctCount'], 1)
        player = room_ref.collection('players').document(str(self.player2.id)).get().to_dict()
        self.assertEqual(player['answeredCount'], 1)
        self.assertEqual(team['score'], player['score'])

    def test_team_wrong_answer_only_counts_attempt(self):
        room_ref = self.seed_team_room()
        self.client.force_authenticate(user=self.player2)
        resp = self.client.post(reverse('answer-question'), {
            'roomCode': 'ABC123', 'questionIndex': 1, 'answer': 'A. 9', 'timeTaken': '1',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['correct'])

        team = room_ref.collection('teams').document('1').get().to_dict()
        self.assertEqual(team['answeredCount'], 1)
        self.assertEqual(team['correctCount'], 0)
        self.assertEqual(team['score'], 0)

    def test_finish_snapshots_team_results_sorted(self):
        room_ref = self.store.collection('gameRooms').document('FINAL1')
        room_ref.set({
            'status': 'active', 'hostId': self.host.id, 'teamMode': True,
            'topic': 't', 'questionCount': 1, 'questions': [],
        })
        teams_ref = room_ref.collection('teams')
        teams_ref.document('1').set({
            'name': 'Team 1', 'color': '#22D3EE', 'score': 300,
            'correctCount': 1, 'answeredCount': 1, 'memberIds': [], 'memberCount': 0,
        })
        teams_ref.document('2').set({
            'name': 'Team 2', 'color': '#10B981', 'score': 800,
            'correctCount': 2, 'answeredCount': 2, 'memberIds': [], 'memberCount': 0,
        })
        room_ref.collection('players').document(str(self.host.id)).set({'isFinished': False})

        self.client.force_authenticate(user=self.host)
        resp = self.client.post(reverse('finish-game'), {'roomCode': 'FINAL1'}, format='json')
        self.assertEqual(resp.status_code, 200)

        room = room_ref.get().to_dict()
        self.assertEqual(room['status'], 'finished')
        results = room['teamResults']
        self.assertEqual([r['teamId'] for r in results], ['2', '1'])
        self.assertEqual(results[0]['score'], 800)
        self.assertEqual(results[1]['score'], 300)

    def test_finish_classic_room_has_no_team_results(self):
        room_ref = self.store.collection('gameRooms').document('SOLO1')
        room_ref.set({
            'status': 'active', 'hostId': self.host.id,
            'topic': 't', 'questionCount': 1, 'questions': [],
        })
        room_ref.collection('players').document(str(self.host.id)).set({'isFinished': False})

        self.client.force_authenticate(user=self.host)
        self.client.post(reverse('finish-game'), {'roomCode': 'SOLO1'}, format='json')

        room = room_ref.get().to_dict()
        self.assertEqual(room['status'], 'finished')
        self.assertNotIn('teamResults', room)

    def test_finish_logs_game_activity(self):
        self.client.force_authenticate(user=self.host)
        self.client.post(reverse('offline-results'), {
            'sessionKey': 'sess-1',
            'quizTitle': 'Math Sprint',
            'score': 80,
            'correctCount': 4,
            'totalQuestions': 5,
        }, format='json')
        activity = Activity.objects.get(user=self.host)
        self.assertEqual(activity.kind, 'offline_game')
        self.assertIn('Math Sprint', activity.title)
        self.assertEqual(activity.description, '4/5 correct · 80 pts')

    def test_offline_result_repost_does_not_duplicate_activity(self):
        payload = {
            'sessionKey': 'sess-1',
            'quizTitle': 'Math Sprint',
            'score': 80,
            'correctCount': 4,
            'totalQuestions': 5,
        }
        self.client.force_authenticate(user=self.host)
        self.client.post(reverse('offline-results'), payload, format='json')
        self.client.post(reverse('offline-results'), payload, format='json')
        self.assertEqual(Activity.objects.filter(user=self.host, kind='offline_game').count(), 1)


class PowerupRewardTests(TestCase):
    """Classic-mode streak rewards: a powerup is guaranteed on every
    STREAK_REWARD_INTERVAL-th consecutive correct answer. These constants
    mirror the rule in game/views.py; keep the two in sync."""

    STREAK_REWARD_INTERVAL = 3
    POWERUP_KEYS = ('freeze', 'hint', 'doublePoints', 'shield')
    ROOM_CODE = 'STREAK1'

    def setUp(self):
        self.host = User.objects.create_user(username='host', password='pass')
        self.player = User.objects.create_user(username='player', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.url = reverse('answer-question')

    def seed_room(self, question_count=8, powerups=None):
        """Seed a non-team classic room with a straight questionOrder so the
        player's own question index is predictable."""
        room_ref = self.store.collection('gameRooms').document(self.ROOM_CODE)
        room_ref.set({
            'status': 'active',
            'hostId': self.host.id,
            'teamMode': False,
            'timePerQuestion': 15,
            'questions': [
                {'type': 'mcq', 'question': f'Q{i}', 'choices': ['A. yes', 'B. no'], 'correctAnswer': 'A. yes'}
                for i in range(question_count)
            ],
        })
        player_ref = room_ref.collection('players').document(str(self.player.id))
        player_ref.set({
            'displayName': 'Player', 'score': 0, 'answeredCount': 0, 'streak': 0,
            'questionOrder': list(range(question_count)),
            'isReady': True, 'isFinished': False,
            'powerups': powerups or {k: 0 for k in self.POWERUP_KEYS},
        })
        return player_ref

    def answer(self, index, correct=True):
        self.client.force_authenticate(user=self.player)
        return self.client.post(self.url, {
            'roomCode': self.ROOM_CODE,
            'questionIndex': index,
            'answer': 'A. yes' if correct else 'B. no',
            'timeTaken': '1',
        }, format='json')

    def player_doc(self, player_ref):
        return player_ref.get().to_dict()

    def total_powerups(self, player_ref):
        data = self.player_doc(player_ref)
        return sum(data['powerups'].get(k, 0) for k in self.POWERUP_KEYS)

    def test_no_powerup_below_threshold(self):
        player_ref = self.seed_room()
        for i in range(self.STREAK_REWARD_INTERVAL - 1):
            resp = self.answer(i)
            self.assertTrue(resp.json()['correct'])
            self.assertIsNone(resp.json()['powerupEarned'])
        self.assertEqual(self.total_powerups(player_ref), 0)

    def test_powerup_guaranteed_at_threshold(self):
        player_ref = self.seed_room()
        for i in range(self.STREAK_REWARD_INTERVAL):
            resp = self.answer(i)
        body = resp.json()
        self.assertTrue(body['correct'])
        # Not a probability — this must be deterministic.
        self.assertIn(body['powerupEarned'], self.POWERUP_KEYS)
        self.assertEqual(self.total_powerups(player_ref), 1)
        self.assertEqual(self.player_doc(player_ref)['powerups'][body['powerupEarned']], 1)

    def test_powerup_every_nth_streak_only(self):
        interval = self.STREAK_REWARD_INTERVAL
        # One spare question so the second award is not on the final index,
        # which is deliberately never rewarded.
        player_ref = self.seed_room(question_count=interval * 2 + 1)
        awarded = []
        for i in range(interval * 2):
            body = self.answer(i).json()
            if body['powerupEarned']:
                awarded.append((i, body['powerupEarned']))

        # Exactly two awards, landing on the 3rd and 6th correct answers.
        self.assertEqual([i for i, _ in awarded], [interval - 1, interval * 2 - 1])
        self.assertEqual(self.total_powerups(player_ref), 2)
        self.assertEqual(self.player_doc(player_ref)['streak'], interval * 2)

    def test_wrong_answer_resets_streak_and_drops_reward(self):
        player_ref = self.seed_room()
        self.answer(0)
        self.answer(1)
        self.assertFalse(self.answer(2, correct=False).json()['correct'])
        # Streak restarted, so the 3rd correct answer is now question index 5.
        self.assertIsNone(self.answer(3).json()['powerupEarned'])
        self.assertIsNone(self.answer(4).json()['powerupEarned'])
        self.assertIsNotNone(self.answer(5).json()['powerupEarned'])
        self.assertEqual(self.total_powerups(player_ref), 1)

    def test_prefers_unowned_type(self):
        player_ref = self.seed_room(
            powerups={'freeze': 4, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        )
        for i in range(self.STREAK_REWARD_INTERVAL):
            resp = self.answer(i)
        earned = resp.json()['powerupEarned']
        self.assertNotEqual(earned, 'freeze')
        powerups = self.player_doc(player_ref)['powerups']
        self.assertEqual(powerups[earned], 1)
        self.assertEqual(powerups['freeze'], 4)

    def test_stacks_onto_rarest_when_all_owned(self):
        player_ref = self.seed_room(
            powerups={'freeze': 2, 'hint': 3, 'doublePoints': 5, 'shield': 3},
        )
        for i in range(self.STREAK_REWARD_INTERVAL):
            resp = self.answer(i)
        earned = resp.json()['powerupEarned']
        # Lowest count is freeze at 2, so that is what gets stacked.
        self.assertEqual(earned, 'freeze')
        powerups = self.player_doc(player_ref)['powerups']
        self.assertEqual(powerups['freeze'], 3)
        self.assertEqual(powerups['doublePoints'], 5)
        # No points consolation was substituted for the powerup: the score
        # must be exactly the base award with no extra bonus.
        per_answer = max(int(1000 * (1 - (1 / 15) * 0.5)), 500)
        self.assertEqual(
            self.player_doc(player_ref)['score'],
            self.STREAK_REWARD_INTERVAL * per_answer,
        )

    def test_no_powerup_on_last_question(self):
        count = 6
        player_ref = self.seed_room(question_count=count)
        for i in range(count - 1):
            self.answer(i)
        before = self.total_powerups(player_ref)
        resp = self.answer(count - 1)
        self.assertTrue(resp.json()['correct'])
        self.assertIsNone(resp.json()['powerupEarned'])
        self.assertEqual(self.total_powerups(player_ref), before)

    def test_retry_does_not_award_twice(self):
        player_ref = self.seed_room()
        interval = self.STREAK_REWARD_INTERVAL
        for i in range(interval - 1):
            self.assertIsNone(self.answer(i).json()['powerupEarned'])

        threshold = interval - 1
        self.assertIsNotNone(self.answer(threshold).json()['powerupEarned'])
        self.assertEqual(self.total_powerups(player_ref), 1)

        # A network retry of the same question must not grant a second one.
        self.client.force_authenticate(user=self.player)
        resp = self.client.post(self.url, {
            'roomCode': self.ROOM_CODE, 'questionIndex': threshold,
            'answer': 'A. yes', 'timeTaken': '1',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()['powerupEarned'])
        self.assertEqual(self.total_powerups(player_ref), 1)
        self.assertEqual(self.player_doc(player_ref)['answeredCount'], interval)


class PlacementRewardTests(TestCase):
    """Placement XP and the final-screen report.

    The non-host finish path, `_award_placement_xp` and `record_game_finish`
    had no coverage at all, which is how `_get_standings` could keep being
    called with one argument against a two-argument signature: the TypeError
    was swallowed by the view's blanket `except` and answered every finish
    with HTTP 500, so no game ever paid out.
    """

    def setUp(self):
        # The host is an educator, which is the case the standings exclusion in
        # _is_teacher_host exists for: a teacher runs the game without
        # appearing on it or shifting anyone's placement. The default role is
        # 'student', which would make the host a ranked, paid participant.
        self.host = User.objects.create_user(
            username='host', password='pass', role='educator',
        )
        self.first = User.objects.create_user(username='first', password='pass')
        self.second = User.objects.create_user(username='second', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.url = reverse('finish-game')

    def seed_room(self, room_code='PAY001', status='active', host_id=None,
                  scores=None, extra_users=()):
        """Seed a classic room. `scores` maps user -> score.

        `extra_users` adds further players, for cases that need more than the
        host and two students. Every seeded user gets a player document,
        because the finish path writes `isFinished` to one and a missing
        document is a 500 rather than a clean result.
        """
        room_ref = self.store.collection('gameRooms').document(room_code)
        room_ref.set({
            'status': status,
            'hostId': self.host.id if host_id is None else host_id,
            'teamMode': False,
            'topic': 't',
            'questionCount': 1,
            'timePerQuestion': 15,
            'questions': [],
        })
        for user in (self.host, self.first, self.second, *extra_users):
            room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username,
                'score': (scores or {}).get(user, 0),
                'answeredCount': 0,
                'isFinished': False,
            })
        return room_ref

    def game_activities(self, user):
        return Activity.objects.filter(user=user, kind='game')

    def test_last_player_finishing_awards_placement_xp(self):
        room_ref = self.seed_room(scores={self.first: 900, self.second: 400})
        room_ref.collection('players').document(str(self.second.id)).update({'isFinished': True})

        self.client.force_authenticate(user=self.first)
        resp = self.client.post(self.url, {'roomCode': 'PAY001'}, format='json')

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['allFinished'])
        # This caller settled the room, so it is told what it was paid.
        self.assertTrue(body['settled'])
        self.assertFalse(body['placementPending'])
        self.assertEqual(body['rank'], 1)
        self.assertEqual(body['totalPlayers'], 2)
        self.assertEqual(body['placementXp'], GAME_PLACEMENT_XP[1])

        self.assertEqual(room_ref.get().to_dict()['status'], 'finished')
        # Every participant is paid, not just the caller: the winner's award is
        # triggered by the last finisher's request.
        self.assertEqual(self.game_activities(self.first).count(), 1)
        self.assertEqual(self.game_activities(self.second).count(), 1)
        self.assertEqual(
            self.game_activities(self.second).first().xp_earned,
            GAME_PLACEMENT_XP[2],
        )

    def test_award_matches_competition_ranking(self):
        # A tie for first must pay first-place XP to both, and third place to
        # the other player. The client used to display a dense index while the
        # server used this ranking, so a tie showed 60 XP where 100 was paid.
        room_ref = self.seed_room(scores={self.first: 500, self.second: 500})
        room_ref.collection('players').document(str(self.second.id)).update({'isFinished': True})

        self.client.force_authenticate(user=self.first)
        resp = self.client.post(self.url, {'roomCode': 'PAY001'}, format='json')

        self.assertEqual(resp.json()['rank'], 1)
        self.assertEqual(resp.json()['placementXp'], GAME_PLACEMENT_XP[1])
        for user in (self.first, self.second):
            self.assertEqual(
                self.game_activities(user).first().xp_earned,
                GAME_PLACEMENT_XP[1],
            )
        # The educator host authored the room but never played, so they are
        # neither ranked nor paid.
        self.assertEqual(self.game_activities(self.host).count(), 0)

    def test_finishing_early_reports_pending_not_a_guess(self):
        room_ref = self.seed_room(scores={self.first: 900, self.second: 0})
        # The other player has not finished, so the room is not settled and
        # nobody has been paid yet.
        self.client.force_authenticate(user=self.first)
        resp = self.client.post(self.url, {'roomCode': 'PAY001'}, format='json')

        body = resp.json()
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(body['allFinished'])
        self.assertFalse(body['settled'])
        # No invented number: the client is told to withhold the amount.
        self.assertTrue(body['placementPending'])
        self.assertNotIn('placementXp', body)
        self.assertEqual(body['rank'], 1)
        self.assertEqual(room_ref.get().to_dict()['status'], 'active')
        self.assertEqual(self.game_activities(self.first).count(), 0)

    def test_retry_does_not_pay_twice(self):
        room_ref = self.seed_room(scores={self.first: 900, self.second: 0})
        room_ref.collection('players').document(str(self.second.id)).update({'isFinished': True})

        self.client.force_authenticate(user=self.first)
        first = self.client.post(self.url, {'roomCode': 'PAY001'}, format='json')
        self.assertFalse(first.json()['placementPending'])

        retry = self.client.post(self.url, {'roomCode': 'PAY001'}, format='json')
        self.assertEqual(retry.status_code, 200)
        self.assertFalse(retry.json()['settled'])
        self.assertTrue(retry.json()['placementPending'])

        for user in (self.first, self.second):
            self.assertEqual(self.game_activities(user).count(), 1)

    def test_host_ending_session_awards_everyone(self):
        # The host branch used to return straight after writing status, so
        # pressing "End Session Now" paid nobody at all.
        room_ref = self.seed_room(scores={self.first: 900, self.second: 400})

        self.client.force_authenticate(user=self.host)
        resp = self.client.post(self.url, {'roomCode': 'PAY001'}, format='json')

        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['settled'])
        self.assertEqual(room_ref.get().to_dict()['status'], 'finished')
        self.assertEqual(self.game_activities(self.first).count(), 1)
        self.assertEqual(self.game_activities(self.second).count(), 1)

    def test_student_host_ending_session_is_awarded(self):
        # A student host is a real participant, so ending the room early must
        # pay them too -- and they are the caller, so they are told the amount.
        room_ref = self.seed_room(
            scores={self.first: 900, self.second: 400},
            host_id=self.second.id,
        )
        self.client.force_authenticate(user=self.second)
        resp = self.client.post(self.url, {'roomCode': 'PAY001'}, format='json')

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['settled'])
        self.assertEqual(body['rank'], 2)
        self.assertEqual(body['placementXp'], GAME_PLACEMENT_XP[2])
        self.assertEqual(self.game_activities(self.second).count(), 1)

    def test_beyond_top_three_pays_default_xp(self):
        fourth = User.objects.create_user(username='fourth', password='pass')
        room_ref = self.seed_room(
            scores={self.first: 900, self.second: 800, fourth: 10},
            extra_users=(fourth,),
        )
        for user in (self.first, self.second):
            room_ref.collection('players').document(str(user.id)).update({'isFinished': True})

        self.client.force_authenticate(user=fourth)
        resp = self.client.post(self.url, {'roomCode': 'PAY001'}, format='json')

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['rank'], 3)
        self.assertEqual(body['placementXp'], GAME_PLACEMENT_XP[3])
        self.assertEqual(
            self.game_activities(self.first).first().xp_earned,
            GAME_PLACEMENT_XP[1],
        )

    def test_missing_host_user_is_not_treated_as_teacher(self):
        # A hostId pointing at no user row used to satisfy `role != 'student'`
        # (None != 'student'), so the host was treated as a teacher and dropped
        # from the standings even though they were a ranked player. The
        # educator exclusion must key on the real role, so an unresolvable host
        # leaves every player in the standings.
        room_ref = self.seed_room(scores={self.first: 900, self.second: 400})
        room_ref.update({'hostId': 999999})
        room_ref.collection('players').document(str(self.second.id)).update({'isFinished': True})

        self.client.force_authenticate(user=self.first)
        resp = self.client.post(self.url, {'roomCode': 'PAY001'}, format='json')
        self.assertEqual(resp.status_code, 200)
        # Three players: the missing host id does not exclude anyone.
        self.assertEqual(resp.json()['totalPlayers'], 3)

    def test_get_reports_settled_award_without_paying_again(self):
        # The GET exists because a player who finishes early has already
        # rendered their results when a later request settles the room.
        # Only the two students are ranked: the host is an educator, so they
        # are excluded from the standings and from the award.
        self.seed_room(scores={self.first: 900, self.second: 400})
        self.client.force_authenticate(user=self.first)

        pending = self.client.get(self.url, {'roomCode': 'PAY001'})
        self.assertEqual(pending.status_code, 200)
        self.assertTrue(pending.json()['placementPending'])
        self.assertEqual(pending.json()['placementXp'], 0)
        self.assertEqual(self.game_activities(self.first).count(), 0)

        room_ref = self.store.collection('gameRooms').document('PAY001')
        room_ref.collection('players').document(str(self.second.id)).update({'isFinished': True})
        self.client.post(self.url, {'roomCode': 'PAY001'}, format='json')

        settled = self.client.get(self.url, {'roomCode': 'PAY001'})
        self.assertFalse(settled.json()['placementPending'])
        self.assertEqual(settled.json()['placementXp'], GAME_PLACEMENT_XP[1])
        self.assertEqual(settled.json()['rank'], 1)
        # Purely a read: no second award.
        self.assertEqual(self.game_activities(self.first).count(), 1)

    def test_get_is_case_insensitive_and_ignores_unrelated_rooms(self):
        self.seed_room(room_code='CASE01', scores={self.first: 900, self.second: 400})
        self.seed_room(room_code='OTHER1', scores={self.first: 900, self.second: 400})
        room_ref = self.store.collection('gameRooms').document('CASE01')
        room_ref.collection('players').document(str(self.second.id)).update({'isFinished': True})
        self.client.force_authenticate(user=self.first)
        # Lower-cased on the way in, mixed case on the way back: room codes are
        # generated uppercase, and the award is keyed on the code, so a case
        # mismatch would silently report the award as never paid.
        self.client.post(self.url, {'roomCode': 'case01'}, format='json')

        settled = self.client.get(self.url, {'roomCode': 'CaSe01'})
        self.assertFalse(settled.json()['placementPending'])
        self.assertEqual(settled.json()['placementXp'], GAME_PLACEMENT_XP[1])

        # A different room's activity must not be reported as this one's.
        other = self.client.get(self.url, {'roomCode': 'OTHER1'})
        self.assertTrue(other.json()['placementPending'])
        self.assertEqual(other.json()['placementXp'], 0)


class AnswerTimeClampTests(TestCase):
    """The client reports its own answer time, so it is untrusted input.

    A negative time drove base_score above the documented 1000-point maximum
    because the formula has no cap of its own, and a time beyond the limit
    made the decay term negative.
    """

    ROOM_CODE = 'CLAMP1'
    TIME_PER_QUESTION = 15

    def setUp(self):
        self.host = User.objects.create_user(username='host', password='pass')
        self.player = User.objects.create_user(username='player', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        room_ref = self.store.collection('gameRooms').document(self.ROOM_CODE)
        room_ref.set({
            'status': 'active',
            'hostId': self.host.id,
            'teamMode': False,
            'timePerQuestion': self.TIME_PER_QUESTION,
            'questions': [{
                'type': 'mcq', 'question': 'Q0',
                'choices': ['A. yes', 'B. no'], 'correctAnswer': 'A. yes',
            }],
        })
        self.player_ref = room_ref.collection('players').document(str(self.player.id))
        self.player_ref.set({
            'displayName': 'Player', 'score': 0, 'answeredCount': 0, 'streak': 0,
            'questionOrder': [0], 'isReady': True, 'isFinished': False,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })

        self.client = APIClient()
        self.client.force_authenticate(user=self.player)

    def answer_with_time(self, time_taken):
        return self.client.post(reverse('answer-question'), {
            'roomCode': self.ROOM_CODE,
            'questionIndex': 0,
            'answer': 'A. yes',
            'timeTaken': time_taken,
        }, format='json')

    def test_zero_time_awards_the_maximum(self):
        resp = self.answer_with_time('0')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['pointsAwarded'], 1000)

    def test_negative_time_cannot_exceed_the_maximum(self):
        resp = self.answer_with_time('-5')
        self.assertEqual(resp.status_code, 200)
        # Unclamped this was int(1000 * (1 + 0.1666)) = 1166.
        self.assertEqual(resp.json()['pointsAwarded'], 1000)

    def test_time_beyond_the_limit_uses_the_floor(self):
        resp = self.answer_with_time('9999')
        self.assertEqual(resp.status_code, 200)
        # Clamped to the full limit, which decays to exactly the 500 floor.
        self.assertEqual(resp.json()['pointsAwarded'], 500)

    def test_normal_time_is_unaffected(self):
        resp = self.answer_with_time('5')
        expected = max(int(1000 * (1 - (5 / self.TIME_PER_QUESTION) * 0.5)), 500)
        self.assertEqual(resp.json()['pointsAwarded'], expected)


class QuizHostPermissionTests(TestCase):
    """Who may turn a quiz into a live game.

    The lookup was owner-only, so an educator could not host a quiz attached
    to their own course but authored by a colleague, and a student could not
    host their own self-authored quiz either. The rejection was also a 404
    ("Quiz not found") which hid "not yours" behind "no such quiz".
    """

    def setUp(self):
        self.educator = User.objects.create_user(
            username='teacher', password='pass', role='educator',
        )
        self.colleague = User.objects.create_user(
            username='colleague', password='pass', role='educator',
        )
        self.student = User.objects.create_user(
            username='student', password='pass', role='student',
        )
        self.course = Course.objects.create(name='Algebra', educator=self.educator)
        self.foreign_course = Course.objects.create(
            name='History', educator=self.colleague,
        )

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()

    def make_quiz(self, user, course=None, title='Quiz'):
        return Quiz.objects.create(user=user, course=course, title=title)

    def host(self, user, quiz):
        """POST a create-game for `quiz`, which may be a Quiz or a raw id."""
        self.client.force_authenticate(user=user)
        quiz_id = quiz.id if isinstance(quiz, Quiz) else quiz
        return self.client.post(
            reverse('create-game'), {'quizId': quiz_id}, format='json',
        )

    def test_author_can_host_own_quiz(self):
        resp = self.host(self.student, self.make_quiz(self.student))
        self.assertEqual(resp.status_code, 200)

    def test_educator_can_host_own_quiz(self):
        resp = self.host(self.educator, self.make_quiz(self.educator))
        self.assertEqual(resp.status_code, 200)

    def test_educator_can_host_course_quiz_authored_by_colleague(self):
        resp = self.host(self.educator, self.make_quiz(self.colleague, self.course))
        self.assertEqual(resp.status_code, 200)

    def test_educator_cannot_host_quiz_from_foreign_course(self):
        resp = self.host(self.educator, self.make_quiz(self.colleague, self.foreign_course))
        self.assertEqual(resp.status_code, 403)
        self.assertIn('permission', resp.json()['error'].lower())

    def test_student_cannot_host_another_students_quiz(self):
        other = User.objects.create_user(username='other', password='pass', role='student')
        resp = self.host(self.student, self.make_quiz(other))
        self.assertEqual(resp.status_code, 403)

    def test_forbidden_is_distinct_from_missing(self):
        other = User.objects.create_user(username='other2', password='pass', role='student')
        forbidden = self.host(self.student, self.make_quiz(other))
        # A real quiz id that belongs to nobody the student can host, versus an
        # id that does not exist at all: the first is a permission problem and
        # must not be reported as the second.
        missing = self.host(self.student, str(other.id + 1000))
        self.assertEqual(forbidden.status_code, 403)
        self.assertEqual(missing.status_code, 404)

    def test_non_numeric_quiz_id_is_a_client_error_not_a_500(self):
        # int('not-a-number') raised out of the queryset lookup and surfaced as
        # a 500; a malformed id is the caller's mistake, not a server fault.
        self.client.force_authenticate(user=self.student)
        resp = self.client.post(
            reverse('create-game'), {'quizId': 'not-a-number'}, format='json',
        )
        self.assertEqual(resp.status_code, 404)
        self.assertIn('not found', resp.json()['error'].lower())


class RosterCapTests(TestCase):
    """The roster cap was documented but never enforced.

    MAX_PLAYERS was named as the player limit but only bounded team_count, so
    a class of any size could join a room whose limit read 20.
    """

    def setUp(self):
        self.host = User.objects.create_user(username='host', password='pass')
        self.students = [
            User.objects.create_user(username=f'stu{i}', password='pass')
            for i in range(4)
        ]

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()

    def seed_full_room(self, room_code='FULL01', occupants=3):
        room_ref = self.store.collection('gameRooms').document(room_code)
        room_ref.set({
            'status': 'waiting', 'hostId': self.host.id, 'teamMode': False,
            'topic': 't', 'questionCount': 1, 'questions': [],
        })
        players = room_ref.collection('players')
        # The host is seeded as a player too, as CreateGameView does.
        players.document(str(self.host.id)).set({'displayName': 'host', 'score': 0})
        for user in self.students[:occupants]:
            players.document(str(user.id)).set({'displayName': user.username, 'score': 0})
        return room_ref

    def join_as(self, user, room_code):
        self.client.force_authenticate(user=user)
        return self.client.post(
            reverse('join-game'), {'roomCode': room_code}, format='json',
        )

    def test_join_allowed_under_the_cap(self):
        self.seed_full_room(occupants=1)  # 2 present
        resp = self.join_as(self.students[1], 'FULL01')
        self.assertEqual(resp.status_code, 200)

    def test_join_refused_when_full(self):
        from game.views import MAX_PLAYERS

        self.seed_full_room(occupants=3)  # 4 present
        # Fill the room to the cap directly, then confirm the next join fails.
        room_ref = self.store.collection('gameRooms').document('FULL01')
        players = room_ref.collection('players')
        for i in range(MAX_PLAYERS - 4):
            players.document(str(9000 + i)).set({'displayName': f'p{i}', 'score': 0})

        resp = self.join_as(self.students[3], 'FULL01')
        self.assertEqual(resp.status_code, 400)
        body = resp.json()
        self.assertIn('full', body['error'].lower())
        self.assertEqual(body['maxPlayers'], MAX_PLAYERS)
        # The rejected student is not added.
        self.assertFalse(players.document(str(self.students[3].id)).get().exists)

    def test_cap_is_well_above_a_forty_student_class(self):
        from game.views import MAX_PLAYERS

        self.assertGreaterEqual(MAX_PLAYERS, 40)


class TeamColourTests(TestCase):
    """TEAM_COLORS was four entries indexed with i % 4, so teams 5+ silently
    duplicated the colours of teams 1-4."""

    def test_teams_beyond_four_get_distinct_colours(self):
        from game.views import MAX_TEAMS, TEAM_COLORS

        self.assertGreaterEqual(len(TEAM_COLORS), MAX_TEAMS)
        self.assertEqual(len(set(TEAM_COLORS)), len(TEAM_COLORS))
        for i in range(MAX_TEAMS):
            self.assertIn(i, [j % len(TEAM_COLORS) for j in range(i + 1)])

    def test_team_colour_wraps_rather_than_crashing(self):
        from game.views import TEAM_COLORS, team_color

        self.assertEqual(team_color(0), TEAM_COLORS[0])
        self.assertEqual(team_color(len(TEAM_COLORS)), TEAM_COLORS[0])
