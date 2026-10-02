from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from users.models import Activity, User
from ai_assistant.models import Quiz, QuizQuestion
from game.test_firestore_fake import FakeFirestoreClient, FakeStoreError, FakeTransaction
from game.views import TEAM_COLORS


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
        # Capacity is derived from the roster, not from a fictional headcount,
        # so it is only fixed once the game starts.
        self.assertNotIn('maxTeamSize', room)

        teams = list(room_ref.collection('teams').stream())
        by_id = {t.id: t.to_dict() for t in teams}
        self.assertEqual(len(by_id), 3)
        self.assertEqual(by_id['1']['name'], 'Team 1')
        self.assertEqual(by_id['1']['color'], '#22D3EE')
        self.assertEqual(by_id['2']['color'], '#10B981')
        self.assertEqual(by_id['3']['color'], '#F59E0B')
        # Every team starts with an empty shared powerup pool and x1 momentum,
        # not just a score.
        self.assertEqual(by_id['1']['multiplier'], 1.0)
        self.assertEqual(by_id['1']['teamCorrect'], 0)
        self.assertEqual(by_id['1']['powerups'], {k: 0 for k in
                                                 ('freeze', 'hint', 'doublePoints', 'shield')})
        self.assertFalse(by_id['1']['nameLocked'])

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
        # The lobby sorts spectators newest-first, and player docs are keyed by
        # user id, so arrival order has to be stamped on the doc itself.
        self.assertIn('joinedAt', player)

    def test_every_player_doc_records_when_they_joined(self):
        resp = self.create_team_room(team_count=2)
        room_code = resp.json()['roomCode']
        room_ref = self.store.collection('gameRooms').document(room_code)

        self.client.force_authenticate(user=self.player2)
        self.client.post(reverse('join-game'), {'roomCode': room_code}, format='json')

        players_ref = room_ref.collection('players')
        for doc in players_ref.stream():
            self.assertIn('joinedAt', doc.to_dict())

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


class TeamMomentumTests(TestCase):
    """Team mode has to reward playing as a team, otherwise it is just an
    individual race with coloured labels."""

    def setUp(self):
        self.host = User.objects.create_user(username='host', password='pass')
        self.a = User.objects.create_user(username='a', password='pass')
        self.b = User.objects.create_user(username='b', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('MOOD1')
        self.room_ref.set({
            'status': 'active',
            'hostId': self.host.id,
            'teamMode': True,
            'teamCount': 2,
            'timePerQuestion': 15,
            'questions': [
                {'type': 'mcq', 'question': f'Q{i}', 'choices': ['A. yes', 'B. no'],
                 'correctAnswer': 'A. yes'} for i in range(30)
            ],
        })
        teams = self.room_ref.collection('teams')
        teams.document('1').set({
            'name': 'Alphas', 'color': '#22D3EE', 'score': 0, 'correctCount': 0,
            'answeredCount': 0, 'memberIds': [str(self.a.id), str(self.b.id)], 'memberCount': 2,
            'teamCorrect': 0, 'teamStreak': 0, 'bestStreak': 0, 'multiplier': 1.0,
            'maxMultiplier': 1.0,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        teams.document('2').set({
            'name': 'Betas', 'color': '#10B981', 'score': 0, 'correctCount': 0,
            'answeredCount': 0, 'memberIds': [], 'memberCount': 0,
            'teamCorrect': 0, 'multiplier': 1.0,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        for i, user in enumerate((self.a, self.b)):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': f'P{i}', 'score': 0, 'answeredCount': 0, 'correctCount': 0,
                'streak': 0, 'questionOrder': list(range(30)), 'teamId': '1', 'isFinished': False,
                'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
            })

    def team(self, team_id='1'):
        return self.room_ref.collection('teams').document(team_id).get().to_dict()

    def answer(self, index, user, answer='A. yes', **extra):
        self.client.force_authenticate(user=user)
        payload = {'roomCode': 'MOOD1', 'questionIndex': index, 'answer': answer, 'timeTaken': '1'}
        payload.update(extra)
        return self.client.post(reverse('answer-question'), payload, format='json')

    def test_multiplier_lifts_the_team(self):
        # Renamed: this used to assert that a *solo* room never gets a
        # multiplier, which was the old design. Classic mode now climbs the
        # same ladder (see SoloMomentumTests), so the name was a lie.
        self.answer(0, self.a)
        self.assertEqual(self.team()['multiplier'], 1.0)
        self.assertEqual(self.answer(0, self.a).json()['multiplier'], 1.0)

        # Ten correct team answers puts the team on the x1.4 rung, and the
        # NEXT answer is the one that is boosted.
        for i in range(1, 11):
            self.assertEqual(self.answer(i, self.a).status_code, 200)
        self.assertEqual(self.team()['multiplier'], 1.4)
        self.assertEqual(self.team()['teamCorrect'], 11)

        base = max(int(1000 * (1 - (1 / 15) * 0.5)), 500)
        boosted = self.answer(11, self.b)
        self.assertEqual(boosted.json()['multiplier'], 1.4)
        self.assertEqual(boosted.json()['pointsAwarded'], round(base * 1.4))

    def test_miss_drops_one_rung_and_breaks_the_team_flame(self):
        for i in range(5):
            self.answer(i, self.a)
        self.assertEqual(self.team()['multiplier'], 1.2)
        self.assertEqual(self.team()['teamStreak'], 5)

        self.answer(5, self.a, answer='B. no')
        self.assertEqual(self.team()['multiplier'], 1.0)
        self.assertEqual(self.team()['teamStreak'], 0)
        # The ladder is not reset: the team's correct count survives the miss.
        self.assertEqual(self.team()['teamCorrect'], 5)

    def test_peak_multiplier_and_best_streak_are_remembered(self):
        for i in range(5):
            self.answer(i, self.a)
        self.answer(5, self.a, answer='B. no')
        for i in range(6, 11):
            self.answer(i, self.a)
        team = self.team()
        # The demotion to x1.0 is remembered even though the team climbed back
        # past it, so the final screen can show how high they actually got.
        self.assertEqual(team['maxMultiplier'], 1.4)
        self.assertEqual(team['bestStreak'], 5)
        self.assertEqual(team['multiplier'], 1.4)

    def test_streak_rewards_go_to_the_shared_pool(self):
        for i in range(3):
            resp = self.answer(i, self.a)
        self.assertIsNotNone(resp.json()['powerupEarned'])
        pool = self.team()['powerups']
        self.assertEqual(sum(pool.values()), 1)
        # A teammate's reward is spendable by the other member — this is the
        # mechanic that forces them to talk.
        self.assertEqual(
            self.room_ref.collection('players').document(str(self.b.id)).get().to_dict()['powerups'],
            {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        )

    def test_double_points_spends_from_the_team_pool(self):
        self.room_ref.collection('teams').document('1').update(
            {'powerups.doublePoints': 1})
        resp = self.answer(0, self.a, useDoublePoints='true')
        base = max(int(1000 * (1 - (1 / 15) * 0.5)), 500)
        self.assertEqual(resp.json()['pointsAwarded'], base * 2)
        self.assertEqual(self.team()['powerups']['doublePoints'], 0)

    def test_double_points_is_refused_when_the_pool_is_empty(self):
        # The use-flags are client-supplied, so claiming a powerup the team
        # does not own must be a no-op rather than free points.
        resp = self.answer(0, self.a, useDoublePoints='true')
        base = max(int(1000 * (1 - (1 / 15) * 0.5)), 500)
        self.assertEqual(resp.json()['pointsAwarded'], base)
        self.assertEqual(self.team()['powerups']['doublePoints'], 0)

    def test_hint_is_charged_when_the_reveal_is_claimed(self):
        self.room_ref.collection('teams').document('1').update({'powerups.hint': 1})
        self.answer(0, self.a, useHint='true')
        self.assertEqual(self.team()['powerups']['hint'], 0)

    def test_shield_saves_the_team_flame(self):
        for i in range(3):
            self.answer(i, self.a)
        self.assertEqual(self.team()['teamStreak'], 3)
        self.assertEqual(self.team()['multiplier'], 1.0)

        self.room_ref.collection('teams').document('1').update({'powerups.shield': 1})
        self.answer(3, self.a, answer='B. no', useShield='true')
        team = self.team()
        # A shield keeps the flame alive rather than extending it, and spares
        # the team the momentum demotion.
        self.assertEqual(team['teamStreak'], 3)
        self.assertEqual(team['correctCount'], 3)
        self.assertEqual(team['powerups']['shield'], 0)

    def test_unshielded_miss_demotes_and_breaks_the_flame(self):
        for i in range(5):
            self.answer(i, self.a)
        self.assertEqual(self.team()['multiplier'], 1.2)
        self.answer(5, self.a, answer='B. no')
        team = self.team()
        self.assertEqual(team['teamStreak'], 0)
        self.assertEqual(team['multiplier'], 1.0)

    def test_negative_time_taken_cannot_exceed_the_cap(self):
        resp = self.answer(0, self.a, timeTaken='-1000')
        # Without the clamp this scores ~34,000 points.
        self.assertLessEqual(resp.json()['pointsAwarded'], 1000 * 2)
        self.assertGreaterEqual(resp.json()['pointsAwarded'], 500)

    def test_answers_are_rejected_outside_an_active_room(self):
        self.room_ref.update({'status': 'waiting'})
        resp = self.answer(0, self.a)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.team()['answeredCount'], 0)

    def test_replayed_answer_cannot_drain_the_hint_pool(self):
        """A retried submission must not buy a fresh hint each time.

        The hint has no separate endpoint — it is claimed on the answer call —
        so charging it before the idempotency check let a client with a flaky
        connection empty the team pool for free by re-posting.
        """
        self.room_ref.collection('teams').document('1').update({'powerups.hint': 3})
        self.answer(0, self.a, useHint='true')
        self.assertEqual(self.team()['powerups']['hint'], 2)

        for _ in range(5):
            self.answer(0, self.a, useHint='true')
        self.assertEqual(self.team()['powerups']['hint'], 2)

    def test_boost_doubles_a_named_teammates_next_answer(self):
        self.room_ref.collection('teams').document('1').update({'powerups.doublePoints': 1})
        self.client.force_authenticate(user=self.a)
        resp = self.client.post(
            reverse('boost-teammate'),
            {'roomCode': 'MOOD1', 'playerId': str(self.b.id)},
            format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.team()['powerups']['doublePoints'], 0)
        self.assertEqual(self.team()['boostTarget'], str(self.b.id))
        # b has answered nothing, so the boost lands on question 0.
        self.assertEqual(self.team()['boostQuestion'], 0)

        base = max(int(1000 * (1 - (1 / 15) * 0.5)), 500)
        answered = self.answer(0, self.b)
        self.assertEqual(answered.json()['pointsAwarded'], base * 2)
        # One-shot: a later answer is back to normal.
        self.assertEqual(self.answer(1, self.b).json()['pointsAwarded'], base)
        self.assertIsNone(self.team()['boostTarget'])

    def test_boost_cannot_be_aimed_at_an_opponent_or_self(self):
        self.room_ref.collection('teams').document('1').update({'powerups.doublePoints': 3})
        self.client.force_authenticate(user=self.a)
        for target in (str(self.a.id), str(self.host.id)):
            resp = self.client.post(
                reverse('boost-teammate'),
                {'roomCode': 'MOOD1', 'playerId': target},
                format='json')
            self.assertEqual(resp.status_code, 400 if target == str(self.a.id) else 403)
        self.assertEqual(self.team()['powerups']['doublePoints'], 3)

    def test_boost_is_refused_with_an_empty_pool(self):
        self.client.force_authenticate(user=self.a)
        resp = self.client.post(
            reverse('boost-teammate'),
            {'roomCode': 'MOOD1', 'playerId': str(self.b.id)},
            format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIsNone(self.team().get('boostTarget'))


class TeamLobbyTests(TestCase):
    """The lobby columns let students pick their own team; the server has to
    own that move or the roster drifts."""

    def setUp(self):
        self.host = User.objects.create_user(username='host', password='pass')
        self.p1 = User.objects.create_user(username='p1', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('LOB1')
        self.room_ref.set({
            'status': 'waiting', 'hostId': self.host.id, 'teamMode': True,
            'teamCount': 2, 'topic': 't', 'questionCount': 1, 'timePerQuestion': 15,
            'questions': [{'type': 'mcq', 'question': 'q', 'choices': ['A. y'], 'correctAnswer': 'A. y'}],
        })
        for i in (1, 2):
            self.room_ref.collection('teams').document(str(i)).set({
                'name': f'Team {i}', 'color': '#22D3EE', 'score': 0, 'correctCount': 0,
                'answeredCount': 0, 'memberIds': [], 'memberCount': 0,
                'teamCorrect': 0, 'multiplier': 1.0, 'nameLocked': False,
                'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
            })
        for user in (self.host, self.p1):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': 0, 'teamId': None, 'isFinished': False,
            })

    def team(self, team_id):
        return self.room_ref.collection('teams').document(team_id).get().to_dict()

    def player(self, user):
        return self.room_ref.collection('players').document(str(user.id)).get().to_dict()

    def test_assign_moves_the_player_and_updates_both_teams(self):
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('assign-team'),
                                {'roomCode': 'LOB1', 'teamId': '1'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.player(self.p1)['teamId'], '1')
        self.assertEqual(self.team('1')['memberIds'], [str(self.p1.id)])
        self.assertEqual(self.team('1')['memberCount'], 1)

        # Switching must not leave the player in both rosters.
        self.client.post(reverse('assign-team'),
                         {'roomCode': 'LOB1', 'teamId': '2'}, format='json')
        self.assertEqual(self.player(self.p1)['teamId'], '2')
        self.assertEqual(self.team('1')['memberIds'], [])
        self.assertEqual(self.team('1')['memberCount'], 0)
        self.assertEqual(self.team('2')['memberCount'], 1)

    def test_assigning_to_the_same_team_is_a_noop(self):
        self.client.force_authenticate(user=self.p1)
        self.client.post(reverse('assign-team'), {'roomCode': 'LOB1', 'teamId': '1'}, format='json')
        resp = self.client.post(reverse('assign-team'), {'roomCode': 'LOB1', 'teamId': '1'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.team('1')['memberCount'], 1)

    def test_full_team_rejects_a_move(self):
        # Seat count is per team now, so a team is full at its own maxSize
        # rather than at a room-wide ceil(players/teams) guess.
        extra = User.objects.create_user(username='extra', password='pass')
        self.room_ref.collection('players').document(str(extra.id)).set(
            {'displayName': 'extra', 'teamId': None, 'score': 0})
        self.room_ref.collection('teams').document('1').set(
            {'memberIds': [str(self.host.id), str(extra.id)], 'memberCount': 2,
             'maxSize': 2}, merge=True)

        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('assign-team'),
                                {'roomCode': 'LOB1', 'teamId': '1'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('full', resp.json()['error'])
        self.assertIsNone(self.player(self.p1)['teamId'])

    def test_team_without_a_maxSize_defaults_to_five_seats(self):
        # setUp creates teams with no maxSize, which is exactly a room that
        # predates per-team seats. Reading that as 0 would make every legacy
        # team instantly full; reading it as MAX_PLAYERS would make the "+"
        # a no-op forever. It has to be 5.
        joiners = [User.objects.create_user(username=f'j{i}', password='pass') for i in range(6)]
        for user in joiners:
            self.room_ref.collection('players').document(str(user.id)).set(
                {'displayName': user.username, 'teamId': None, 'score': 0})

        for user in joiners[:5]:
            self.client.force_authenticate(user=user)
            resp = self.client.post(reverse('assign-team'),
                                    {'roomCode': 'LOB1', 'teamId': '1'}, format='json')
            self.assertEqual(resp.status_code, 200, f'{user.username} should fit in 5 seats')

        self.client.force_authenticate(user=joiners[5])
        resp = self.client.post(reverse('assign-team'),
                                {'roomCode': 'LOB1', 'teamId': '1'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['maxTeamSize'], 5)

    def test_teams_lock_once_the_game_starts(self):
        self.room_ref.update({'status': 'active'})
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('assign-team'),
                                {'roomCode': 'LOB1', 'teamId': '1'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIsNone(self.player(self.p1)['teamId'])

    def test_host_can_rename_but_a_renamed_team_is_locked(self):
        self.client.force_authenticate(user=self.host)
        resp = self.client.post(reverse('rename-team'),
                                {'roomCode': 'LOB1', 'teamId': '1', 'name': 'The Brainy Bunch'},
                                format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.team('1')['name'], 'The Brainy Bunch')
        self.assertTrue(self.team('1')['nameLocked'])

        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('rename-team'),
                                {'roomCode': 'LOB1', 'teamId': '1', 'name': 'Something Else'},
                                format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(self.team('1')['name'], 'The Brainy Bunch')

    def test_rename_validates_length(self):
        self.client.force_authenticate(user=self.host)
        resp = self.client.post(reverse('rename-team'),
                                {'roomCode': 'LOB1', 'teamId': '1', 'name': ''}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_reaction_must_be_on_the_allowlist(self):
        self.client.force_authenticate(user=self.p1)
        bad = self.client.post(reverse('react'),
                               {'roomCode': 'LOB1', 'emoji': '<script>'}, format='json')
        self.assertEqual(bad.status_code, 400)

        good = self.client.post(reverse('react'),
                                {'roomCode': 'LOB1', 'emoji': '\U0001F525'}, format='json')
        self.assertEqual(good.status_code, 200)
        reactions = list(self.room_ref.collection('reactions').stream())
        self.assertEqual(len(reactions), 1)
        self.assertEqual(reactions[0].to_dict()['userId'], str(self.p1.id))

    def test_start_keeps_picked_teams_and_deals_the_stragglers(self):
        self.client.force_authenticate(user=self.p1)
        self.client.post(reverse('assign-team'), {'roomCode': 'LOB1', 'teamId': '1'}, format='json')

        self.client.force_authenticate(user=self.host)
        # The host never picked, so a plain start is refused.
        resp = self.client.post(reverse('start-game'), {'roomCode': 'LOB1'}, format='json')
        self.assertEqual(resp.status_code, 400)

        # Forcing it keeps player1's choice and deals the host into the emptier team.
        resp = self.client.post(reverse('start-game'),
                                {'roomCode': 'LOB1', 'force': 'true'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.player(self.p1)['teamId'], '1')
        self.assertEqual(self.player(self.host)['teamId'], '2')

        assignments = self.room_ref.get().to_dict()['teamAssignments']
        self.assertEqual(len(assignments), 2)
        self.assertEqual({a['teamId'] for a in assignments}, {'1', '2'})
        # The reveal payload carries the real team name, not a hardcoded one.
        self.room_ref.collection('teams').document('1').update({'name': 'The Brainy Bunch'})
        self.assertEqual(
            self.client.post(reverse('start-game'), {'roomCode': 'LOB1'}, format='json').status_code,
            400)  # already started


class TeamSeatTests(TestCase):
    """Seat counts live on the team, and auto-assign is its own action.

    Both used to be folded into /game/start/, which meant the only way to grow
    a team or even out a roster was to begin the game.
    """

    def setUp(self):
        self.host = User.objects.create_user(username='host', password='pass')
        self.p1 = User.objects.create_user(username='p1', password='pass')
        self.p2 = User.objects.create_user(username='p2', password='pass')
        self.educator = User.objects.create_user(
            username='teacher', password='pass', role='educator')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('SEAT')
        self.room_ref.set({
            'status': 'waiting', 'hostId': self.host.id, 'teamMode': True,
            'teamCount': 3, 'topic': 't', 'questionCount': 1, 'timePerQuestion': 15,
            'questions': [{'type': 'mcq', 'question': 'q',
                           'choices': ['A. y'], 'correctAnswer': 'A. y'}],
        })
        for i in (1, 2, 3):
            self.room_ref.collection('teams').document(str(i)).set({
                'name': f'Team {i}', 'color': '#22D3EE', 'score': 0, 'correctCount': 0,
                'answeredCount': 0, 'memberIds': [], 'memberCount': 0, 'maxSize': 5,
                'teamCorrect': 0, 'multiplier': 1.0, 'nameLocked': False,
                'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
            })
        for user in (self.host, self.p1, self.p2, self.educator):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': 0, 'teamId': None,
                'isFinished': False,
            })

    def team(self, team_id):
        return self.room_ref.collection('teams').document(team_id).get().to_dict()

    def player(self, user):
        return self.room_ref.collection('players').document(str(user.id)).get().to_dict()

    # ── seat caps ──

    def test_max_size_governs_admission(self):
        # There is no longer a manual "+": a team's maxSize only moves when
        # auto-assign deals people onto it. The rule that matters is still
        # that maxSize -- not the old room-wide estimate -- is what fills a
        # team, otherwise growing one would never actually let anybody in.
        team_ref = self.room_ref.collection('teams').document('1')
        team_ref.set({'memberIds': [str(self.p1.id)] * 5, 'memberCount': 5}, merge=True)
        self.client.force_authenticate(user=self.p2)
        blocked = self.client.post(reverse('assign-team'),
                                   {'roomCode': 'SEAT', 'teamId': '1'}, format='json')
        self.assertEqual(blocked.status_code, 400)

        team_ref.update({'maxSize': 6})
        admitted = self.client.post(reverse('assign-team'),
                                    {'roomCode': 'SEAT', 'teamId': '1'}, format='json')
        self.assertEqual(admitted.status_code, 200)

    # ── auto-assign ──

    def test_auto_assign_deals_everyone_evenly(self):
        self.client.force_authenticate(user=self.host)
        resp = self.client.post(reverse('auto-assign-teams'),
                                {'roomCode': 'SEAT'}, format='json')
        self.assertEqual(resp.status_code, 200)
        sizes = resp.json()['sizes']
        self.assertEqual(sum(sizes.values()), 4)
        # Round-robin over 3 teams with 4 people: two teams of 1, one of 2.
        self.assertLessEqual(max(sizes.values()) - min(sizes.values()), 1)
        for team_id, team in ((t, self.team(t)) for t in ('1', '2', '3')):
            self.assertEqual(len(team['memberIds']), sizes[team_id])
            for member in team['memberIds']:
                self.assertEqual(self.player_doc(member)['teamId'], team_id)

    def player_doc(self, player_id):
        return self.room_ref.collection('players').document(str(player_id)).get().to_dict()

    def test_auto_assign_never_starts_the_game(self):
        self.client.force_authenticate(user=self.host)
        self.client.post(reverse('auto-assign-teams'), {'roomCode': 'SEAT'}, format='json')
        self.assertEqual(self.room_ref.get().to_dict()['status'], 'waiting')

    def test_auto_assign_ignores_previous_picks(self):
        # The host asked for a full reshuffle, so a hand-picked team loses them.
        self.room_ref.collection('players').document(str(self.p1.id)).update({'teamId': '2'})
        self.room_ref.collection('teams').document('2').set(
            {'memberIds': [str(self.p1.id)], 'memberCount': 1}, merge=True)

        self.client.force_authenticate(user=self.host)
        resp = self.client.post(reverse('auto-assign-teams'),
                                {'roomCode': 'SEAT'}, format='json')
        self.assertEqual(resp.status_code, 200)
        # 4 players / 3 teams, so team 2 keeps one person but not necessarily p1.
        self.assertEqual(sum(len(self.team(t)['memberIds']) for t in ('1', '2', '3')), 4)

    def test_auto_assign_is_host_only(self):
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('auto-assign-teams'),
                                {'roomCode': 'SEAT'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_auto_assign_refuses_an_empty_room(self):
        self.room_ref.collection('players').document(str(self.p1.id)).delete()
        self.room_ref.collection('players').document(str(self.p2.id)).delete()
        self.room_ref.collection('players').document(str(self.educator.id)).delete()
        self.client.force_authenticate(user=self.host)
        self.room_ref.collection('players').document(str(self.host.id)).delete()
        resp = self.client.post(reverse('auto-assign-teams'),
                                {'roomCode': 'SEAT'}, format='json')
        self.assertEqual(resp.status_code, 400)

    # ── start without auto-assigning ──

    def test_start_leaves_unassigned_players_spectating_when_asked(self):
        self.client.force_authenticate(user=self.p1)
        self.client.post(reverse('assign-team'),
                         {'roomCode': 'SEAT', 'teamId': '1'}, format='json')
        self.assertEqual(self.player(self.p1)['teamId'], '1')

        self.client.force_authenticate(user=self.host)
        blocked = self.client.post(reverse('start-game'),
                                   {'roomCode': 'SEAT'}, format='json')
        self.assertEqual(blocked.status_code, 400)

        allowed = self.client.post(reverse('start-game'),
                                   {'roomCode': 'SEAT', 'allowUnassigned': 'true'}, format='json')
        self.assertEqual(allowed.status_code, 200)
        # p2 never picked a team, and START must not have quietly dealt them in.
        self.assertIsNone(self.player(self.p2)['teamId'])
        self.assertEqual(self.player(self.p1)['teamId'], '1')

    # ── host handover ──

    def test_host_claim_promotes_when_the_host_is_gone(self):
        # No educator left, so the promotion is decided purely by join order.
        self.room_ref.collection('players').document(str(self.host.id)).delete()
        self.room_ref.collection('players').document(str(self.educator.id)).delete()
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('host-claim'),
                                {'roomCode': 'SEAT'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['promoted'])
        self.assertEqual(self.room_ref.get().to_dict()['hostId'], self.p1.id)

    def test_host_claim_prefers_a_remaining_educator(self):
        self.room_ref.collection('players').document(str(self.host.id)).delete()
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('host-claim'),
                                {'roomCode': 'SEAT'}, format='json')
        self.assertEqual(self.room_ref.get().to_dict()['hostId'], self.educator.id)

    def test_host_claim_is_a_noop_while_the_host_remains(self):
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('host-claim'),
                                {'roomCode': 'SEAT'}, format='json')
        self.assertFalse(resp.json()['promoted'])
        self.assertEqual(self.room_ref.get().to_dict()['hostId'], self.host.id)

    def test_a_promoted_host_gains_the_host_rights(self):
        # Every host check reads hostId off the room document, so the promotion
        # is all the handover needs: the new host can rename without any extra
        # bookkeeping on the client.
        self.room_ref.collection('players').document(str(self.host.id)).delete()
        self.room_ref.collection('players').document(str(self.educator.id)).delete()
        self.client.force_authenticate(user=self.p1)
        self.client.post(reverse('host-claim'), {'roomCode': 'SEAT'}, format='json')

        resp = self.client.post(reverse('rename-team'),
                                {'roomCode': 'SEAT', 'teamId': '1', 'name': 'New Captain'},
                                format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.team('1')['name'], 'New Captain')


class TeamPlacementXpTests(TestCase):
    def setUp(self):
        self.host = User.objects.create_user(username='host', password='pass')
        self.winner = User.objects.create_user(username='winner', password='pass')
        self.loser = User.objects.create_user(username='loser', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('XP1')
        self.room_ref.set({
            'status': 'active', 'hostId': self.host.id, 'teamMode': True,
            'teamCount': 2, 'topic': 't', 'questionCount': 1, 'questions': [],
        })
        self.room_ref.collection('teams').document('1').set({
            'name': 'Winners', 'color': '#22D3EE', 'score': 900,
            'correctCount': 3, 'answeredCount': 3, 'memberIds': [str(self.winner.id)],
        })
        self.room_ref.collection('teams').document('2').set({
            'name': 'Chasers', 'color': '#10B981', 'score': 100,
            'correctCount': 0, 'answeredCount': 2, 'memberIds': [str(self.loser.id)],
        })
        for user, score, team in ((self.winner, 900, '1'), (self.loser, 100, '2')):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': score, 'teamId': team, 'isFinished': True,
            })

    def test_team_placement_pays_every_member_of_the_winning_team(self):
        self.client.force_authenticate(user=self.loser)
        resp = self.client.post(reverse('finish-game'), {'roomCode': 'XP1'}, format='json')
        self.assertEqual(resp.status_code, 200)
        # The finishing player is told their TEAM's placement, not their own.
        self.assertEqual(resp.json()['teamRank'], 2)
        self.assertEqual(resp.json()['teamId'], '2')

        winner_activity = Activity.objects.filter(user=self.winner, kind='game').first()
        self.assertIsNotNone(winner_activity)
        self.assertIn('Winners', winner_activity.title)
        self.assertNotIn('Chasers', winner_activity.title)

    def test_team_results_carry_accuracy_and_contribution(self):
        self.client.force_authenticate(user=self.loser)
        self.client.post(reverse('finish-game'), {'roomCode': 'XP1'}, format='json')
        results = self.room_ref.get().to_dict()['teamResults']
        self.assertEqual([r['name'] for r in results], ['Winners', 'Chasers'])
        self.assertEqual(results[0]['accuracy'], 100)
        self.assertEqual(results[1]['accuracy'], 0)
        winner_row = results[0]['members'][0]
        self.assertEqual(winner_row['userId'], str(self.winner.id))
        self.assertEqual(winner_row['contribution'], 100)


class FreezePowerupTests(TestCase):
    """A freeze is charged by the server, out of the shared pool in team mode.

    It used to be a raw client-side `increment(-1)` on the player's own
    document, which let a team freeze indefinitely and could drive the count
    negative.
    """

    def setUp(self):
        self.host = User.objects.create_user(username='fhost', password='pass')
        self.a = User.objects.create_user(username='fa', password='pass')
        self.b = User.objects.create_user(username='fb', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('FRZ1')
        self.room_ref.set({
            'status': 'active',
            'hostId': self.host.id,
            'teamMode': True,
            'timePerQuestion': 15,
            'questions': [
                {'type': 'mcq', 'question': f'Q{i}', 'choices': ['A. yes', 'B. no'],
                 'correctAnswer': 'A. yes'} for i in range(10)
            ],
        })
        team = self.room_ref.collection('teams').document('1')
        team.set({
            'name': 'Frost', 'color': '#22D3EE', 'score': 0,
            'memberIds': [str(self.a.id), str(self.b.id)], 'memberCount': 2,
            'powerups': {'freeze': 2, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        for i, user in enumerate((self.a, self.b)):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': f'F{i}', 'score': 0, 'teamId': '1', 'isFinished': False,
                'questionOrder': list(range(10)),
                'powerups': {'freeze': 5, 'hint': 0, 'doublePoints': 0, 'shield': 0},
            })

    def team(self):
        return self.room_ref.collection('teams').document('1').get().to_dict()

    def player(self, user):
        return self.room_ref.collection('players').document(str(user.id)).get().to_dict()

    def freeze(self, user, index=3):
        self.client.force_authenticate(user=user)
        return self.client.post(reverse('freeze-timer'), {
            'roomCode': 'FRZ1', 'questionIndex': index,
        }, format='json')

    def test_freeze_spends_the_shared_team_pool_not_the_player(self):
        response = self.freeze(self.a)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.team()['powerups']['freeze'], 1)
        # The player's own personal count is deliberately left untouched.
        self.assertEqual(self.player(self.a)['powerups']['freeze'], 5)

    def test_freeze_records_the_question_so_a_teammate_does_not_inherit_it(self):
        self.assertEqual(self.freeze(self.a, index=3).status_code, 200)
        self.assertEqual(self.player(self.a)['frozenQuestion'], 3)
        # A different teammate freezing is their own charge, not a free carry-over.
        self.assertEqual(self.freeze(self.b, index=3).status_code, 200)
        self.assertEqual(self.team()['powerups']['freeze'], 0)
        self.assertEqual(self.player(self.b)['frozenQuestion'], 3)

    def test_freeze_is_rejected_when_the_pool_is_empty(self):
        self.team()['powerups']['freeze'] = 0
        self.room_ref.collection('teams').document('1').set(self.team())
        response = self.freeze(self.a)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.team()['powerups']['freeze'], 0)

    def test_freeze_requires_the_room_to_be_running(self):
        self.room_ref.set({'status': 'waiting', 'teamMode': True}, merge=True)
        self.assertEqual(self.freeze(self.a).status_code, 400)

    def test_freeze_works_in_solo_mode_from_the_personal_pool(self):
        self.room_ref.set({'status': 'active', 'teamMode': False}, merge=True)
        response = self.freeze(self.a)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.player(self.a)['powerups']['freeze'], 4)
        # The team pool is not consulted at all in solo play.
        self.assertEqual(self.team()['powerups']['freeze'], 2)

    def test_freeze_rejects_a_player_outside_the_room(self):
        self.room_ref.collection('players').document(str(self.b.id)).delete()
        self.assertEqual(self.freeze(self.b).status_code, 403)


class CustomLobbyQuizTests(TestCase):
    """A CODM-style custom lobby creates the room first and picks the quiz
    afterwards, so creation has to tolerate an empty question set and start has
    to refuse to run until a host has chosen one."""

    def setUp(self):
        self.host = User.objects.create_user(username='chost', password='pass')
        self.p1 = User.objects.create_user(username='cp1', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.client.force_authenticate(user=self.host)

    def make_quiz(self, count=4, title='Custom Quiz'):
        quiz = Quiz.objects.create(user=self.host, title=title)
        for i in range(count):
            QuizQuestion.objects.create(
                quiz=quiz, question_text=f'Q{i}',
                options=['yes', 'no'], correct_answer='yes',
            )
        return quiz

    def create_room(self, **extra):
        payload = {'teamMode': True, 'teamCount': 2, 'deferQuiz': True, 'timePerQuestion': 15}
        payload.update(extra)
        return self.client.post(reverse('create-game'), payload, format='json')

    def room(self, code):
        return self.store.collection('gameRooms').document(code).get().to_dict()

    def seat_host(self, code, team_id='1'):
        """Start refuses to run while anyone is unassigned, which is a separate
        guard from the quiz one. Put the host on a team so the quiz logic is
        what these tests are actually exercising."""
        self.store.collection('gameRooms').document(code)\
            .collection('players').document(str(self.host.id)).update({'teamId': team_id})

    def test_create_defers_the_quiz(self):
        resp = self.create_room()
        self.assertEqual(resp.status_code, 200)
        code = resp.data['roomCode']

        room = self.room(code)
        self.assertTrue(room['quizPending'])
        self.assertEqual(room['questions'], [])
        self.assertNotIn('quizId', room)
        # Teams exist immediately so players can fill the columns.
        self.assertTrue(room['teamMode'])
        self.assertEqual(room['teamCount'], 2)

    def test_set_quiz_materialises_questions(self):
        quiz = self.make_quiz()
        code = self.create_room().data['roomCode']

        resp = self.client.post(reverse('set-quiz'),
                                {'roomCode': code, 'quizId': quiz.id}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data['quizPending'])
        self.assertEqual(resp.data['questionCount'], 4)

        room = self.room(code)
        self.assertEqual(len(room['questions']), 4)
        self.assertEqual(room['topic'], 'Custom Quiz')
        self.assertEqual(room['quizId'], quiz.id)
        self.assertFalse(room['quizPending'])

    def test_set_quiz_rejects_a_non_host(self):
        quiz = self.make_quiz()
        code = self.create_room().data['roomCode']
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('set-quiz'),
                                {'roomCode': code, 'quizId': quiz.id}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_set_quiz_rejects_someone_elses_quiz(self):
        quiz = Quiz.objects.create(user=self.p1, title='Not Mine')
        QuizQuestion.objects.create(quiz=quiz, question_text='Q',
                                    options=['yes', 'no'], correct_answer='yes')
        code = self.create_room().data['roomCode']
        resp = self.client.post(reverse('set-quiz'),
                                {'roomCode': code, 'quizId': quiz.id}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_set_quiz_rejects_a_quiz_too_short_for_the_teams(self):
        quiz = self.make_quiz(count=1)
        code = self.create_room(teamCount=3).data['roomCode']
        resp = self.client.post(reverse('set-quiz'),
                                {'roomCode': code, 'quizId': quiz.id}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Not enough questions', resp.data['error'])

    def test_start_without_a_quiz_is_refused(self):
        code = self.create_room().data['roomCode']
        self.seat_host(code)
        resp = self.client.post(reverse('start-game'), {'roomCode': code}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Choose a quiz', resp.data['error'])

    def test_start_after_set_quiz_succeeds(self):
        quiz = self.make_quiz()
        code = self.create_room().data['roomCode']
        self.client.post(reverse('set-quiz'),
                         {'roomCode': code, 'quizId': quiz.id}, format='json')
        self.seat_host(code)
        resp = self.client.post(reverse('start-game'), {'roomCode': code}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.room(code)['status'], 'active')

    def test_start_rebuilds_questions_if_the_set_quiz_write_was_lost(self):
        # Simulates an interrupted set-quiz: the room remembers the quiz but
        # never got its questions, so start has to materialise them itself.
        quiz = self.make_quiz()
        code = self.create_room().data['roomCode']
        self.store.collection('gameRooms').document(code).set(
            {'quizId': quiz.id, 'questions': [], 'questionCount': 0, 'quizPending': True},
            merge=True)
        self.seat_host(code)
        resp = self.client.post(reverse('start-game'), {'roomCode': code}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(self.room(code)['questions']), 4)

    def test_join_reports_a_pending_quiz_and_persists_team_capacity(self):
        code = self.create_room().data['roomCode']
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('join-game'), {'roomCode': code}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['quizPending'])
        # The waiting lobby renders columns from the room document, so the
        # capacity has to live there too.
        self.assertIn('maxTeamSize', self.room(code))
        self.assertEqual(resp.data['maxTeamSize'], self.room(code)['maxTeamSize'])

    def test_join_drops_the_pending_flag_once_a_quiz_is_set(self):
        quiz = self.make_quiz()
        code = self.create_room().data['roomCode']
        self.client.post(reverse('set-quiz'),
                         {'roomCode': code, 'quizId': quiz.id}, format='json')
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('join-game'), {'roomCode': code}, format='json')
        self.assertNotIn('quizPending', resp.data)


class TransactionFidelityRegressionTests(TestCase):
    """Guards the two Firestore transaction mistakes that only ever showed up
    in production, because the test fake used to be more forgiving than the
    real SDK:

    * ``transaction.get()`` yields snapshots lazily, so calling ``.to_dict()``
      straight on the return value raises. Team answers and freeze charges both
      did exactly that.
    * A transaction may not read after it has written. Moving between teams
      used to read the old team document after updating the new one.
    """

    def setUp(self):
        self.host = User.objects.create_user(username='fhost', password='pass')
        self.a = User.objects.create_user(username='fa', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('TXN1')
        self.room_ref.set({
            'status': 'active',
            'hostId': self.host.id,
            'teamMode': True,
            'teamCount': 2,
            'timePerQuestion': 15,
            'questions': [
                {'type': 'mcq', 'question': f'Q{i}', 'choices': ['A. yes', 'B. no'],
                 'correctAnswer': 'A. yes'} for i in range(10)
            ],
        })
        teams = self.room_ref.collection('teams')
        teams.document('1').set({
            'name': 'Alphas', 'color': '#22D3EE', 'score': 0, 'correctCount': 0,
            'answeredCount': 0, 'memberIds': [str(self.a.id)], 'memberCount': 1,
            'teamCorrect': 0, 'multiplier': 1.0, 'boostTarget': '', 'boostQuestion': -1,
            'powerups': {'freeze': 1, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        teams.document('2').set({
            'name': 'Betas', 'color': '#10B981', 'score': 0, 'correctCount': 0,
            'answeredCount': 0, 'memberIds': [], 'memberCount': 0,
            'teamCorrect': 0, 'multiplier': 1.0,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        self.room_ref.collection('players').document(str(self.a.id)).set({
            'displayName': 'PA', 'score': 0, 'answeredCount': 0, 'correctCount': 0,
            'streak': 0, 'questionOrder': list(range(10)), 'teamId': '1',
            'isFinished': False,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })

    def test_transaction_get_yields_a_generator_not_a_snapshot(self):
        """The exact trap: the return value has no .to_dict()."""
        txn = FakeTransaction(self.store._store)
        txn._begin()
        ref = self.room_ref.collection('teams').document('1')
        result = txn.get(ref)
        self.assertFalse(hasattr(result, 'to_dict'))
        self.assertEqual(next(result).to_dict()['name'], 'Alphas')

    def test_answering_in_team_mode_scores_the_team(self):
        """Regression: this returned 500 in production on every team answer."""
        self.client.force_authenticate(user=self.a)
        resp = self.client.post(
            reverse('answer-question'),
            {'roomCode': 'TXN1', 'questionIndex': 0, 'answer': 'A. yes', 'timeTaken': '1'},
            format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        team = self.room_ref.collection('teams').document('1').get().to_dict()
        self.assertGreater(team['score'], 0)
        self.assertEqual(team['answeredCount'], 1)
        self.assertEqual(team['correctCount'], 1)

    def test_freeze_charges_the_shared_pool(self):
        """Same generator trap as the team answer, in the powerup path."""
        self.client.force_authenticate(user=self.a)
        resp = self.client.post(
            reverse('freeze-timer'),
            {'roomCode': 'TXN1', 'questionIndex': 0}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        team = self.room_ref.collection('teams').document('1').get().to_dict()
        self.assertEqual(team['powerups']['freeze'], 0)
        player = self.room_ref.collection('players').document(str(self.a.id)).get().to_dict()
        self.assertEqual(player['frozenQuestion'], 0)

    def test_moving_teams_issues_every_read_before_any_write(self):
        """A read after a write is illegal on Firestore."""
        # Team moves are only legal in the lobby, so this room is still waiting.
        self.room_ref.update({'status': 'waiting'})
        self.client.force_authenticate(user=self.a)
        resp = self.client.post(
            reverse('assign-team'),
            {'roomCode': 'TXN1', 'teamId': '2'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        teams = self.room_ref.collection('teams')
        self.assertNotIn(str(self.a.id), teams.document('1').get().to_dict()['memberIds'])
        self.assertIn(str(self.a.id), teams.document('2').get().to_dict()['memberIds'])

    def test_reading_after_writing_raises_in_the_fake(self):
        """So the ordering rule is enforced by the suite, not by production."""
        txn = FakeTransaction(self.store._store)
        txn._begin()
        ref = self.room_ref.collection('teams').document('1')
        txn.update(ref, {'score': 5})
        with self.assertRaises(FakeStoreError):
            next(txn.get(ref))

    def test_listing_a_collection_inside_a_transaction_raises_in_the_fake(self):
        """Real CollectionReference.stream() takes no transaction argument.

        AddTeamView once read the teams collection with
        ``stream(transaction=...)`` to work out the next team id. The fake
        accepted and ignored the kwarg, so the suite was green and production
        raised TypeError. The fake now refuses it, which is the point: a
        transactional read has to go through transaction.get().
        """
        teams = self.room_ref.collection('teams')
        with self.assertRaises(TypeError):
            teams.stream(transaction=object())

    def test_add_team_derives_the_next_id_without_listing_the_collection(self):
        """The in-transaction path must read only the room document."""
        self.room_ref.update({'status': 'waiting'})
        self.client.force_authenticate(user=self.host)
        resp = self.client.post(
            reverse('add-team'), {'roomCode': 'TXN1'}, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['teamId'], '3')
        self.assertEqual(self.room_ref.get().to_dict()['teamCount'], 3)
        # Ids are numeric strings, so '3' sorts after '1' and '2' in the UI
        # instead of appearing as a separate "1" column.
        teams = self.room_ref.collection('teams')
        self.assertEqual(teams.document('3').get().to_dict()['name'], 'Team 3')
        self.assertEqual(
            sorted(t.id for t in teams.stream()),
            ['1', '2', '3'],
        )


class SpectatorColumnAndAddTeamTests(TestCase):
    """The spectator column and host-added teams.

    Spectating is modelled as "no teamId" rather than as a real team, so
    unassigning is the same transaction as joining with the decrement flipped.
    Adding a team has to move the new document and the room's teamCount
    together, and must never leave a room that SetQuizView will then refuse.
    """

    def setUp(self):
        self.host = User.objects.create_user(username='shost', password='pass')
        self.p1 = User.objects.create_user(username='sp1', password='pass')
        self.p2 = User.objects.create_user(username='sp2', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('SPC1')
        self.room_ref.set({
            'status': 'waiting', 'hostId': self.host.id, 'teamMode': True,
            'teamCount': 2, 'questionCount': 10, 'topic': 't', 'timePerQuestion': 15,
            'questions': [
                {'type': 'mcq', 'question': f'q{i}', 'choices': ['A. y'], 'correctAnswer': 'A. y'}
                for i in range(10)
            ],
        })
        for i in (1, 2):
            self.room_ref.collection('teams').document(str(i)).set({
                'name': f'Team {i}', 'color': TEAM_COLORS[i - 1], 'score': 0,
                'correctCount': 0, 'answeredCount': 0, 'memberIds': [], 'memberCount': 0,
                'teamCorrect': 0, 'multiplier': 1.0, 'nameLocked': False,
                'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
            })
        for user in (self.host, self.p1, self.p2):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': 0, 'teamId': None, 'isFinished': False,
            })

    def team(self, team_id):
        return self.room_ref.collection('teams').document(team_id).get().to_dict()

    def player(self, user):
        return self.room_ref.collection('players').document(str(user.id)).get().to_dict()

    def room(self):
        return self.room_ref.get().to_dict()

    def assign(self, user, team_id):
        self.client.force_authenticate(user=user)
        return self.client.post(reverse('assign-team'),
                                {'roomCode': 'SPC1', 'teamId': team_id}, format='json')

    def add_team(self, user=None):
        self.client.force_authenticate(user=user or self.host)
        return self.client.post(reverse('add-team'), {'roomCode': 'SPC1'}, format='json')

    # -- the spectator column --

    def test_players_start_unassigned_so_the_client_shows_them_in_spectators(self):
        for user in (self.host, self.p1, self.p2):
            self.assertIsNone(self.player(user).get('teamId'))

    def test_a_null_team_id_sends_the_player_back_to_the_spectators(self):
        self.assertEqual(self.assign(self.p1, '1').status_code, 200)
        self.assertEqual(self.team('1')['memberCount'], 1)

        resp = self.assign(self.p1, None)
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()['teamId'])
        self.assertEqual(self.team('1')['memberIds'], [])
        self.assertEqual(self.team('1')['memberCount'], 0)

    def test_unassigning_deletes_the_field_rather_than_nulling_it(self):
        self.assign(self.p1, '1')
        self.assign(self.p1, None)
        # A leftover null would read differently from a missing field, and the
        # roster is the single source of truth for who is spectating.
        self.assertNotIn('teamId', self.player(self.p1))

    def test_unassigning_when_already_spectating_is_a_no_op(self):
        resp = self.assign(self.p1, None)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.team('1')['memberCount'], 0)
        self.assertEqual(self.team('2')['memberCount'], 0)

    def test_omitting_team_id_entirely_is_rejected_rather_than_unassigning(self):
        """A client bug must not silently pull a player out of their team."""
        self.assertEqual(self.assign(self.p1, '1').status_code, 200)
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('assign-team'),
                                {'roomCode': 'SPC1'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.player(self.p1)['teamId'], '1')
        self.assertEqual(self.team('1')['memberCount'], 1)

    def test_a_blank_team_id_counts_as_spectating(self):
        self.assertEqual(self.assign(self.p1, '1').status_code, 200)
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('assign-team'),
                                {'roomCode': 'SPC1', 'teamId': '   '}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.player(self.p1).get('teamId'), None)
        self.assertEqual(self.team('1')['memberCount'], 0)


    def test_join_then_leave_returns_both_rosters_to_their_starting_state(self):
        self.assign(self.p1, '1')
        self.assign(self.p1, '2')
        self.assertEqual(self.team('2')['memberIds'], [str(self.p1.id)])

        self.assign(self.p1, None)
        for tid in ('1', '2'):
            self.assertEqual(self.team(tid)['memberIds'], [], tid)
            self.assertEqual(self.team(tid)['memberCount'], 0, tid)
        self.assertNotIn('teamId', self.player(self.p1))

    def test_one_player_spectating_does_not_free_a_slot_someone_else_took(self):
        self.assign(self.p1, '1')
        self.assign(self.p2, '1')
        self.assign(self.p1, None)
        self.assertEqual(self.team('1')['memberIds'], [str(self.p2.id)])
        self.assertEqual(self.team('1')['memberCount'], 1)

    # -- adding a team --

    def test_host_can_add_a_team_which_is_named_by_its_slot(self):
        resp = self.add_team()
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['teamCount'], 3)

        team = self.team('3')
        self.assertEqual(team['name'], 'Team 3')
        self.assertEqual(team['color'], TEAM_COLORS[2])
        self.assertEqual(team['memberIds'], [])
        self.assertEqual(team['memberCount'], 0)
        self.assertEqual(team['score'], 0)
        self.assertEqual(team['multiplier'], 1.0)
        self.assertEqual(team['powerups'], {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0})

    def test_adding_a_team_keeps_the_room_count_in_step_with_the_documents(self):
        self.add_team()
        self.add_team()
        # If these drift, the room claims four teams while only three exist and
        # the auto-assign at start writes memberIds into a team nobody created.
        self.assertEqual(self.room()['teamCount'], 4)
        team_ids = sorted(int(snap.id) for snap in self.room_ref.collection('teams').stream())
        self.assertEqual(team_ids, [1, 2, 3, 4])

    def test_an_added_team_can_be_joined(self):
        self.add_team()
        resp = self.assign(self.p1, '3')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.player(self.p1)['teamId'], '3')
        self.assertEqual(self.team('3')['memberIds'], [str(self.p1.id)])

    def test_only_the_host_can_add_a_team(self):
        self.assertEqual(self.add_team(self.p1).status_code, 403)
        self.assertEqual(self.add_team(self.p2).status_code, 403)
        self.assertEqual(self.room()['teamCount'], 2)

    def test_cannot_add_a_team_beyond_the_question_count(self):
        # A quiz shorter than the team count is refused by SetQuizView, so the
        # host has to learn about it here rather than get a dead room.
        self.room_ref.update({'questionCount': 2})
        resp = self.add_team()
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Not enough questions', resp.json()['error'])
        self.assertEqual(self.room()['teamCount'], 2)
        self.assertIsNone(self.team('3'))

    def test_teams_can_be_added_while_the_quiz_is_still_pending(self):
        # questionCount is 0 until a quiz is chosen, so there is nothing to
        # measure against yet and SetQuizView keeps enforcing it later.
        self.room_ref.update({'questionCount': 0, 'quizPending': True})
        resp = self.add_team()
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(self.room()['teamCount'], 3)

    def test_cannot_add_more_than_the_team_ceiling(self):
        self.room_ref.update({'teamCount': 20})
        resp = self.add_team()
        self.assertEqual(resp.status_code, 400)
        self.assertIn('at most', resp.json()['error'])

    def test_cannot_add_a_team_once_the_game_has_started(self):
        self.room_ref.update({'status': 'active'})
        self.assertEqual(self.add_team().status_code, 400)

    def test_cannot_add_a_team_to_a_room_that_is_not_in_team_mode(self):
        self.room_ref.update({'teamMode': False})
        self.assertEqual(self.add_team().status_code, 400)

    def test_spectators_are_dealt_into_teams_when_the_host_forces_the_start(self):
        # Starting with people in the spectator column is the normal state now,
        # so the host has to be able to wave them through.
        self.add_team()
        self.client.force_authenticate(user=self.host)
        blocked = self.client.post(reverse('start-game'), {'roomCode': 'SPC1'}, format='json')
        self.assertEqual(blocked.status_code, 400)

        forced = self.client.post(reverse('start-game'),
                                  {'roomCode': 'SPC1', 'force': 'true'}, format='json')
        self.assertEqual(forced.status_code, 200)
        for user in (self.host, self.p1, self.p2):
            self.assertIsNotNone(self.player(user)['teamId'])


class SpectatorCannotCompeteTests(TestCase):
    """A spectator watches. They must not score, and they must not be able to
    hold the room open forever."""

    def setUp(self):
        self.host = User.objects.create_user(username='fhost', password='pass')
        self.member = User.objects.create_user(username='fmember', password='pass')
        self.watcher = User.objects.create_user(username='fwatcher', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('WATCH1')
        self.room_ref.set({
            'status': 'active', 'hostId': self.host.id, 'teamMode': True,
            'teamCount': 2, 'timePerQuestion': 15,
            'questions': [
                {'type': 'mcq', 'question': f'Q{i}', 'choices': ['A. yes', 'B. no'],
                 'correctAnswer': 'A. yes'} for i in range(4)
            ],
        })
        teams = self.room_ref.collection('teams')
        teams.document('1').set({
            'name': 'Alphas', 'color': '#22D3EE', 'score': 0, 'correctCount': 0,
            'answeredCount': 0, 'memberIds': [str(self.member.id)], 'memberCount': 1,
            'teamCorrect': 0, 'multiplier': 1.0,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        teams.document('2').set({
            'name': 'Betas', 'color': '#10B981', 'score': 0, 'correctCount': 0,
            'answeredCount': 0, 'memberIds': [], 'memberCount': 0,
            'teamCorrect': 0, 'multiplier': 1.0,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        for user, team_id in ((self.member, '1'), (self.watcher, None)):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': 0, 'answeredCount': 0,
                'correctCount': 0, 'streak': 0, 'questionOrder': [0, 1, 2, 3],
                'teamId': team_id, 'isFinished': False,
                'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
            })

    def player(self, user):
        return self.room_ref.collection('players').document(str(user.id)).get().to_dict()

    def answer(self, user, index=0, answer='A. yes'):
        self.client.force_authenticate(user=user)
        return self.client.post(reverse('answer-question'), {
            'roomCode': 'WATCH1', 'questionIndex': index,
            'answer': answer, 'timeTaken': '1',
        }, format='json')

    def finish(self, user):
        self.client.force_authenticate(user=user)
        return self.client.post(reverse('finish-game'), {'roomCode': 'WATCH1'}, format='json')

    def test_a_spectator_answer_is_rejected(self):
        resp = self.answer(self.watcher)
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(resp.json()['spectator'])

    def test_a_rejected_spectator_answer_writes_nothing(self):
        self.answer(self.watcher, answer='A. yes')
        watcher = self.player(self.watcher)
        self.assertEqual(watcher['score'], 0)
        self.assertEqual(watcher['answeredCount'], 0)
        self.assertEqual(watcher.get('answers'), None)

    def test_a_spectator_cannot_drain_a_powerup_pool(self):
        # The spectator carries a pool of their own; answering must not debit it.
        self.room_ref.collection('players').document(str(self.watcher.id)).update({
            'powerups': {'freeze': 0, 'hint': 1, 'doublePoints': 1, 'shield': 1},
        })
        self.answer(self.watcher, index=0)
        self.assertEqual(self.player(self.watcher)['powerups']['hint'], 1)

    def test_a_team_member_can_still_answer(self):
        self.assertEqual(self.answer(self.member).status_code, 200)

    def test_a_spectator_does_not_block_auto_settlement(self):
        # The member finishes; the spectator never will. The room must settle,
        # otherwise placement XP is never paid to anyone.
        self.client.force_authenticate(user=self.member)
        self.room_ref.collection('players').document(str(self.member.id)).update({
            'isFinished': True,
        })
        resp = self.finish(self.member)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['allFinished'])
        self.assertEqual(self.room_ref.get().to_dict()['status'], 'finished')

    def test_classic_mode_still_waits_for_every_non_host(self):
        # A third player who is still playing. Without them this proves
        # nothing: the finish view marks the CALLER finished before it checks
        # the room, so with only one other player everybody is always done.
        lurker = User.objects.create_user(username='flurker', password='pass')
        self.room_ref.collection('players').document(str(lurker.id)).set({
            'displayName': 'lurker', 'score': 0, 'answeredCount': 0,
            'isFinished': False, 'teamId': None,
        })

        # No teamId anywhere, so nobody is a spectator here: the spectator
        # branch must not fire and a still-playing friend must still hold the
        # room open, exactly as before.
        self.room_ref.update({'teamMode': False})
        self.room_ref.collection('players').document(str(self.member.id)).update({
            'teamId': None, 'isFinished': True,
        })
        resp = self.finish(self.watcher)
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['allFinished'])

    def test_classic_mode_lets_a_teamless_player_answer(self):
        # "No teamId" only means spectator in TEAM mode. In classic mode the
        # field is simply unused and answering must still work.
        self.room_ref.update({'teamMode': False})
        self.assertEqual(self.answer(self.watcher).status_code, 200)


class SoloMomentumTests(TestCase):
    """Classic mode used to be a flat line: every correct answer was worth the
    same base points, and `multiplier`/`bestStreak` were read off the player
    document but never written to it."""

    def setUp(self):
        self.host = User.objects.create_user(username='shost2', password='pass')
        self.solo = User.objects.create_user(username='ssolo', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('SOLO9')
        self.room_ref.set({
            'status': 'active', 'hostId': self.host.id, 'teamMode': False,
            'timePerQuestion': 15,
            'questions': [
                {'type': 'mcq', 'question': f'Q{i}', 'choices': ['A. yes', 'B. no'],
                 'correctAnswer': 'A. yes'} for i in range(30)
            ],
        })
        self.room_ref.collection('players').document(str(self.solo.id)).set({
            'displayName': 'Solo', 'score': 0, 'answeredCount': 0, 'correctCount': 0,
            'streak': 0, 'questionOrder': list(range(30)), 'teamId': None,
            'isFinished': False, 'multiplier': 1.0, 'bestStreak': 0,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })

    def player(self):
        return self.room_ref.collection('players').document(str(self.solo.id)).get().to_dict()

    def answer(self, index, answer='A. yes', **extra):
        self.client.force_authenticate(user=self.solo)
        payload = {'roomCode': 'SOLO9', 'questionIndex': index, 'answer': answer, 'timeTaken': '1'}
        payload.update(extra)
        return self.client.post(reverse('answer-question'), payload, format='json')

    def test_the_first_five_answers_are_ungripped_then_the_sixth_is_boosted(self):
        base = max(int(1000 * (1 - (1 / 15) * 0.5)), 500)
        for i in range(5):
            self.assertEqual(self.answer(i).json()['pointsAwarded'], base)

        # The 6th answer is the first one past the 5-correct threshold, exactly
        # as with a team: the tier you earn applies to the NEXT answer.
        sixth = self.answer(5).json()
        self.assertEqual(sixth['pointsAwarded'], round(base * 1.2))
        self.assertEqual(sixth['multiplier'], 1.2)

    def test_the_multiplier_is_persisted_on_the_player_document(self):
        for i in range(5):
            self.answer(i)
        self.assertEqual(self.player()['multiplier'], 1.2)

    def test_best_streak_is_persisted_and_survives_a_miss(self):
        for i in range(4):
            self.answer(i)
        self.assertEqual(self.player()['bestStreak'], 4)

        self.answer(4, answer='B. no')
        self.assertEqual(self.player()['streak'], 0)
        self.assertEqual(self.player()['bestStreak'], 4)

    def test_a_miss_demotes_one_rung_and_a_correct_answer_restores_it(self):
        for i in range(5):
            self.answer(i)
        self.assertEqual(self.player()['multiplier'], 1.2)

        self.answer(5, answer='B. no')
        self.assertEqual(self.player()['multiplier'], 1.0)

        # correctCount is untouched by the miss, so the ladder comes back.
        self.answer(6)
        self.assertEqual(self.player()['multiplier'], 1.2)

    def test_a_shield_holds_the_rung_on_a_miss(self):
        for i in range(5):
            self.answer(i)
        # The shield has to actually be in the pool: `can_use` only honours the
        # flag when the pool can pay for it, so an empty shield is a no-op.
        self.room_ref.collection('players').document(str(self.solo.id)).update({
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 1},
        })
        self.answer(5, answer='B. no', useShield='true')
        self.assertEqual(self.player()['multiplier'], 1.2)

    def test_the_speed_bonus_is_reported_separately_from_the_points(self):
        base = max(int(1000 * (1 - (1 / 15) * 0.5)), 500)
        body = self.answer(0).json()
        self.assertEqual(body['basePoints'], base)
        self.assertEqual(body['speedBonus'], base - 500)

    def test_a_slow_answer_has_no_speed_bonus(self):
        body = self.answer(0, timeTaken='15').json()
        self.assertEqual(body['basePoints'], 500)
        self.assertEqual(body['speedBonus'], 0)

    def test_a_wrong_answer_reports_no_points_and_no_speed_bonus(self):
        body = self.answer(0, answer='B. no').json()
        self.assertFalse(body['correct'])
        self.assertEqual(body['pointsAwarded'], 0)
        self.assertEqual(body['speedBonus'], 0)


class AnswerLogTests(TestCase):
    """The per-question log the results screen reads."""

    def setUp(self):
        self.host = User.objects.create_user(username='lhost', password='pass')
        self.a = User.objects.create_user(username='la', password='pass')
        self.b = User.objects.create_user(username='lb', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('LOG1')
        self.room_ref.set({
            'status': 'active', 'hostId': self.host.id, 'teamMode': True,
            'teamCount': 2, 'timePerQuestion': 15,
            'questions': [
                {'type': 'mcq', 'question': f'Q{i}', 'choices': ['A. yes', 'B. no'],
                 'correctAnswer': 'A. yes'} for i in range(4)
            ],
        })
        teams = self.room_ref.collection('teams')
        for i, name in ((1, 'Alphas'), (2, 'Betas')):
            teams.document(str(i)).set({
                'name': name, 'color': TEAM_COLORS[i - 1], 'score': 0,
                'correctCount': 0, 'answeredCount': 0, 'memberIds': [], 'memberCount': 0,
                'teamCorrect': 0, 'multiplier': 1.0,
                'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
            })
        # Deliberately DIFFERENT orders, to prove the log is keyed by the
        # canonical question index and not by each player's position in their
        # own shuffle.
        for user, team_id, order in ((self.a, '1', [2, 0, 1, 3]), (self.b, '2', [3, 1, 0, 2])):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': 0, 'answeredCount': 0,
                'correctCount': 0, 'streak': 0, 'questionOrder': order,
                'teamId': team_id, 'isFinished': False,
                'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
            })

    def answers(self, user):
        return self.room_ref.collection('players').document(str(user.id)).get().to_dict()['answers']

    def answer(self, user, index, answer='A. yes'):
        self.client.force_authenticate(user=user)
        return self.client.post(reverse('answer-question'), {
            'roomCode': 'LOG1', 'questionIndex': index,
            'answer': answer, 'timeTaken': '1',
        }, format='json')

    def test_each_answer_is_logged_under_its_canonical_question_index(self):
        self.answer(self.a, 0)
        self.assertIn('q0', self.answers(self.a))

        # Same canonical question, different position in each shuffle.
        self.answer(self.a, 2, answer='B. no')
        self.answer(self.b, 1, answer='B. no')
        self.assertIn('q2', self.answers(self.a))
        self.assertIn('q1', self.answers(self.b))

    def test_the_log_records_what_was_picked_and_whether_it_was_right(self):
        self.answer(self.a, 0, answer='B. no')
        entry = self.answers(self.a)['q0']
        self.assertFalse(entry['correct'])
        self.assertEqual(entry['picked'], 'B. no')
        self.assertEqual(entry['points'], 0)

        self.answer(self.a, 1, answer='A. yes')
        entry = self.answers(self.a)['q1']
        self.assertTrue(entry['correct'])
        self.assertEqual(entry['picked'], 'A. yes')
        self.assertGreater(entry['points'], 0)

    def test_a_timeout_is_logged_as_a_miss_with_nothing_picked(self):
        self.answer(self.a, 0, answer='')
        entry = self.answers(self.a)['q0']
        self.assertFalse(entry['correct'])
        self.assertEqual(entry['picked'], '')

    def test_a_replayed_answer_does_not_duplicate_or_overwrite_its_entry(self):
        first = self.answer(self.a, 0, answer='A. yes').json()
        again = self.answer(self.a, 0, answer='A. yes').json()
        # The idempotency cache means the replay scores nothing new.
        self.assertEqual(first['pointsAwarded'], again['pointsAwarded'])
        self.assertEqual(len(self.answers(self.a)), 1)


class FairTeamRankingTests(TestCase):
    """Teams are ranked on average points per active member, and the XP that
    gets paid is computed from that same number."""

    def setUp(self):
        self.host = User.objects.create_user(username='rhost', password='pass')
        self.bigs = [User.objects.create_user(username=f'rbig{i}', password='pass') for i in range(3)]
        self.small = User.objects.create_user(username='rsmall', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('FAIR1')
        self.room_ref.set({
            'status': 'active', 'hostId': self.host.id, 'teamMode': True,
            'teamCount': 2, 'timePerQuestion': 15, 'questions': [],
        })
        teams = self.room_ref.collection('teams')
        # Big team banks 3x the total but only matches on the average.
        teams.document('1').set({
            'name': 'Big', 'color': TEAM_COLORS[0], 'score': 3000,
            'correctCount': 3, 'answeredCount': 3,
            'memberIds': [str(u.id) for u in self.bigs], 'memberCount': 3,
            'powerups': {},
        })
        teams.document('2').set({
            'name': 'Small', 'color': TEAM_COLORS[1], 'score': 2000,
            'correctCount': 2, 'answeredCount': 2,
            'memberIds': [str(self.small.id)], 'memberCount': 1,
            'powerups': {},
        })
        for u in self.bigs:
            self.room_ref.collection('players').document(str(u.id)).set({
                'displayName': u.username, 'score': 1000, 'answeredCount': 1,
                'correctCount': 1, 'streak': 1, 'teamId': '1', 'isFinished': True,
            })
        self.room_ref.collection('players').document(str(self.small.id)).set({
            'displayName': 'small', 'score': 2000, 'answeredCount': 2,
            'correctCount': 2, 'streak': 2, 'teamId': '2', 'isFinished': True,
        })

    def finish_as(self, user):
        self.client.force_authenticate(user=user)
        return self.client.post(reverse('finish-game'), {'roomCode': 'FAIR1'}, format='json')

    def test_the_smaller_team_wins_on_average_not_on_raw_total(self):
        # Raw scores are 3000 vs 2000, so ranking on totals puts Big first.
        self.assertEqual(self.room_ref.collection('teams').document('1').get().to_dict()['score'], 3000)
        resp = self.finish_as(self.small)
        self.assertEqual(resp.json()['teamRank'], 1)

    def test_team_results_snapshot_carries_the_rank_score_it_sorted_on(self):
        self.finish_as(self.small)
        results = self.room_ref.get().to_dict()['teamResults']
        self.assertEqual([r['teamId'] for r in results], ['2', '1'])
        self.assertEqual(results[0]['rankScore'], 2000)
        self.assertEqual(results[1]['rankScore'], 1000)
        # The raw banked total is still there for the "total points" line.
        self.assertEqual(results[0]['score'], 2000)
        self.assertEqual(results[1]['score'], 3000)

    def test_a_member_who_never_answered_does_not_dilute_the_average(self):
        # Add a fourth member to the small team who never played. If the
        # denominator counted them, Small's average would halve and lose.
        self.room_ref.collection('players').document(str(self.bigs[2].id)).update({
            'teamId': '2', 'score': 0, 'answeredCount': 0, 'correctCount': 0,
        })
        results = self.finish_as(self.small) and self.room_ref.get().to_dict()['teamResults']
        by_id = {r['teamId']: r for r in results}
        self.assertEqual(by_id['2']['activeMembers'], 1)
        self.assertEqual(by_id['2']['rankScore'], 2000)
        self.assertEqual(by_id['1']['activeMembers'], 2)

    def test_placement_xp_is_paid_on_the_averaged_ranking(self):
        small_activity = Activity.objects.filter(user=self.small).count()
        self.finish_as(self.small)
        self.assertGreater(Activity.objects.filter(user=self.small).count(), small_activity)

    def test_tied_averages_share_a_rank(self):
        # Both teams at 1000 average -> both rank 1, and the next would be 3.
        self.room_ref.collection('teams').document('1').update({'score': 3000})
        self.room_ref.collection('teams').document('2').update({'score': 1000})
        self.finish_as(self.small)
        results = self.room_ref.get().to_dict()['teamResults']
        self.assertEqual([r['rankScore'] for r in results], [1000, 1000])

    def test_a_team_with_no_active_members_still_has_a_defined_value(self):
        self.room_ref.collection('players').document(str(self.bigs[0].id)).update({
            'score': 0, 'answeredCount': 0,
        })
        results = self.finish_as(self.small) and self.room_ref.get().to_dict()['teamResults']
        by_id = {r['teamId']: r for r in results}
        # Two of Big's three members played, so 3000 / 2.
        self.assertEqual(by_id['1']['rankScore'], 1500)


class QuestionExplanationTests(TestCase):
    """`explanation` is what makes the end-of-session review worth reading, so it
    has to survive the trip from the quiz row into the room document. Without it
    the results screen can only say "wrong" and never why."""

    def setUp(self):
        self.host = User.objects.create_user(username='exhost', password='pass')
        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = APIClient()
        self.client.force_authenticate(user=self.host)

    def create_with_quiz(self, quiz):
        resp = self.client.post(
            reverse('create-game'),
            {'quizId': quiz.id, 'teamMode': False, 'timePerQuestion': 15},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        return self.store.collection('gameRooms')\
            .document(resp.data['roomCode']).get().to_dict()['questions']

    def test_an_explained_question_reaches_the_room(self):
        quiz = Quiz.objects.create(user=self.host, title='Explained')
        QuizQuestion.objects.create(
            quiz=quiz, question_text='Capital of France?', options=['Paris', 'Rome'],
            correct_answer='Paris', explanation='Paris has been the capital since 987.',
        )
        questions = self.create_with_quiz(quiz)
        self.assertEqual(questions[0]['explanation'], 'Paris has been the capital since 987.')

    def test_a_question_with_no_explanation_serialises_as_null(self):
        # Null rather than a missing key, so the client's single
        # `question.explanation` check covers both cases.
        quiz = Quiz.objects.create(user=self.host, title='Bare')
        QuizQuestion.objects.create(
            quiz=quiz, question_text='Bare question', options=['yes', 'no'],
            correct_answer='yes',
        )
        questions = self.create_with_quiz(quiz)
        self.assertIsNone(questions[0]['explanation'])

    def test_an_identification_question_carries_its_explanation_too(self):
        # The else-branch of the builder is a separate dict literal, so the MCQ
        # case passing on its own says nothing about this one.
        quiz = Quiz.objects.create(user=self.host, title='Typo')
        QuizQuestion.objects.create(
            quiz=quiz, question_text='Spelling of colour', options=[], correct_answer='colour',
            explanation='British English uses "colour".',
        )
        questions = self.create_with_quiz(quiz)
        self.assertEqual(questions[0]['type'], 'identification')
        self.assertEqual(questions[0]['explanation'], 'British English uses "colour".')
