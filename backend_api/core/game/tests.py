import json
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.test import APIClient


from users.models import Activity, Course, User
from ai_assistant.models import Quiz, QuizQuestion
from game.models import GameRoom
from game.test_firestore_fake import FakeFirestoreClient, FakeStoreError, FakeTransaction
from game.views import (
    TEAM_COLORS,
    TYPED_QUESTION_TYPES,
    answer_matches,
    build_questions_from_quiz,
    median_pick_time,
    normalise_question_type,
    pick_answer,
    pick_time,
    tally_team_picks,
)


class MedianTeamSpeedTests(TestCase):
    """The team's speed bonus must come from the group, not the last submitter.

    Scoring off whoever settled the question rewarded a member for making their
    teammates wait, and made the payout depend on Firestore write order. These
    cover the helper that decides the number, since that is what every call site
    now reads.
    """

    def test_the_middle_pick_decides(self):
        # One member racing and one member crawling must not swing the team: the
        # middle observation is what they get.
        picks = {
            'a': {'answer': 'A. yes', 'timeTaken': 1.0},
            'b': {'answer': 'A. yes', 'timeTaken': 4.0},
            'c': {'answer': 'A. yes', 'timeTaken': 14.0},
        }
        self.assertEqual(median_pick_time(picks), 4.0)

    def test_an_even_split_averages_the_two_middle_observations(self):
        picks = {
            'a': {'answer': 'A. yes', 'timeTaken': 2.0},
            'b': {'answer': 'A. yes', 'timeTaken': 6.0},
            'c': {'answer': 'A. yes', 'timeTaken': 10.0},
            'd': {'answer': 'A. yes', 'timeTaken': 12.0},
        }
        self.assertEqual(median_pick_time(picks), 8.0)

    def test_no_single_member_can_move_the_result(self):
        # Same shape as the three-pick case with one member submitting instantly
        # and one submitting at the wire. The team time is unchanged.
        steady = {
            'a': {'answer': 'A', 'timeTaken': 5.0},
            'b': {'answer': 'A', 'timeTaken': 5.0},
            'c': {'answer': 'A', 'timeTaken': 5.0},
        }
        gamed = dict(steady)
        gamed['a'] = {'answer': 'A', 'timeTaken': 0.0}
        gamed['c'] = {'answer': 'A', 'timeTaken': 30.0}
        self.assertEqual(median_pick_time(steady), median_pick_time(gamed))

    def test_legacy_string_picks_are_readable(self):
        # A round already in flight when the shape changed holds bare answers.
        self.assertEqual(pick_answer('A. yes'), 'A. yes')
        self.assertEqual(pick_time('A. yes'), None)
        self.assertIsNone(median_pick_time({'a': 'A', 'b': 'A'}))

    def test_a_mixed_room_ignores_the_picks_with_no_time(self):
        picks = {
            'a': {'answer': 'A', 'timeTaken': 3.0},
            'b': {'answer': 'A', 'timeTaken': 5.0},
            'c': 'A',
        }
        # The un-timed pick is excluded rather than counted as the clock limit.
        self.assertEqual(median_pick_time(picks), 4.0)

    def test_absurd_and_unusable_times_are_rejected(self):
        self.assertIsNone(pick_time({'answer': 'A', 'timeTaken': None}))
        self.assertIsNone(pick_time({'answer': 'A', 'timeTaken': 'soon'}))
        self.assertIsNone(pick_time({'answer': 'A', 'timeTaken': -3}))
        self.assertIsNone(pick_time({'answer': 'A', 'timeTaken': 600}))
        self.assertIsNone(median_pick_time({}))

    def test_the_tally_reads_both_pick_shapes(self):
        # The answer is what decides the vote; the time is irrelevant to it.
        picks = {'a': {'answer': 'A. yes', 'timeTaken': 2.0}, 'b': 'A. yes'}
        choice, agreed, pickers, tie, split = tally_team_picks(picks)
        self.assertEqual(choice, 'A. yes')
        self.assertEqual(agreed, 2)
        self.assertEqual(pickers, 2)
        self.assertFalse(tie)
        self.assertFalse(split)


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
            'ownerId': self.host.id,
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
        # Team play runs on one shared question, index and deadline for the whole
        # room, so a seeded active room has to carry them. The clock is already
        # past, which is what lets a test resolve a question with a single pick.
        room_ref.update({
            'teamQuestionIndex': 0,
            'teamStartedAt': timezone.now() - timedelta(seconds=120),
        })
        return room_ref

    def pick(self, index, answer, user=None):
        self.client.force_authenticate(user=user or self.player2)
        return self.client.post(reverse('team-pick'), {
            'roomCode': 'ABC123', 'questionIndex': index, 'answer': answer,
            'timeTaken': '1', 'force': 'true',
        }, format='json')

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
        # Every team starts with an empty shared powerup pool,
        # not just a score.
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

        resp = self.pick(0, 'A. 4')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.json()['correct'])

        player = room_ref.collection('players').document(str(self.player2.id)).get().to_dict()
        team = teams_ref.document('1').get().to_dict()
        self.assertEqual(player['answeredCount'], 1)
        self.assertEqual(player['score'], team['score'])
        self.assertGreater(team['score'], 0)
        self.assertEqual(team['correctCount'], 1)
        self.assertEqual(team['answeredCount'], 1)
        self.assertEqual(teams_ref.document('2').get().to_dict()['score'], 0)

    def test_the_solo_endpoint_refuses_a_team_room(self):
        """Two answering paths in one room would double-count a team answer.

        The solo endpoint used to keep working for team rooms, so a client that
        fell back to it could score a second, independent answer for the same
        shared question. It now redirects to the team endpoint instead.
        """
        self.seed_team_room()
        self.client.force_authenticate(user=self.player2)
        resp = self.client.post(reverse('answer-question'), {
            'roomCode': 'ABC123', 'questionIndex': 0, 'answer': 'A. 4', 'timeTaken': '1',
        }, format='json')
        self.assertEqual(resp.status_code, 409)
        self.assertTrue(resp.json()['useTeamPick'])
        team = self.store.collection('gameRooms').document('ABC123') \
            .collection('teams').document('1').get().to_dict()
        self.assertEqual(team['answeredCount'], 0)
        self.assertEqual(team['score'], 0)

    def test_team_answer_idempotent_retry(self):
        room_ref = self.seed_team_room()
        payload = {'roomCode': 'ABC123', 'questionIndex': 0, 'answer': 'A. 4', 'timeTaken': '1'}

        first = self.pick(0, 'A. 4')
        self.assertEqual(first.status_code, 200, first.data)
        score_after_first = room_ref.collection('teams').document('1').get().to_dict()['score']

        self.client.force_authenticate(user=self.player2)
        resp2 = self.client.post(reverse('team-pick'), {
            **payload, 'force': 'true'}, format='json')
        # The question is already settled, so the retry is refused rather than
        # silently rescored -- the client that missed the first response must not
        # be able to bank the same answer twice.
        self.assertEqual(resp2.status_code, 409)

        team = room_ref.collection('teams').document('1').get().to_dict()
        self.assertEqual(team['answeredCount'], 1)
        self.assertEqual(team['correctCount'], 1)
        self.assertEqual(team['score'], score_after_first)
        player = room_ref.collection('players').document(str(self.player2.id)).get().to_dict()
        self.assertEqual(player['answeredCount'], 1)
        self.assertEqual(team['score'], player['score'])

    def test_team_wrong_answer_only_counts_attempt(self):
        room_ref = self.seed_team_room()
        # The room is on the first question, so a wrong answer has to be asked of
        # the second one: the shared index is the room's, not the client's. Any
        # member of the room may move it on, once the round is over.
        self.client.force_authenticate(user=self.player2)
        advance = self.client.post(reverse('team-advance'), {
            'roomCode': 'ABC123', 'questionIndex': 1}, format='json')
        self.assertEqual(advance.status_code, 200, advance.data)
        room_ref.update({'teamStartedAt': timezone.now() - timedelta(seconds=120)})

        resp = self.pick(1, 'A. 9')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertFalse(resp.json()['correct'])

        team = room_ref.collection('teams').document('1').get().to_dict()
        self.assertEqual(team['answeredCount'], 1)
        self.assertEqual(team['correctCount'], 0)
        self.assertEqual(team['score'], 0)

    def test_a_pick_for_the_wrong_question_is_refused(self):
        """The room's index is authoritative.

        A stale client answering for the question it still has on screen used to
        score against whatever index it sent, which let an out-of-order client
        write to the wrong shared question.
        """
        self.seed_team_room()
        resp = self.pick(1, 'A. 2')
        self.assertEqual(resp.status_code, 409)
        team = self.store.collection('gameRooms').document('ABC123') \
            .collection('teams').document('1').get().to_dict()
        self.assertEqual(team['answeredCount'], 0)
        self.assertEqual(team['score'], 0)

    def test_finish_snapshots_team_results_sorted(self):
        room_ref = self.store.collection('gameRooms').document('FINAL1')
        room_ref.set({
            'status': 'active', 'hostId': self.host.id, 'ownerId': self.host.id,
            'teamMode': True,
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
        resp = self.client.post(reverse('finish-game'), {
            'roomCode': 'FINAL1', 'confirm': 'true'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)

        room = room_ref.get().to_dict()
        self.assertEqual(room['status'], 'finished')
        results = room['teamResults']
        self.assertEqual([r['teamId'] for r in results], ['2', '1'])
        self.assertEqual(results[0]['score'], 800)
        self.assertEqual(results[1]['score'], 300)
        # The finishing position is snapshotted too, so the results screen cannot
        # disagree with the XP that was just paid.
        self.assertEqual([r['rank'] for r in results], [1, 2])

    def test_finish_classic_room_has_no_team_results(self):
        room_ref = self.store.collection('gameRooms').document('SOLO1')
        room_ref.set({
            'status': 'active', 'hostId': self.host.id, 'ownerId': self.host.id,
            'topic': 't', 'questionCount': 1, 'questions': [],
        })
        room_ref.collection('players').document(str(self.host.id)).set({'isFinished': False})

        self.client.force_authenticate(user=self.host)
        self.client.post(reverse('finish-game'), {
            'roomCode': 'SOLO1', 'confirm': 'true'}, format='json')

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
        # No points consolation was substituted for the powerup: the score is
        # exactly the base award per answer, plus the documented streak bonus on
        # the run. A powerup is never worth points.
        per_answer = max(int(1000 * (1 - (1 / 15) * 0.5)), 500)
        # The third correct answer completes a run of three, which is the x1.1
        # streak rung.
        expected = (self.STREAK_REWARD_INTERVAL - 1) * per_answer + round(per_answer * 1.1)
        self.assertEqual(self.player_doc(player_ref)['score'], expected)

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


class BlankAnswerTests(TestCase):
    """Running out of time is a miss, not an opening.

    A timeout posts an empty answer. Every guard in the old flow was written
    against the answer TEXT, and `''` is falsy, so a blank slipped past all of
    them and was then scored as a real attempt that happened to spend the
    player's powerups. These pin the two consequences that matters: a blank
    spends nothing, and it is never graded correct.
    """

    ROOM_CODE = 'BLANK1'

    def setUp(self):
        self.host = User.objects.create_user(username='bhost', password='pass')
        self.player = User.objects.create_user(username='bplayer', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.url = reverse('answer-question')

    def seed_room(self, questions):
        room_ref = self.store.collection('gameRooms').document(self.ROOM_CODE)
        room_ref.set({
            'status': 'active',
            'hostId': self.host.id,
            'teamMode': False,
            'timePerQuestion': 15,
            'questions': questions,
        })
        player_ref = room_ref.collection('players').document(str(self.player.id))
        player_ref.set({
            'displayName': 'Player', 'score': 0, 'answeredCount': 0, 'streak': 3,
            'questionOrder': list(range(len(questions))),
            'isReady': True, 'isFinished': False,
            'powerups': {'freeze': 0, 'hint': 2, 'doublePoints': 2, 'shield': 2},
        })
        return player_ref

    def post_blank(self, index, **flags):
        self.client.force_authenticate(user=self.player)
        return self.client.post(self.url, {
            'roomCode': self.ROOM_CODE,
            'questionIndex': index,
            'answer': '',
            'timeTaken': '15',
            **flags,
        }, format='json')

    def test_a_blank_answer_does_not_spend_the_hint(self):
        player_ref = self.seed_room([
            {'type': 'mcq', 'question': 'Q0', 'choices': ['A. yes', 'B. no'],
             'correctAnswer': 'A. yes'},
        ])
        resp = self.post_blank(0, useHint='true')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(player_ref.get().to_dict()['powerups']['hint'], 2)

    def test_a_blank_answer_does_not_spend_the_shield(self):
        player_ref = self.seed_room([
            {'type': 'mcq', 'question': 'Q0', 'choices': ['A. yes', 'B. no'],
             'correctAnswer': 'A. yes'},
        ])
        resp = self.post_blank(0, useShield='true')
        self.assertEqual(resp.status_code, 200)
        # The shield is there to rescue an answer the player actually gave, so it
        # survives a timeout untouched -- including the streak it protects.
        data = player_ref.get().to_dict()
        self.assertEqual(data['powerups']['shield'], 2)
        self.assertEqual(data['streak'], 3)

    def test_a_blank_answer_is_still_recorded_as_an_attempt(self):
        player_ref = self.seed_room([
            {'type': 'mcq', 'question': 'Q0', 'choices': ['A. yes', 'B. no'],
             'correctAnswer': 'A. yes'},
        ])
        resp = self.post_blank(0)
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['correct'])
        data = player_ref.get().to_dict()
        self.assertEqual(data['answeredCount'], 1)
        self.assertIn(0, data['answeredQuestions'])

    def test_a_question_with_a_blank_key_cannot_be_answered_correctly(self):
        # The client refuses to submit this one (there is nothing to type), so
        # this only fires if a caller posts directly. Grading '' as a match for ''
        # would hand the point out for free to anyone who found the endpoint.
        player_ref = self.seed_room([
            {'type': 'identification', 'question': 'Name the organ', 'correctAnswer': ''},
        ])
        self.client.force_authenticate(user=self.player)
        resp = self.client.post(self.url, {
            'roomCode': self.ROOM_CODE, 'questionIndex': 0,
            'answer': '', 'timeTaken': '1',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['correct'])
        self.assertEqual(player_ref.get().to_dict()['score'], 0)




class MomentumRemovalTests(TestCase):
    """The cumulative multiplier ladder is gone, and scoring does not notice.

    Momentum compounded with the streak bonus and the doubled questions, so a
    team that got hot early kept scoring well past the point it stopped knowing
    the material. What must remain is a scoring formula that depends only on
    the answer in front of you. These assert that directly rather than by
    counting references, so a future "just bring back the small version" fails
    here.
    """

    ROOM_CODE = 'NOMOM1'
    POWERUP_KEYS = ('freeze', 'hint', 'doublePoints', 'shield')

    def setUp(self):
        self.host = User.objects.create_user(username='nhost', password='pass')
        self.player = User.objects.create_user(username='nplayer', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.url = reverse('answer-question')

    def seed_room(self, question_count=12, correct_count=0):
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
            # A player already deep into a run, with no streak. The old ladder
            # would have had this at x1.6 or higher.
            'correctCount': correct_count,
            'questionOrder': list(range(question_count)),
            'isReady': True, 'isFinished': False,
            'powerups': {k: 0 for k in self.POWERUP_KEYS},
        })
        return player_ref

    def answer_once(self):
        self.client.force_authenticate(user=self.player)
        return self.client.post(self.url, {
            'roomCode': self.ROOM_CODE,
            'questionIndex': 0,
            'answer': 'A. yes',
            'timeTaken': '1',
        }, format='json')

    def test_a_correct_answer_is_worth_the_same_on_a_hot_player_as_a_cold_one(self):
        cold = self.seed_room(correct_count=0)
        cold_points = self.answer_once().json()['pointsAwarded']

        hot = self.seed_room(correct_count=19)
        hot_points = self.answer_once().json()['pointsAwarded']

        # 19 correct answers would have been the top rung of the ladder.
        self.assertEqual(cold_points, hot_points)

    def test_the_response_reports_no_multiplier(self):
        self.seed_room(correct_count=19)
        body = self.answer_once().json()
        self.assertNotIn('multiplier', body)

    def test_the_team_document_carries_no_multiplier_field(self):
        room_ref = self.store.collection('gameRooms').document('TEAMNO1')
        room_ref.set({
            'status': 'waiting', 'hostId': self.host.id, 'teamMode': True,
            'teamCount': 2, 'questionCount': 0, 'questions': [],
        })
        for tid in ('1', '2'):
            room_ref.collection('teams').document(tid).set({
                'name': f'Team {tid}', 'memberIds': [], 'memberCount': 0,
            })
        room_ref.collection('players').document(str(self.player.id)).set({
            'displayName': 'Player', 'teamId': None,
        })
        self.client.force_authenticate(user=self.host)
        resp = self.client.post(reverse('auto-assign-teams'), {
            'roomCode': 'TEAMNO1',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        for team in resp.json()['teams']:
            self.assertNotIn('multiplier', team)

    def test_the_module_no_longer_exports_the_ladder(self):
        from game import views as game_views
        self.assertFalse(hasattr(game_views, 'TEAM_MOMENTUM_TIERS'))
        self.assertFalse(hasattr(game_views, 'momentum_multiplier'))
        self.assertFalse(hasattr(game_views, 'team_multiplier'))


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
        # The host is not dealt a seat, so 3 of the 4 people in the room are.
        self.assertEqual(sum(sizes.values()), 3)
        # Round-robin over 3 teams with 3 people: one seat each.
        self.assertLessEqual(max(sizes.values()) - min(sizes.values()), 1)
        for team_id, team in ((t, self.team(t)) for t in ('1', '2', '3')):
            self.assertEqual(len(team['memberIds']), sizes[team_id])
            for member in team['memberIds']:
                self.assertEqual(self.player_doc(member)['teamId'], team_id)

    def test_auto_assign_leaves_the_host_unseated(self):
        # The host runs the room rather than playing it. Dealing them in used to
        # occupy a seat a student then had to be moved out of, and counted their
        # non-participation against a team they never played for.
        self.client.force_authenticate(user=self.host)
        self.client.post(reverse('auto-assign-teams'), {'roomCode': 'SEAT'}, format='json')
        self.assertIsNone(self.player(self.host)['teamId'])
        for team_id in ('1', '2', '3'):
            self.assertNotIn(str(self.host.id), self.team(team_id)['memberIds'])

    def test_auto_assign_respects_a_hand_picked_host_seat(self):
        # If the host deliberately joined a team they keep it: what is refused is
        # the host being *dealt* one, not the host choosing to compete.
        self.client.force_authenticate(user=self.host)
        self.client.post(reverse('assign-team'),
                         {'roomCode': 'SEAT', 'teamId': '2'}, format='json')
        self.client.force_authenticate(user=self.host)
        resp = self.client.post(reverse('auto-assign-teams'),
                                {'roomCode': 'SEAT'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['hostSeated'])
        self.assertEqual(self.player(self.host)['teamId'], '2')
        self.assertIn(str(self.host.id), self.team('2')['memberIds'])

    def test_auto_assign_repoints_the_leader(self):
        # The roster is rebuilt from scratch, so a leader left over from the
        # previous deal would point at a non-member and gate the wrong person.
        self.room_ref.collection('teams').document('1').set(
            {'leaderId': str(self.p1.id)}, merge=True)
        self.room_ref.collection('teams').document('2').set(
            {'memberIds': [str(self.p1.id)], 'leaderId': str(self.p1.id)}, merge=True)

        self.client.force_authenticate(user=self.host)
        self.client.post(reverse('auto-assign-teams'), {'roomCode': 'SEAT'}, format='json')

        for team_id in ('1', '2', '3'):
            team = self.team(team_id)
            members = [str(m) for m in team['memberIds']]
            if members:
                self.assertEqual(str(team.get('leaderId')), members[0])

    def test_auto_assign_reports_who_was_left_out(self):
        self.client.force_authenticate(user=self.host)
        resp = self.client.post(reverse('auto-assign-teams'),
                                {'roomCode': 'SEAT'}, format='json')
        # One player per team, so nobody is dropped -- the host, who is simply
        # not eligible, must not show up here.
        self.assertEqual(resp.json()['unassigned'], [])

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
        # 3 dealt players / 3 teams, so everyone keeps a seat.
        self.assertEqual(sum(len(self.team(t)['memberIds']) for t in ('1', '2', '3')), 3)

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
            'status': 'active', 'hostId': self.host.id, 'ownerId': self.host.id,
            'teamMode': True,
            'teamCount': 2, 'topic': 't', 'questionCount': 1, 'questions': [],
        })
        self.room_ref.collection('teams').document('1').set({
            'name': 'Winners', 'color': '#22D3EE', 'score': 900,
            'correctCount': 3, 'answeredCount': 3, 'memberIds': [str(self.winner.id)],
        })
        self.room_ref.collection('teams').document('2').set({
            'name': 'Chasers', 'color': '#10B981', 'score': 100,
            'correctCount': 0, 'answeredCount': 2,
            'memberIds': [str(self.loser.id), str(self.host.id)],
        })
        # The owner runs the room and is a participant, so they get a seat in it
        # too: settlement needs an owner who is actually in the room.
        for user, score, team in ((self.winner, 900, '1'), (self.loser, 100, '2'),
                                  (self.host, 0, '2')):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': score, 'teamId': team, 'isFinished': True,
                'answers': {}, 'answeredCount': 0,
            })
        # Winners banked three correct answers, so the winner has to have three
        # entries in their OWN log -- otherwise agreement and the MVP, which are
        # derived from that log, have nothing to read.
        self.room_ref.collection('players').document(str(self.winner.id)).update({
            'answers': {
                f'q{i}': {'picked': 'A. yes', 'correct': True, 'agreed': True, 'points': 300}
                for i in range(3)
            },
            'answeredCount': 3,
        })

    def settle(self, **extra):
        self.client.force_authenticate(user=self.host)
        return self.client.post(reverse('finish-game'), {'roomCode': 'XP1', **extra}, format='json')

    def test_a_participant_vote_alone_settles_nothing(self):
        self.client.force_authenticate(user=self.loser)
        resp = self.client.post(reverse('finish-game'), {'roomCode': 'XP1'}, format='json')
        self.assertEqual(resp.status_code, 200)
        # A vote is not a settlement: the room is still running and nobody has
        # been paid yet.
        self.assertFalse(resp.json()['canSettle'])
        self.assertEqual(self.room_ref.get().to_dict()['status'], 'active')
        self.assertFalse(Activity.objects.filter(user=self.winner).exists())

    def test_a_participant_cannot_settle_the_room(self):
        self.client.force_authenticate(user=self.loser)
        resp = self.client.post(reverse('finish-game'),
                                {'roomCode': 'XP1', 'confirm': 'true'}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(self.room_ref.get().to_dict()['status'], 'active')

    def test_team_placement_pays_every_member_of_the_winning_team(self):
        resp = self.settle(confirm='true')
        self.assertEqual(resp.status_code, 200, resp.data)
        # The settling player is told their TEAM's placement, not their own.
        self.assertEqual(resp.json()['teamRank'], 2)
        self.assertEqual(resp.json()['teamId'], '2')

        winner_activity = Activity.objects.filter(user=self.winner, kind='game').first()
        self.assertIsNotNone(winner_activity)
        # The title names the quiz and the score, so the team the member actually
        # played for is attributed on the row via the description and the payload
        # rather than in the title. Same guarantee as before -- their own team,
        # never the other one -- just not crammed into the one-line title.
        self.assertIn('Winners', winner_activity.description)
        self.assertNotIn('Chasers', winner_activity.description)
        self.assertEqual(winner_activity.payload['teamName'], 'Winners')

    def test_team_results_carry_accuracy_and_contribution(self):
        self.settle(confirm='true')
        results = self.room_ref.get().to_dict()['teamResults']
        self.assertEqual([r['name'] for r in results], ['Winners', 'Chasers'])
        self.assertEqual(results[0]['accuracy'], 100)
        self.assertEqual(results[1]['accuracy'], 0)
        winner_row = results[0]['members'][0]
        self.assertEqual(winner_row['userId'], str(self.winner.id))
        # Members share one score, so what distinguishes them is how often they
        # voted with the team -- and the MVP is picked off that, server-side.
        self.assertEqual(winner_row['agreement'], 100)
        self.assertTrue(winner_row['isMvp'])
        self.assertEqual(results[0]['mvpId'], str(self.winner.id))

        # The per-member numbers the results screen reads. These were missing
        # while the client expected them, so every member row rendered 0 --
        # which read as "this member contributed nothing" rather than as a field
        # that had never been sent.
        self.assertEqual(winner_row['correctCount'], results[0]['correctCount'])
        self.assertGreater(winner_row['answeredCount'], 0)
        self.assertEqual(winner_row['accuracy'], 100)
        self.assertTrue(winner_row['isMvp'])
        # `contribution` was removed from the payload and the client together:
        # members share one team score, so a per-member point share is identical
        # for everyone and tells nobody anything.
        self.assertNotIn('contribution', winner_row)

    def test_settlement_waits_for_a_player_who_is_still_answering(self):
        self.room_ref.collection('players').document(str(self.loser.id)).update({'isFinished': False})
        resp = self.settle(confirm='true')
        self.assertEqual(resp.status_code, 409)
        self.assertTrue(resp.json()['canSettle'])
        self.assertEqual(self.room_ref.get().to_dict()['status'], 'active')

        # ... unless the owner deliberately ends it early, which is reported so
        # the client can say the session was cut short.
        forced = self.settle(confirm='true', force='true')
        self.assertEqual(forced.status_code, 200, forced.data)
        self.assertTrue(forced.json()['endedEarly'])
        self.assertEqual(self.room_ref.get().to_dict()['status'], 'finished')


class ClassicSettlementTests(TestCase):
    """A classic (non-team) game must actually settle, and leave a history row.

    The server side of this always worked, but nothing exercised it: the only
    client that sent `confirm` for a student-owned room was the educator
    host-session screen, and the play screen never got as far as sending it
    because it only read `ownerId` from inside a `teamMode` guard. So every
    classic game ended with the room still `active`, nobody paid, and no
    Recent Activity row -- the failure looked like a missing feature rather
    than a missing request.

    These pin the contract the play screen depends on: a classic room has no
    `teamMode` field at all, and the owner's confirm must settle it.
    """

    def setUp(self):
        self.owner = User.objects.create_user(username='owner', password='pass')
        self.other = User.objects.create_user(username='other', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('CLAS1')
        # Deliberately NO `teamMode` key: that is exactly what a classic room
        # document looks like, since the field is only written for team rooms.
        self.room_ref.set({
            'status': 'active', 'hostId': self.owner.id, 'ownerId': self.owner.id,
            'hostIsStudent': True, 'topic': 't', 'questionCount': 1,
            'timePerQuestion': 15, 'questions': [],
        })
        for user, score in ((self.owner, 1200), (self.other, 400)):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': score,
                'isFinished': True, 'answers': {}, 'answeredCount': 1,
                'correctCount': 1,
            })

    def confirm(self, user=None, **extra):
        self.client.force_authenticate(user=user or self.owner)
        return self.client.post(
            reverse('finish-game'), {'roomCode': 'CLAS1', **extra}, format='json')

    def test_a_bare_vote_does_not_settle_a_classic_room(self):
        resp = self.confirm(confirm='false')
        self.assertEqual(resp.status_code, 200)
        # `canSettle` is a readiness flag, and everybody here has already voted
        # done, so the room genuinely IS ready. What matters is that voting is
        # not settling: the room is still running and nobody has been paid.
        self.assertTrue(resp.json()['canSettle'])
        self.assertEqual(self.room_ref.get().to_dict()['status'], 'active')
        self.assertFalse(Activity.objects.filter(user=self.owner).exists())

    def test_the_owner_confirming_settles_the_classic_room(self):
        resp = self.confirm(confirm='true')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self.room_ref.get().to_dict()['status'], 'finished')

    def test_a_finished_classic_game_leaves_a_recent_activity_row(self):
        # The whole point: a classic game has to be findable in Recent Activity
        # afterwards, with a results payload the detail sheet can render.
        self.confirm(confirm='true')

        for user in (self.owner, self.other):
            row = Activity.objects.filter(user=user).order_by('-created_at').first()
            self.assertIsNotNone(
                row, f'{user.username} got no activity row from a finished classic game')
            self.assertEqual(row.kind, 'game')
            results = (row.payload or {}).get('results')
            self.assertIsNotNone(results, 'the activity row carried no results snapshot')
            self.assertEqual(results['mode'], 'classic')
            self.assertTrue(results['participants'])
            # Every participant is represented, so the detail sheet can render a
            # final standings table rather than an empty card.
            names = {p['name'] for p in results['participants']}
            self.assertEqual(names, {'owner', 'other'})

    def test_classic_results_rank_the_winner_first(self):
        self.confirm(confirm='true')
        row = Activity.objects.filter(user=self.owner).order_by('-created_at').first()
        results = row.payload['results']
        top = max(results['participants'], key=lambda p: p['score'])
        self.assertEqual(top['name'], 'owner')
        self.assertEqual(top['rank'], 1)

    def test_a_non_owner_still_cannot_settle_a_classic_room(self):
        resp = self.confirm(user=self.other, confirm='true')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(self.room_ref.get().to_dict()['status'], 'active')


class ActivityTitleNamesTheQuizTests(TestCase):
    """A finished game's activity row has to say which quiz it was, and the score.

    Every settled game logged `#1 (CLAS1)`: the placement, and the room code. Both
    are true and neither is what a student recognises their own game by, so a
    Recent Activity list was a column of "#3", "#1", "#2" with nothing to tell
    the quizzes apart -- and the score, the only number anyone actually wants
    afterwards, was not in the row at all. The topic is already on the room doc,
    and the settlement already knows each participant's score, so the title is
    built from those.
    """

    def setUp(self):
        self.owner = User.objects.create_user(username='owner', password='pass')
        self.other = User.objects.create_user(username='other', password='pass')
        self.teammate = User.objects.create_user(username='mate', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('CLAS1')
        self.room_ref.set({
            'status': 'active', 'hostId': self.owner.id, 'ownerId': self.owner.id,
            'topic': 'Photosynthesis', 'questionCount': 1,
            'timePerQuestion': 15, 'questions': [],
        })
        for user, score in ((self.owner, 1200), (self.other, 400)):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': score,
                'isFinished': True, 'answers': {}, 'answeredCount': 1,
                'correctCount': 1,
            })

    def settle(self, user=None, **extra):
        self.client.force_authenticate(user=user or self.owner)
        return self.client.post(
            reverse('finish-game'),
            {'roomCode': 'CLAS1', 'confirm': 'true', 'force': 'true', **extra},
            format='json')

    def row(self, user):
        return Activity.objects.filter(user=user).order_by('-created_at').first()

    def test_the_row_is_titled_with_the_quiz_name_and_the_score(self):
        self.assertEqual(self.settle().status_code, 200)
        self.assertEqual(self.row(self.owner).title, 'Photosynthesis · 1,200 pts')

    def test_the_score_in_the_title_is_each_players_own(self):
        self.settle()
        # Not the room's best score, and not shared: 400 is what `other` scored.
        self.assertEqual(self.row(self.other).title, 'Photosynthesis · 400 pts')

    def test_the_title_does_not_lead_with_the_placement_or_the_room_code(self):
        self.settle()
        title = self.row(self.owner).title
        self.assertNotIn('CLAS1', title)
        self.assertFalse(title.startswith('#'), f'title still leads with the placement: {title}')

    def test_a_placeholder_topic_falls_back_to_a_generic_name(self):
        # "Quiz pending" and "Study Quiz" are what CreateRoomView writes when a
        # room has no course quiz behind it. Naming either one is no more useful
        # than naming the room code, so both collapse to the generic word.
        for placeholder in ('Quiz pending', 'Study Quiz', '', None):
            with self.subTest(topic=placeholder):
                Activity.objects.all().delete()
                self.room_ref.set({'topic': placeholder, 'status': 'active'}, merge=True)
                self.settle()
                self.assertEqual(self.row(self.owner).title, 'Game · 1,200 pts')

    def test_the_description_keeps_the_placement(self):
        # The title no longer carries the placement, and the detail sheet falls
        # back to the description, so it has to go somewhere or "#1" is lost.
        self.settle()
        description = self.row(self.owner).description
        self.assertIn('#1', description)
        self.assertIn('1,200 pts', description)

    def test_a_team_row_is_titled_with_the_team_score(self):
        self.room_ref.set({
            'teamMode': True, 'teamCount': 2, 'status': 'active',
            'teamQuestionIndex': 1, 'teamStartedAt': 'earlier',
        }, merge=True)
        self.room_ref.collection('teams').document('1').set({
            'name': 'Winners', 'color': '#22D3EE', 'score': 900,
            'teamCorrect': 2, 'answeredCount': 2, 'teamStreak': 2, 'bestStreak': 2,
            'memberIds': [str(self.owner.id)], 'memberCount': 1,
            'leaderId': str(self.owner.id),
            'reveals': {'0': {'answer': 'a', 'correct': True}},
        })
        self.room_ref.collection('teams').document('2').set({
            'name': 'Chasers', 'color': '#10B981', 'score': 100,
            'memberIds': [str(self.teammate.id)], 'memberCount': 1,
            'leaderId': str(self.teammate.id),
        })
        self.room_ref.collection('players').document(str(self.owner.id)).update({'teamId': '1'})
        self.room_ref.collection('players').document(str(self.teammate.id)).set({
            'displayName': self.teammate.username, 'score': 100, 'teamId': '2',
            'correctCount': 0, 'answeredCount': 1, 'isFinished': True, 'answers': {},
        })

        self.assertEqual(self.settle().status_code, 200)
        # The team's 900, not this member's own 1,200: members share one score,
        # and 900 is what they were actually paid for.
        self.assertEqual(self.row(self.owner).title, 'Photosynthesis · 900 pts')
        self.assertEqual(self.row(self.teammate).title, 'Photosynthesis · 100 pts')


class ClassicSnapshotEnrichmentTests(TestCase):
    """The classic activity snapshot has to carry what the detail sheet renders.

    Team-mode games already write `accuracy`, `agreement`, `bestStreak`,
    `avatar`, `isLeader`, `isMvp` and `earlyFinisher` per member. Classic games
    wrote `name`/`score`/`correct`/`answered` and nothing else, so the same
    component rendered a solo game as a bare score table: no picture, no
    accuracy, no notion of who finished early or who carried the room. These pin
    the fields a settled solo game is expected to carry.
    """

    def setUp(self):
        self.owner = User.objects.create_user(username='owner', password='pass')
        self.ace = User.objects.create_user(username='ace', password='pass')
        self.quitter = User.objects.create_user(username='quitter', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('CLSNP')
        self.room_ref.set({
            'status': 'active', 'hostId': self.owner.id, 'ownerId': self.owner.id,
            'hostIsStudent': True, 'topic': 't', 'questionCount': 4,
            'timePerQuestion': 15, 'questions': [],
        })
        # ace: 4/4, longest run, finished early.
        # owner: 2/4, finished early.
        # quitter: never answered, but still pressed Finish.
        for user, score, correct, answered, streak, finished, avatar in (
            (self.owner, 900, 2, 4, 1, True, 'https://cdn/owner.png'),
            (self.ace, 1600, 4, 4, 4, True, 'https://cdn/ace.png'),
            (self.quitter, 0, 0, 0, 0, True, ''),
        ):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': score,
                'correctCount': correct, 'answeredCount': answered,
                'bestStreak': streak, 'isFinished': finished,
                'avatar': avatar, 'answers': {},
            })

    def settle(self):
        self.client.force_authenticate(user=self.owner)
        resp = self.client.post(
            reverse('finish-game'),
            {'roomCode': 'CLSNP', 'confirm': 'true'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        return (Activity.objects.filter(user=self.ace).order_by('-created_at')
                .first().payload['results'])

    def participant(self, results, username):
        return next(p for p in results['participants'] if p['name'] == username)

    def test_every_participant_carries_an_accuracy(self):
        results = self.settle()
        self.assertEqual(self.participant(results, 'ace')['accuracy'], 100)
        self.assertEqual(self.participant(results, 'owner')['accuracy'], 50)
        # Nobody who answered nothing has no accuracy to report, and it must not
        # be a division by zero surfaced as an error.
        self.assertEqual(self.participant(results, 'quitter')['accuracy'], 0)

    def test_an_avatar_is_carried_through(self):
        results = self.settle()
        self.assertEqual(self.participant(results, 'ace')['avatar'], 'https://cdn/ace.png')
        # Absent rather than the empty string, which is what the team snapshot
        # writes, so the client only has one "no picture" case to check.
        self.assertIsNone(self.participant(results, 'quitter')['avatar'])

    def test_finishing_early_needs_having_answered_something(self):
        results = self.settle()
        # The quitter pressed Finish but never answered: racing the clock and
        # waiting it out look identical on that flag alone.
        self.assertTrue(self.participant(results, 'ace')['earlyFinisher'])
        self.assertTrue(self.participant(results, 'owner')['earlyFinisher'])
        self.assertFalse(self.participant(results, 'quitter')['earlyFinisher'])

    def test_the_best_performer_is_the_room_mvp(self):
        results = self.settle()
        flagged = [p['name'] for p in results['participants'] if p['isMvp']]
        self.assertEqual(flagged, ['ace'])

    def test_someone_who_skipped_the_quiz_cannot_be_the_mvp(self):
        results = self.settle()
        self.assertFalse(self.participant(results, 'quitter')['isMvp'])

    def test_a_streak_breaks_a_tie_on_accuracy(self):
        # Nobody has 100%, and the top two tie on it, so the longer run decides
        # rather than the name or the id.
        self.room_ref.collection('players').document(str(self.ace.id)).update({
            'correctCount': 3, 'answeredCount': 4, 'score': 1400})
        self.room_ref.collection('players').document(str(self.owner.id)).update({
            'correctCount': 3, 'answeredCount': 4, 'score': 1000,
            'bestStreak': 2})
        results = self.settle()
        # 3/4 each; ace kept the longer run (4) against owner's 2.
        self.assertEqual(self.participant(results, 'ace')['isMvp'], True)
        self.assertEqual(self.participant(results, 'owner')['isMvp'], False)

    def test_the_live_is_finished_flag_does_not_outlive_the_game(self):
        # `isFinished` is how the play screen knows to move on; it is a live-game
        # detail and must not sit in a results row that outlives the room.
        results = self.settle()
        for participant in results['participants']:
            self.assertNotIn('isFinished', participant)

    def test_the_best_streak_survives_into_the_snapshot(self):
        results = self.settle()
        self.assertEqual(self.participant(results, 'ace')['bestStreak'], 4)


class RematchTests(TestCase):
    """A rematch reuses the room so the code students typed keeps working.

    Everything asserted here is about the one property that makes it usable: the
    roster survives and only game state is thrown away. A reset that also dropped
    players, or that left round one's scores on the documents, would pass a naive
    "status is waiting" check while being broken in the classroom.
    """

    def setUp(self):
        self.host = User.objects.create_user(username='rhost', password='pass')
        self.a = User.objects.create_user(username='ra', password='pass')
        self.b = User.objects.create_user(username='rb', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('RMT1')
        self.room_ref.set({
            'status': 'finished', 'hostId': self.host.id, 'ownerId': self.host.id,
            'teamMode': True, 'teamCount': 2, 'topic': 't', 'questionCount': 2,
            'questions': [
                {'question': 'q0', 'type': 'mcq', 'options': ['a', 'b'], 'answer': 'a'},
                {'question': 'q1', 'type': 'mcq', 'options': ['a', 'b'], 'answer': 'b'},
            ],
            'teamResults': [{'id': '1', 'name': 'Winners', 'score': 900}],
            'finishedAt': 'yesterday', 'startedAt': 'earlier',
            'teamAssignments': [{'id': str(self.a.id), 'teamId': '1'}],
            'teamQuestionIndex': 1, 'teamStartedAt': 'earlier',
            'pickStartedAt': 'earlier',
        })
        self.room_ref.collection('teams').document('1').set({
            'name': 'Winners', 'color': '#22D3EE', 'score': 900,
            'correctCount': 2, 'answeredCount': 2, 'teamCorrect': 2, 'teamStreak': 2,
            'bestStreak': 2, 'pickCount': 1,
            'memberIds': [str(self.a.id)], 'memberCount': 1, 'leaderId': str(self.a.id),
            'powerups': {'freeze': 2, 'hint': 0, 'doublePoints': 1, 'shield': 0},
            'reveals': {'0': {'answer': 'a', 'correct': True}},
        })
        self.room_ref.collection('teams').document('2').set({
            'name': 'Chasers', 'color': '#10B981', 'score': 100,
            'memberIds': [str(self.b.id)], 'memberCount': 1,
        })
        for user, score in ((self.a, 900), (self.b, 100), (self.host, 0)):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': score, 'correctCount': 3,
                'answeredCount': 3, 'streak': 2, 'bestStreak': 3,
                'isFinished': True, 'answers': {'q0': {'picked': 'a', 'correct': True}},
                'questionOrder': [1, 0], 'teamId': '1',
                'powerups': {'freeze': 3, 'hint': 1, 'doublePoints': 0, 'shield': 2},
            })
        # Round one's server-side vote tally. Left behind it would make question
        # 0 of the rematch inherit question 0's picks.
        self.room_ref.collection('_server').document('teamPicks_1').set({
            'questionIndex': 0, 'picks': {str(self.a.id): 'a'},
        })

    def rematch(self, user=None, **extra):
        self.client.force_authenticate(user=user or self.host)
        return self.client.post(reverse('rematch'), {'roomCode': 'RMT1', **extra}, format='json')

    def player(self, user):
        return self.room_ref.collection('players').document(str(user.id)).get().to_dict()

    def test_the_room_returns_to_the_lobby_keeping_its_code_and_roster(self):
        resp = self.rematch()
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.json()['roomCode'], 'RMT1')

        room = self.room_ref.get().to_dict()
        self.assertEqual(room['status'], 'waiting')
        self.assertEqual(room['topic'], 't')
        # Everyone is still in the room -- this is the whole point of a rematch.
        self.assertEqual(
            sorted(p.id for p in self.room_ref.collection('players').list_documents()),
            sorted(str(u.id) for u in (self.a, self.b, self.host)),
        )

    def test_round_one_scores_are_gone_from_every_player(self):
        self.rematch()
        for user in (self.a, self.b, self.host):
            player = self.player(user)
            self.assertEqual(player['score'], 0)
            self.assertEqual(player['correctCount'], 0)
            self.assertEqual(player['answeredCount'], 0)
            self.assertEqual(player['streak'], 0)
            self.assertEqual(player['bestStreak'], 0)
            self.assertEqual(player['answers'], {})
            self.assertFalse(player['isFinished'])
            self.assertEqual(player['questionOrder'], [])
            self.assertEqual(player['powerups'], {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0})
            # Seats are released so the lobby shows empty columns to re-pick.
            self.assertNotIn('teamId', player)

    def test_team_scores_and_seats_reset_but_the_names_survive(self):
        self.rematch()
        team = self.room_ref.collection('teams').document('1').get().to_dict()
        self.assertEqual(team['score'], 0)
        self.assertEqual(team['correctCount'], 0)
        self.assertEqual(team['answeredCount'], 0)
        self.assertEqual(team['teamCorrect'], 0)
        self.assertEqual(team['teamStreak'], 0)
        self.assertEqual(team['bestStreak'], 0)
        self.assertEqual(team['pickCount'], 0)
        self.assertEqual(team['memberIds'], [])
        self.assertEqual(team['memberCount'], 0)
        self.assertIsNone(team['leaderId'])
        # A name a student typed is worth keeping even when the seats move.
        self.assertEqual(team['name'], 'Winners')
        self.assertNotIn('reveals', team)

    def test_the_stale_vote_tally_is_deleted(self):
        self.rematch()
        self.assertEqual(
            [d.id for d in self.room_ref.collection('_server').list_documents()],
            [],
        )

    def test_team_results_are_deleted_not_emptied(self):
        # An empty-but-present array would render an empty podium on the final
        # screen instead of the rematch's own results later.
        self.rematch()
        self.assertNotIn('teamResults', self.room_ref.get().to_dict())

    def test_the_shared_clock_is_cleared_so_the_lobby_does_not_open_a_question(self):
        self.rematch()
        room = self.room_ref.get().to_dict()
        self.assertEqual(room['teamQuestionIndex'], 0)
        self.assertIsNone(room['teamStartedAt'])
        self.assertNotIn('pickStartedAt', room)

    def test_the_host_can_swap_the_quiz_for_round_two(self):
        quiz = Quiz.objects.create(user=self.host, title='Round two')
        for i in range(2):
            QuizQuestion.objects.create(
                quiz=quiz, question_text=f'r2 q{i}',
                options=['a', 'b'], correct_answer='a',
            )
        resp = self.rematch(quizId=quiz.id)
        self.assertEqual(resp.status_code, 200, resp.data)
        room = self.room_ref.get().to_dict()
        self.assertEqual(room['topic'], 'Round two')
        self.assertEqual(room['questionCount'], 2)

    def test_a_replacement_quiz_too_short_for_the_team_count_is_refused(self):
        # Same rule as creation and set-quiz: a team with no question sits out the
        # whole round, so this must fail before it is written to the room.
        quiz = Quiz.objects.create(user=self.host, title='Short')
        QuizQuestion.objects.create(
            quiz=quiz, question_text='only', options=['a', 'b'], correct_answer='a',
        )
        resp = self.rematch(quizId=quiz.id)
        self.assertEqual(resp.status_code, 400)
        # The room must not be half-reset by a rejected swap.
        self.assertEqual(self.room_ref.get().to_dict()['status'], 'finished')

    def test_a_participant_cannot_start_a_rematch(self):
        resp = self.rematch(user=self.a)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(self.room_ref.get().to_dict()['status'], 'finished')

    def test_an_unfinished_game_cannot_be_rematched(self):
        self.room_ref.update({'status': 'active'})
        resp = self.rematch()
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.room_ref.get().to_dict()['status'], 'active')

    def test_a_second_rematch_is_refused_once_the_room_is_already_waiting(self):
        self.rematch()
        resp = self.rematch()
        # A double-tap is not an error worth surfacing to the host as a failure
        # of the feature -- the room is already in the state they asked for.
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.room_ref.get().to_dict()['status'], 'waiting')


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
            # Solo play: a freeze stops one player's own clock, which is the
            # only case where the mechanic still means anything now that team
            # mode runs on a single shared timer.
            'teamMode': False,
            'timePerQuestion': 15,
            'questions': [
                {'type': 'mcq', 'question': f'Q{i}', 'choices': ['A. yes', 'B. no'],
                 'correctAnswer': 'A. yes'} for i in range(10)
            ],
        })
        self.room_ref.collection('players').document(str(self.a.id)).set({
            'displayName': 'F0', 'score': 0, 'isFinished': False,
            'questionOrder': list(range(10)), 'answeredQuestions': [],
            'powerups': {'freeze': 5, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })

    def player(self, user):
        return self.room_ref.collection('players').document(str(user.id)).get().to_dict()

    def freeze(self, user, index=3):
        self.client.force_authenticate(user=user)
        return self.client.post(reverse('freeze-timer'), {
            'roomCode': 'FRZ1', 'questionIndex': index,
        }, format='json')

    def test_freeze_spends_the_players_own_pool(self):
        self.assertEqual(self.freeze(self.a).status_code, 200)
        self.assertEqual(self.player(self.a)['powerups']['freeze'], 4)

    def test_freeze_cannot_be_stacked_on_one_question(self):
        self.assertEqual(self.freeze(self.a, index=3).status_code, 200)
        self.assertEqual(self.freeze(self.a, index=3).status_code, 400)
        self.assertEqual(self.player(self.a)['powerups']['freeze'], 4)

    def test_freeze_is_refused_once_the_question_is_answered(self):
        """The timer is already stopped; a charge spent here does nothing.

        The client's guard used to check its own `selected` state (null on a
        timeout) rather than whether an answer existed, so tapping Freeze after
        the clock ran out burned a charge for no effect.
        """
        self.room_ref.collection('players').document(str(self.a.id)).update(
            {'answeredQuestions': [3]})
        self.assertEqual(self.freeze(self.a, index=3).status_code, 400)
        self.assertEqual(self.player(self.a)['powerups']['freeze'], 5)

    def test_freeze_is_rejected_when_the_pool_is_empty(self):
        self.room_ref.collection('players').document(str(self.a.id)).update(
            {'powerups.freeze': 0})
        self.assertEqual(self.freeze(self.a).status_code, 400)

    def test_freeze_requires_the_room_to_be_running(self):
        self.room_ref.set({'status': 'waiting'}, merge=True)
        self.assertEqual(self.freeze(self.a).status_code, 400)

    def test_freeze_rejects_a_player_outside_the_room(self):
        self.room_ref.collection('players').document(str(self.b.id)).delete()
        self.assertEqual(self.freeze(self.b).status_code, 403)

    def test_freeze_is_refused_in_team_mode(self):
        """Team mode shares one countdown, so pausing one screen desyncs it."""
        self.room_ref.set({'teamMode': True}, merge=True)
        self.room_ref.collection('teams').document('1').set({
            'name': 'Frost', 'memberIds': [str(self.a.id)], 'memberCount': 1,
            'powerups': {'freeze': 2, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        response = self.freeze(self.a)
        self.assertEqual(response.status_code, 400)
        self.assertTrue(response.json()['teamTimer'])
        # Refused before any charge was taken.
        self.assertEqual(
            self.room_ref.collection('teams').document('1').get().to_dict()['powerups']['freeze'],
            2)
        self.assertEqual(self.player(self.a)['powerups']['freeze'], 5)


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
            'ownerId': self.host.id,
            'teamMode': True,
            'teamCount': 2,
            'timePerQuestion': 15,
            'teamQuestionIndex': 0,
            'teamStartedAt': timezone.now() - timedelta(seconds=120),
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

    def test_team_pick_scores_the_team(self):
        """Regression: the team answer used to 500 on the generator trap."""
        self.client.force_authenticate(user=self.a)
        resp = self.client.post(
            reverse('team-pick'),
            {'roomCode': 'TXN1', 'questionIndex': 0, 'answer': 'A. yes', 'timeTaken': '1',
             'force': 'true'},
            format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        team = self.room_ref.collection('teams').document('1').get().to_dict()
        self.assertGreater(team['score'], 0)
        self.assertEqual(team['answeredCount'], 1)
        self.assertEqual(team['correctCount'], 1)

    def test_the_solo_answer_endpoint_refuses_a_team_room(self):
        """Otherwise a member could score the team the old, un-majority way."""
        self.client.force_authenticate(user=self.a)
        resp = self.client.post(
            reverse('answer-question'),
            {'roomCode': 'TXN1', 'questionIndex': 0, 'answer': 'A. yes', 'timeTaken': '1'},
            format='json')
        self.assertEqual(resp.status_code, 409, resp.data)
        self.assertTrue(resp.json()['useTeamPick'])
        team = self.room_ref.collection('teams').document('1').get().to_dict()
        self.assertEqual(team['answeredCount'], 0)

    def test_freeze_is_refused_in_a_team_room(self):
        """Same guard as the answer endpoint: one shared clock, no per-player freeze."""
        self.client.force_authenticate(user=self.a)
        resp = self.client.post(
            reverse('freeze-timer'),
            {'roomCode': 'TXN1', 'questionIndex': 0}, format='json')
        self.assertEqual(resp.status_code, 400, resp.data)
        team = self.room_ref.collection('teams').document('1').get().to_dict()
        self.assertEqual(team['powerups']['freeze'], 1)

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
            'status': 'active', 'hostId': self.host.id, 'ownerId': self.host.id,
            'teamMode': True,
            'teamCount': 2, 'timePerQuestion': 15,
            'teamQuestionIndex': 0,
            'teamStartedAt': timezone.now() - timedelta(seconds=120),
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
        for user, team_id in ((self.member, '1'), (self.watcher, None), (self.host, None)):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': 0, 'answeredCount': 0,
                'correctCount': 0, 'streak': 0, 'questionOrder': [0, 1, 2, 3],
                'teamId': team_id, 'isFinished': False,
                'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
            })

    def player(self, user):
        return self.room_ref.collection('players').document(str(user.id)).get().to_dict()

    def pick(self, user, index=0, answer='A. yes'):
        """Team mode: a member picks, the team answers by majority."""
        self.client.force_authenticate(user=user)
        return self.client.post(reverse('team-pick'), {
            'roomCode': 'WATCH1', 'questionIndex': index,
            'answer': answer, 'timeTaken': '1',
        }, format='json')

    def finish(self, user, confirm=False):
        self.client.force_authenticate(user=user)
        return self.client.post(reverse('finish-game'), {
            'roomCode': 'WATCH1', 'confirm': 'true' if confirm else 'false',
        }, format='json')

    def test_a_spectator_answer_is_rejected(self):
        resp = self.pick(self.watcher)
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(resp.json()['spectator'])

    def test_a_rejected_spectator_answer_writes_nothing(self):
        self.pick(self.watcher, answer='A. yes')
        watcher = self.player(self.watcher)
        self.assertEqual(watcher['score'], 0)
        self.assertEqual(watcher['answeredCount'], 0)
        self.assertEqual(watcher.get('answers'), None)

    def test_a_spectator_cannot_drain_a_powerup_pool(self):
        # The spectator carries a pool of their own; answering must not debit it.
        self.room_ref.collection('players').document(str(self.watcher.id)).update({
            'powerups': {'freeze': 0, 'hint': 1, 'doublePoints': 1, 'shield': 1},
        })
        self.pick(self.watcher, index=0)
        self.assertEqual(self.player(self.watcher)['powerups']['hint'], 1)

    def test_a_team_member_can_still_answer(self):
        self.assertEqual(self.pick(self.member).status_code, 200)

    def test_a_spectator_does_not_block_settlement(self):
        # The member finishes; the spectator never will. The room must still
        # settle once the owner confirms, otherwise placement XP is never paid.
        self.client.force_authenticate(user=self.member)
        self.room_ref.collection('players').document(str(self.member.id)).update({
            'isFinished': True,
        })
        resp = self.finish(self.member)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['allFinished'])
        # A participant is not the owner, so they get to vote but not to settle.
        self.assertEqual(resp.json()['canSettle'], False)
        # Settling is refused until the owner confirms, so a single vote cannot
        # close the room while somebody is still answering.
        self.assertEqual(self.finish(self.member, confirm=True).status_code, 403)

        settled = self.finish(self.host, confirm=True)
        self.assertEqual(settled.status_code, 200)
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
        # field is simply unused and answering must still work -- through the
        # solo endpoint, which is the one that accepts a classic room.
        self.room_ref.update({'teamMode': False})
        self.client.force_authenticate(user=self.watcher)
        resp = self.client.post(reverse('answer-question'), {
            'roomCode': 'WATCH1', 'questionIndex': 0,
            'answer': 'A. yes', 'timeTaken': '1',
        }, format='json')
        self.assertEqual(resp.status_code, 200)


class AnswerLogTests(TestCase):
    """The per-question log the results screen reads.

    Team mode, because that is where the log now matters: one team answer is
    written into EVERY member's log, and only the member's own pick and whether
    it matched the team differ. A member's score has to equal their team's, and
    no member may be able to read a teammate's pick out of their own document.
    """

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
            'status': 'active', 'hostId': self.host.id, 'ownerId': self.host.id,
            'teamMode': True,
            'teamCount': 2, 'timePerQuestion': 15,
            'teamQuestionIndex': 0,
            'teamStartedAt': timezone.now() - timedelta(seconds=120),
            'questions': [
                {'type': 'mcq', 'question': f'Q{i}', 'choices': ['A. yes', 'B. no'],
                 'correctAnswer': 'A. yes'} for i in range(4)
            ],
        })
        teams = self.room_ref.collection('teams')
        teams.document('1').set({
            'name': 'Alphas', 'color': TEAM_COLORS[0], 'score': 0,
            'correctCount': 0, 'answeredCount': 0,
            'memberIds': [str(self.a.id), str(self.b.id)], 'memberCount': 2,
            'teamCorrect': 0, 'multiplier': 1.0,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        teams.document('2').set({
            'name': 'Betas', 'color': TEAM_COLORS[1], 'score': 0,
            'correctCount': 0, 'answeredCount': 0, 'memberIds': [], 'memberCount': 0,
            'teamCorrect': 0, 'multiplier': 1.0,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        for user in (self.a, self.b):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': 0, 'answeredCount': 0,
                'correctCount': 0, 'streak': 0, 'questionOrder': [0, 1, 2, 3],
                'teamId': '1', 'isFinished': False,
                'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
            })

    def answers(self, user):
        return self.room_ref.collection('players').document(str(user.id)).get().to_dict()['answers']

    def player(self, user):
        return self.room_ref.collection('players').document(str(user.id)).get().to_dict()

    def team(self, team_id='1'):
        return self.room_ref.collection('teams').document(team_id).get().to_dict()

    def advance_to(self, index):
        self.client.force_authenticate(user=self.a)
        while int(self.room_ref.get().to_dict()['teamQuestionIndex']) < index:
            current = self.room_ref.get().to_dict()['teamQuestionIndex']
            # Each step needs the round it is leaving to be over, so the clock is
            # put back before every single hop rather than once at the end.
            self.room_ref.update({'teamStartedAt': timezone.now() - timedelta(seconds=120)})
            resp = self.client.post(reverse('team-advance'), {
                'roomCode': 'LOG1', 'questionIndex': current + 1}, format='json')
            self.assertEqual(resp.status_code, 200, resp.data)
        self.room_ref.update({'teamStartedAt': timezone.now() - timedelta(seconds=120)})

    def pick(self, user, index, answer='A. yes', force=False):
        self.advance_to(index)
        self.client.force_authenticate(user=user)
        return self.client.post(reverse('team-pick'), {
            'roomCode': 'LOG1', 'questionIndex': index, 'answer': answer,
            'timeTaken': '1', 'force': 'true' if force else 'false',
        }, format='json')

    def settle(self, index, a_answer, b_answer, force=True):
        """Both members pick; the second one resolves the question."""
        self.pick(self.a, index, a_answer)
        return self.pick(self.b, index, b_answer, force=force)

    def settle_speeds(self, index, a_time, b_time, answer='A. yes'):
        """Both members pick the same answer at the given times (seconds).

        Mirrors `settle`: the first pick goes in unforced and stays pending, the
        second settles the question. Forcing both would resolve on the first,
        because this fixture's shared clock is already past the limit.
        """
        for user, taken, force in ((self.a, a_time, False), (self.b, b_time, True)):
            self.client.force_authenticate(user=user)
            resp = self.client.post(reverse('team-pick'), {
                'roomCode': 'LOG1', 'questionIndex': index, 'answer': answer,
                'timeTaken': str(taken), 'force': 'true' if force else 'false',
            }, format='json')
            self.assertEqual(resp.status_code, 200, resp.data)

    def test_the_team_speed_is_the_median_not_the_last_submitter(self):
        """Whoever settles the question must not decide the payout.

        b submits last with a slow time. Before this, the team's speed bonus came
        straight from that value, so b could hand the whole team fewer points by
        dawdling -- and the award depended on who the transaction happened to
        settle for.
        """
        self.settle_speeds(0, a_time=2.0, b_time=12.0)

        time_per_q = self.room_ref.get().to_dict().get('timePerQuestion', 15)
        # Median of (2, 12) is 7 -- b's 12 does not drag it, and a's 2 does not
        # inflate it either.
        expected = max(int(1000 * (1 - (7.0 / time_per_q) * 0.5)), 500)
        reveal = self.team()['reveals']['q0']
        self.assertEqual(reveal['speedBonus'], expected - 500)

    def test_the_same_picks_score_identically_either_way_round(self):
        """Order-independence, which is the property that actually matters."""
        self.settle_speeds(0, a_time=3.0, b_time=9.0)
        first = self.team()['reveals']['q0']['points']
        self.advance_to(1)
        # Same two observations, reversed submit order.
        for user, taken, force in ((self.b, 9.0, False), (self.a, 3.0, True)):
            self.client.force_authenticate(user=user)
            self.client.post(reverse('team-pick'), {
                'roomCode': 'LOG1', 'questionIndex': 1, 'answer': 'A. yes',
                'timeTaken': str(taken), 'force': 'true' if force else 'false',
            }, format='json')
        self.assertEqual(self.team()['reveals']['q1']['points'], first)

    def test_a_legacy_pick_without_a_time_still_scores(self):
        """A room already mid-round when the pick shape changed must not break.

        The stored pick is a bare answer string, as every pre-existing room has.
        """
        self.advance_to(0)
        self.room_ref.collection('_server').document('teamPicks_1').set({
            'questionIndex': 0,
            'picks': {str(self.a.id): 'A. yes'},
        })
        self.client.force_authenticate(user=self.b)
        resp = self.client.post(reverse('team-pick'), {
            'roomCode': 'LOG1', 'questionIndex': 0, 'answer': 'A. yes',
            'timeTaken': '4', 'force': 'false',
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(self.team()['reveals']['q0']['correct'])
        # Only one time was recorded, so that observation is the team's time.
        self.assertGreater(self.team()['reveals']['q0']['speedBonus'], 0)

    def test_each_answer_is_logged_under_the_canonical_question_index(self):
        self.settle(0, 'A. yes', 'A. yes')
        self.assertIn('q0', self.answers(self.a))
        self.assertIn('q0', self.answers(self.b))

        # The room moves on as a whole, so question 2 is the third one.
        self.settle(2, 'B. no', 'B. no')
        self.assertIn('q2', self.answers(self.a))
        self.assertIn('q2', self.answers(self.b))
        self.assertNotIn('q1', self.answers(self.a))

    def test_both_members_get_the_team_outcome_and_their_own_pick(self):
        self.settle(0, 'A. yes', 'A. yes')
        for user in (self.a, self.b):
            entry = self.answers(user)['q0']
            self.assertTrue(entry['correct'])
            self.assertEqual(entry['picked'], 'A. yes')
            self.assertTrue(entry['agreed'])
            self.assertGreater(entry['points'], 0)

    def test_a_member_only_ever_sees_their_own_pick(self):
        """A split is recorded per member without publishing either side.

        The team's own answer is public -- it has to be, it is what scored --
        but who voted for it is not, so the log for one member must never
        contain the other member's choice.

        a and b split 1-1 with a holding the right answer, so knowledge breaks
        the tie and the question scores. That is the case where exposing both
        picks would be most tempting, which is why it is asserted here: both
        members read the shared outcome, each sees only their own vote.
        """
        self.settle(0, 'A. yes', 'B. no')
        self.assertEqual(self.answers(self.a)['q0']['picked'], 'A. yes')
        self.assertEqual(self.answers(self.b)['q0']['picked'], 'B. no')
        # One correct pick against one wrong pick resolves to the correct one,
        # so the whole team is graded on it -- the outcome is shared, the vote
        # is not.
        self.assertTrue(self.answers(self.a)['q0']['correct'])
        self.assertTrue(self.answers(self.b)['q0']['correct'])
        self.assertTrue(self.answers(self.a)['q0']['agreed'])
        self.assertFalse(self.answers(self.b)['q0']['agreed'])
        self.assertGreater(self.team()['score'], 0)

    def test_a_member_who_never_picked_is_logged_as_not_agreeing(self):
        # The clock runs out with only a's vote in: the team answers 'B. no'.
        self.pick(self.a, 0, 'B. no')
        resp = self.pick(self.a, 0, 'B. no', force=True)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self.answers(self.a)['q0']['picked'], 'B. no')
        # b never picked, so their own entry is empty rather than a copy of a's.
        self.assertEqual(self.answers(self.b)['q0']['picked'], '')
        self.assertFalse(self.answers(self.b)['q0']['agreed'])

    def test_a_members_score_always_equals_their_teams(self):
        self.settle(0, 'A. yes', 'A. yes')
        self.settle(1, 'A. yes', 'A. yes')
        team_score = self.team()['score']
        self.assertGreater(team_score, 0)
        for user in (self.a, self.b):
            self.assertEqual(self.player(user)['score'], team_score)

    def test_a_replayed_pick_does_not_rescore_or_duplicate_its_entry(self):
        first = self.settle(0, 'A. yes', 'A. yes').json()
        team_score = self.team()['score']
        again = self.pick(self.a, 0, 'A. yes', force=True)
        # The question is settled, so a replay is refused outright.
        self.assertEqual(again.status_code, 409)
        self.assertEqual(first['pointsAwarded'], team_score)
        self.assertEqual(len(self.answers(self.a)), 1)


class TeamLeadershipTests(TestCase):
    """The leader seat decides real powers, so it has to move.

    `leaderId` gates renaming and locking in the team's answer. It was assigned
    by arrival order and never revisited, so a member who wanted either power
    had no way to ask for it, and a leader who left kept both over a team they
    were no longer on.
    """

    def setUp(self):
        self.host = User.objects.create_user(username='host', password='pass')
        self.p1 = User.objects.create_user(username='p1', password='pass')
        self.p2 = User.objects.create_user(username='p2', password='pass')
        self.p3 = User.objects.create_user(username='p3', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('LEAD')
        self.room_ref.set({
            'status': 'waiting', 'hostId': self.host.id, 'teamMode': True,
            'teamCount': 1, 'topic': 't', 'questionCount': 1, 'timePerQuestion': 15,
            'questions': [{'type': 'mcq', 'question': 'q',
                           'choices': ['A. y', 'B. n'], 'correctAnswer': 'A. y'}],
        })
        self.room_ref.collection('teams').document('1').set({
            'name': 'Team 1', 'color': '#22D3EE', 'score': 0, 'correctCount': 0,
            'answeredCount': 0, 'memberIds': [str(self.p1.id), str(self.p2.id)],
            'memberCount': 2, 'maxSize': 5, 'leaderId': str(self.p1.id),
            'teamCorrect': 0, 'multiplier': 1.0, 'nameLocked': False,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        for user in (self.host, self.p1, self.p2, self.p3):
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': 0, 'isFinished': False,
            })
        # p1 and p2 are on the team; p3 and the host are not.
        for user in (self.p1, self.p2):
            self.room_ref.collection('players').document(str(user.id)).update({'teamId': '1'})

    def team(self):
        return self.room_ref.collection('teams').document('1').get().to_dict()

    def player(self, user):
        return self.room_ref.collection('players').document(str(user.id)).get().to_dict()

    def test_transfer_moves_the_seat(self):
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('transfer-team-leader'), {
            'roomCode': 'LEAD', 'teamId': '1', 'userId': str(self.p2.id),
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(str(self.team()['leaderId']), str(self.p2.id))

    def test_the_new_leader_gains_the_rights_the_old_one_held(self):
        # The seat is not a label: it is what gates rename and lock-in, so a
        # transfer has to change behaviour, not just the badge.
        self.client.force_authenticate(user=self.p2)
        self.assertEqual(self.client.post(reverse('rename-team'), {
            'roomCode': 'LEAD', 'teamId': '1', 'name': 'Blocked',
        }, format='json').status_code, 403)

        self.client.force_authenticate(user=self.p1)
        self.client.post(reverse('transfer-team-leader'), {
            'roomCode': 'LEAD', 'teamId': '1', 'userId': str(self.p2.id),
        }, format='json')

        self.client.force_authenticate(user=self.p2)
        self.assertEqual(self.client.post(reverse('rename-team'), {
            'roomCode': 'LEAD', 'teamId': '1', 'name': 'Allowed',
        }, format='json').status_code, 200)

    def test_an_outsider_cannot_take_over(self):
        self.client.force_authenticate(user=self.p3)
        resp = self.client.post(reverse('transfer-team-leader'), {
            'roomCode': 'LEAD', 'teamId': '1', 'userId': str(self.p3.id),
        }, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_a_plain_member_cannot_hand_the_seat_on(self):
        self.client.force_authenticate(user=self.p2)
        resp = self.client.post(reverse('transfer-team-leader'), {
            'roomCode': 'LEAD', 'teamId': '1', 'userId': str(self.p2.id),
        }, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_the_host_can_hand_the_seat_on(self):
        # A team whose leader has gone quiet would otherwise be unable to rename
        # itself or lock in an answer for the rest of the quiz.
        self.client.force_authenticate(user=self.host)
        resp = self.client.post(reverse('transfer-team-leader'), {
            'roomCode': 'LEAD', 'teamId': '1', 'userId': str(self.p2.id),
        }, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_leadership_cannot_leave_the_team(self):
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('transfer-team-leader'), {
            'roomCode': 'LEAD', 'teamId': '1', 'userId': str(self.p3.id),
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_teams_lock_once_the_game_starts(self):
        self.room_ref.update({'status': 'active'})
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('transfer-team-leader'), {
            'roomCode': 'LEAD', 'teamId': '1', 'userId': str(self.p2.id),
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_leader_follows_the_leaver_off_the_team(self):
        # Leaving used to leave `leaderId` behind, so a player who walked away
        # kept rename and lock-in over a team they were no longer on.
        self.client.force_authenticate(user=self.p1)
        self.client.post(reverse('assign-team'),
                         {'roomCode': 'LEAD', 'teamId': None}, format='json')
        # `.get` because leaving DELETES the field rather than nulling it.
        self.assertIsNone(self.player(self.p1).get('teamId'))
        self.assertEqual(str(self.team()['leaderId']), str(self.p2.id))

    def test_a_stale_leader_id_is_not_trusted(self):
        # Guards the read path directly: a team document whose stored leader is
        # no longer a member must not hand that person the team's powers.
        self.room_ref.collection('teams').document('1').update({
            'memberIds': [str(self.p2.id)], 'memberCount': 1,
            'leaderId': str(self.p1.id),
        })
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('rename-team'), {
            'roomCode': 'LEAD', 'teamId': '1', 'name': 'Ghost',
        }, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(self.team()['name'], 'Team 1')

    # ── lock in ──

    def _start_question(self):
        self.room_ref.update({
            'status': 'active',
            'teamQuestionIndex': 0,
            'teamStartedAt': timezone.now() - timedelta(seconds=120),
        })

    def test_the_leader_can_lock_in_the_team_answer(self):
        self._start_question()
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('team-pick'), {
            'roomCode': 'LEAD', 'questionIndex': 0,
            'answer': 'A. y', 'timeTaken': 2.0, 'lockIn': 'true',
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        # Locked in early, so the question is resolved rather than pending even
        # though p2 has not picked.
        self.assertFalse(resp.json()['pending'])
        self.assertIn(0, list(self.team().get('resolvedQuestions') or []))

    def test_a_plain_member_cannot_lock_in(self):
        self._start_question()
        self.client.force_authenticate(user=self.p2)
        resp = self.client.post(reverse('team-pick'), {
            'roomCode': 'LEAD', 'questionIndex': 0,
            'answer': 'A. y', 'timeTaken': 2.0, 'lockIn': 'true',
        }, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()['leaderId'], str(self.p1.id))
        # Still open, so the team carries on voting.
        self.assertNotIn(0, list(self.team().get('resolvedQuestions') or []))

    def test_lock_in_needs_an_answer(self):
        # It is a decision, so there has to be a decision to commit; otherwise
        # "lock in" would settle on nothing and hand out a void question.
        self._start_question()
        self.client.force_authenticate(user=self.p1)
        resp = self.client.post(reverse('team-pick'), {
            'roomCode': 'LEAD', 'questionIndex': 0,
            'answer': '', 'timeTaken': 2.0, 'lockIn': 'true',
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_lock_in_cannot_score_the_question_twice(self):
        self._start_question()
        self.client.force_authenticate(user=self.p1)
        self.client.post(reverse('team-pick'), {
            'roomCode': 'LEAD', 'questionIndex': 0,
            'answer': 'A. y', 'timeTaken': 2.0, 'lockIn': 'true',
        }, format='json')
        again = self.client.post(reverse('team-pick'), {
            'roomCode': 'LEAD', 'questionIndex': 0,
            'answer': 'B. n', 'timeTaken': 2.0, 'lockIn': 'true',
        }, format='json')
        # 400 "already locked in", not 409 "already settled". The lock-in guard
        # reads `reveals` for the key `q0`, because the settle writes
        # `reveals.q0` as a dotted field path and Firestore nests it. It used to
        # test for the literal key `reveals.q0`, which never existed, so the
        # guard was dead and a duplicate lock-in fell through to the resolver's
        # resolvedQuestions check -- which the client treats as a stale index
        # and answers by blanking the screen.
        self.assertEqual(again.status_code, 400)
        self.assertIn('already locked in', again.json()['error'].lower())
        # And it really is refused rather than re-settled: the reveal still holds
        # the first answer, and the question was only ever counted once.
        team = self.team()
        self.assertEqual(team['answeredCount'], 1)
        self.assertEqual(team['reveals']['q0']['answer'], 'A. y')


class TeamMajorityVoteTests(TestCase):
    """The mechanic itself: private picks, one majority answer, one shared score.

    These are the rules the whole team redesign rests on, so they are asserted
    directly rather than through the scoring suite: when a question closes, what
    "the team's answer" means, and who is allowed to see whose pick it was.
    """

    def setUp(self):
        self.host = User.objects.create_user(username='mhost', password='pass')
        self.members = [User.objects.create_user(username=f'm{i}', password='pass') for i in range(3)]
        self.outsider = User.objects.create_user(username='mout', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.room_ref = self.store.collection('gameRooms').document('MAJ1')
        self.room_ref.set({
            'status': 'active', 'hostId': self.host.id, 'ownerId': self.host.id,
            'teamMode': True,
            'teamCount': 2, 'timePerQuestion': 15,
            'teamQuestionIndex': 0,
            'teamStartedAt': timezone.now() - timedelta(seconds=120),
            'questions': [
                {'type': 'mcq', 'question': f'Q{i}',
                 'choices': ['A. yes', 'B. no', 'C. maybe'],
                 'correctAnswer': 'A. yes'} for i in range(4)
            ],
        })
        self.room_ref.collection('teams').document('1').set({
            'name': 'Alphas', 'color': TEAM_COLORS[0], 'score': 0,
            'correctCount': 0, 'answeredCount': 0,
            'memberIds': [str(u.id) for u in self.members], 'memberCount': 3,
            'teamCorrect': 0, 'teamStreak': 0, 'multiplier': 1.0,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        self.room_ref.collection('teams').document('2').set({
            'name': 'Betas', 'color': TEAM_COLORS[1], 'score': 0,
            'correctCount': 0, 'answeredCount': 0, 'memberIds': [], 'memberCount': 0,
            'teamCorrect': 0, 'multiplier': 1.0,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        for user, team_id in [(self.host, '2'), (self.outsider, None)] + [
                (u, '1') for u in self.members]:
            self.room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': 0, 'answeredCount': 0,
                'correctCount': 0, 'streak': 0, 'teamId': team_id, 'isFinished': False,
                'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
            })

    def team(self, team_id='1'):
        return self.room_ref.collection('teams').document(team_id).get().to_dict()

    def player(self, user):
        return self.room_ref.collection('players').document(str(user.id)).get().to_dict()

    def reveal(self, index=0):
        return self.team().get('reveals', {}).get(f'q{index}')

    def server_picks(self, team_id='1'):
        return self.room_ref.collection('_server').document(f'teamPicks_{team_id}').get().to_dict()

    def pick(self, user, answer, index=0, force=False):
        self.client.force_authenticate(user=user)
        return self.client.post(reverse('team-pick'), {
            'roomCode': 'MAJ1', 'questionIndex': index, 'answer': answer,
            'timeTaken': '1', 'force': 'true' if force else 'false',
        }, format='json')

    def advance_to(self, index):
        self.client.force_authenticate(user=self.host)
        while int(self.room_ref.get().to_dict()['teamQuestionIndex']) < index:
            current = self.room_ref.get().to_dict()['teamQuestionIndex']
            # Each hop needs the round being left to be over, so the clock is put
            # back before every step, not once at the end.
            self.room_ref.update({'teamStartedAt': timezone.now() - timedelta(seconds=120)})
            resp = self.client.post(reverse('team-advance'), {
                'roomCode': 'MAJ1', 'questionIndex': current + 1}, format='json')
            self.assertEqual(resp.status_code, 200, resp.data)
        self.room_ref.update({'teamStartedAt': timezone.now() - timedelta(seconds=120)})

    def close(self, answers, index=0):
        """Everyone in `answers` (a list of (user, choice)) picks, in order."""
        body = {}
        for user, choice in answers:
            resp = self.pick(user, choice, index=index)
            self.assertEqual(resp.status_code, 200, resp.data)
            body = resp.json()
        return body

    def test_the_question_stays_pending_until_everyone_has_picked(self):
        resp = self.pick(self.members[0], 'A. yes')
        self.assertEqual(resp.status_code, 200, resp.data)
        body = resp.json()
        self.assertTrue(body['pending'])
        self.assertEqual(body['picked'], 1)
        self.assertEqual(body['expected'], 3)
        self.assertEqual(body['awaiting'], 2)
        # Nothing is scored and nothing is revealed while the team is still out.
        self.assertEqual(self.team()['answeredCount'], 0)
        self.assertEqual(self.team()['score'], 0)
        self.assertIsNone(self.reveal())

    def test_a_pending_response_reveals_no_teammate_pick(self):
        first = self.pick(self.members[0], 'A. yes').json()
        second = self.pick(self.members[1], 'B. no').json()
        # The server holds the picks so it can tally them, but the response is
        # counts only: no member can read a teammate's choice off their own
        # screen while the question is still open.
        for body in (first, second):
            self.assertNotIn('picks', body)
            self.assertNotIn('answer', body)
            self.assertNotIn('correctAnswer', body)

    def test_the_team_document_never_carries_the_tally(self):
        """`firestore.rules` lets any signed-in user read a team document.

        The mobile app needs that (roster, powerups, reveals), so a `picks` map
        of player id to answer left there was readable by the whole room -- a
        member could open the Firestore console, or simply read the document
        their own app already subscribes to, and see every teammate's choice.
        Private picking is only private if the votes are not on a shared
        document, so the tally lives in the server-only `_server` collection and
        the team document publishes nothing but a count.
        """
        self.pick(self.members[0], 'A. yes')
        self.pick(self.members[1], 'B. no')

        team_doc = self.team()
        self.assertNotIn('picks', team_doc)
        # Only a bare number: no answers anywhere on the shared document.
        self.assertEqual(team_doc['pickCount'], 2)
        self.assertNotIn('A. yes', json.dumps(team_doc))
        self.assertNotIn('B. no', json.dumps(team_doc))
        # The server can still tally it. A pick carries the time alongside the
        # answer so the team can be scored on its median rather than on whoever
        # submitted last.
        self.assertEqual(
            self.server_picks()['picks'],
            {
                str(self.members[0].id): {'answer': 'A. yes', 'timeTaken': 1.0},
                str(self.members[1].id): {'answer': 'B. no', 'timeTaken': 1.0},
            },
        )

    def test_the_published_count_resets_once_the_question_closes(self):
        self.close([
            (self.members[0], 'A. yes'),
            (self.members[1], 'A. yes'),
            (self.members[2], 'A. yes'),
        ])
        self.assertEqual(self.team()['pickCount'], 0)
        self.assertEqual(self.server_picks()['picks'], {})

    def test_an_empty_team_does_not_hold_the_room_back(self):
        """The room-wide advance rule counts teams that can actually answer.

        A team left with no members can never resolve a question, so treating it
        as waiting would deadlock the room until the deadline every time.
        """
        self.room_ref.update({'teamStartedAt': timezone.now()})
        self.close([
            (self.members[0], 'A. yes'),
            (self.members[1], 'A. yes'),
            (self.members[2], 'A. yes'),
        ])
        self.client.force_authenticate(user=self.members[0])
        resp = self.client.post(reverse('team-advance'), {
            'roomCode': 'MAJ1', 'questionIndex': 1}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_a_team_that_has_not_answered_holds_the_room_back(self):
        """One team finishing must not pull the others off the question.

        The index is room-wide, so advancing as soon as the caller's own team is
        done would skip the question for a team that is still reading it. The
        room moves when every team has answered, or when time is up.
        """
        rival = User.objects.create_user(username='mrival', password='pass')
        self.room_ref.collection('teams').document('2').update({
            'memberIds': [str(rival.id)], 'memberCount': 1,
        })
        self.room_ref.collection('players').document(str(rival.id)).set({
            'displayName': rival.username, 'score': 0, 'answeredCount': 0,
            'correctCount': 0, 'streak': 0, 'teamId': '2', 'isFinished': False,
        })
        self.room_ref.update({'teamStartedAt': timezone.now()})

        self.close([
            (self.members[0], 'A. yes'),
            (self.members[1], 'A. yes'),
            (self.members[2], 'A. yes'),
        ])
        self.client.force_authenticate(user=self.members[0])
        blocked = self.client.post(reverse('team-advance'), {
            'roomCode': 'MAJ1', 'questionIndex': 1}, format='json')
        self.assertEqual(blocked.status_code, 409, blocked.data)
        self.assertEqual(blocked.json()['waitingTeams'], 1)

        # Once the rival has answered too, the room is free to move on -- with the
        # clock rewound, so it is the second team answering that released it and
        # not the deadline quietly lapsing.
        self.room_ref.update({'teamStartedAt': timezone.now() - timedelta(seconds=120)})
        rival_pick = self.pick(rival, 'A. yes', force=True)
        self.assertEqual(rival_pick.status_code, 200, rival_pick.data)
        self.room_ref.update({'teamStartedAt': timezone.now()})
        allowed = self.client.post(reverse('team-advance'), {
            'roomCode': 'MAJ1', 'questionIndex': 1}, format='json')
        self.assertEqual(allowed.status_code, 200, allowed.data)

    def test_the_deadline_releases_the_room_despite_an_unanswered_team(self):
        rival = User.objects.create_user(username='mrival2', password='pass')
        self.room_ref.collection('teams').document('2').update({
            'memberIds': [str(rival.id)], 'memberCount': 1,
        })
        self.room_ref.collection('players').document(str(rival.id)).set({
            'displayName': rival.username, 'score': 0, 'answeredCount': 0,
            'correctCount': 0, 'streak': 0, 'teamId': '2', 'isFinished': False,
        })
        self.close([
            (self.members[0], 'A. yes'),
            (self.members[1], 'A. yes'),
            (self.members[2], 'A. yes'),
        ])
        # `close` leaves the shared clock expired, which is the case that has to
        # keep working: a team that walked away cannot strand the room.
        self.client.force_authenticate(user=self.members[0])
        resp = self.client.post(reverse('team-advance'), {
            'roomCode': 'MAJ1', 'questionIndex': 1}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_a_plurality_wins_without_an_absolute_majority(self):
        body = self.close([
            (self.members[0], 'A. yes'),
            (self.members[1], 'B. no'),
            (self.members[2], 'B. no'),
        ])
        self.assertFalse(body['pending'])
        self.assertFalse(body['void'])
        self.assertEqual(body['answer'], 'B. no')
        self.assertEqual(body['agreed'], 2)
        self.assertEqual(body['pickers'], 3)
        # The team answered wrong together, so nobody scores.
        self.assertFalse(body['correct'])
        self.assertEqual(body['pointsAwarded'], 0)
        self.assertEqual(self.team()['answeredCount'], 1)
        self.assertEqual(self.team()['score'], 0)

    def test_a_tie_voids_the_question_but_still_reveals_the_answer(self):
        body = self.close([
            (self.members[0], 'A. yes'),
            (self.members[1], 'B. no'),
            (self.members[2], 'C. maybe'),
        ])
        self.assertTrue(body['void'])
        # Voided means there IS no team answer -- awarding the void to whichever
        # side was listed first would make the result depend on dict ordering.
        self.assertEqual(body['answer'], '')
        # ...but the team still learns what the right answer was.
        self.assertEqual(body['correctAnswer'], 'A. yes')
        self.assertFalse(body['correct'])
        self.assertEqual(body['pointsAwarded'], 0)
        # The attempt still counts against the question total.
        self.assertEqual(self.team()['answeredCount'], 1)
        self.assertEqual(self.reveal()['void'], True)

    def test_every_member_shares_the_teams_score_and_outcome(self):
        body = self.close([(u, 'A. yes') for u in self.members])
        self.assertTrue(body['correct'])
        self.assertGreater(body['pointsAwarded'], 0)
        team_score = self.team()['score']
        self.assertEqual(team_score, body['pointsAwarded'])
        for user in self.members:
            member = self.player(user)
            self.assertEqual(member['score'], team_score)
            self.assertEqual(member['answeredCount'], 1)
            self.assertEqual(member['correctCount'], 1)
            self.assertTrue(member['answers']['q0']['correct'])

    def test_agreement_is_a_count_and_never_a_list_of_voters(self):
        self.close([
            (self.members[0], 'A. yes'),
            (self.members[1], 'A. yes'),
            (self.members[2], 'B. no'),
        ])
        reveal = self.reveal()
        self.assertEqual(reveal['agreed'], 2)
        # Nothing in the public reveal may name who voted which way.
        self.assertNotIn('picks', reveal)
        self.assertNotIn('memberIds', reveal)
        self.assertNotIn('voters', reveal)

    def test_a_repeat_pick_does_not_add_a_second_vote(self):
        self.pick(self.members[0], 'A. yes')
        again = self.pick(self.members[0], 'A. yes')
        self.assertEqual(again.json()['picked'], 1)
        self.assertEqual(again.json()['awaiting'], 2)

    def test_a_changed_pick_replaces_the_earlier_one(self):
        self.pick(self.members[0], 'A. yes')
        changed = self.pick(self.members[0], 'B. no')
        # Still one voter, so the question is still open...
        self.assertTrue(changed.json()['pending'])
        self.assertEqual(changed.json()['picked'], 1)
        # ...and the tally that eventually closes it uses the newer choice.
        body = self.close([(self.members[1], 'B. no'), (self.members[2], 'B. no')])
        self.assertEqual(body['answer'], 'B. no')
        self.assertEqual(body['agreed'], 3)

    def test_the_clock_closes_a_question_the_team_never_agreed_on(self):
        self.pick(self.members[0], 'A. yes')
        resp = self.pick(self.members[0], 'A. yes', force=True)
        self.assertEqual(resp.status_code, 200, resp.data)
        body = resp.json()
        self.assertFalse(body['pending'])
        self.assertEqual(body['pickers'], 1)
        self.assertEqual(body['agreed'], 1)
        # The two members who never voted are not counted as agreeing.
        self.assertFalse(self.player(self.members[1])['answers']['q0']['agreed'])

    def test_a_member_who_disagreed_is_recorded_as_disagreeing(self):
        # The bug being pinned: a member who picked against the majority was
        # written into their own log with `agreed` unset, and the client read
        # that as "you did not pick before time ran out" -- accusing them of
        # timing out when they had answered, deliberately, differently.
        self.close([
            (self.members[0], 'A. yes'),
            (self.members[1], 'A. yes'),
            (self.members[2], 'B. no'),
        ])
        answers = self.player(self.members[2])['answers']
        self.assertEqual(answers['q0']['picked'], 'B. no')
        self.assertFalse(answers['q0']['agreed'])
        # And the member who did agree, really did.
        self.assertTrue(self.player(self.members[0])['answers']['q0']['agreed'])

    def test_a_tie_records_no_agreement_for_anybody(self):
        # A 2-2 split has no majority, so nobody agreed with anybody. This used
        # to write `agreed: True` on every member's entry, and the client showed
        # "You agreed with your team" to all four players -- including the two
        # who had just voted against each other.
        self.members.append(User.objects.create_user(username='m3', password='pass'))
        self.room_ref.collection('teams').document('1').update({
            'memberIds': [str(u.id) for u in self.members], 'memberCount': 4,
        })
        self.room_ref.collection('players').document(str(self.members[3].id)).set({
            'displayName': 'm3', 'score': 0, 'answeredCount': 0, 'correctCount': 0,
            'streak': 0, 'teamId': '1', 'isFinished': False,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })
        body = self.close([
            (self.members[0], 'A. yes'),
            (self.members[1], 'A. yes'),
            (self.members[2], 'B. no'),
            (self.members[3], 'B. no'),
        ])
        self.assertTrue(body['void'])
        for user in self.members:
            agreed = self.player(user)['answers']['q0']['agreed']
            # None, not False: "the vote was split" is not "you were on the
            # wrong side", and the client renders them differently.
            self.assertIsNone(agreed, f'{user.username} should not be scored agreed or disagreed')

    def test_agreement_is_graded_leniently_on_a_typed_question(self):
        # `is_correct` compares the team answer with `answer_matches`, but this
        # per-member check used a plain `==`. So a member who typed
        # "chlorophyll" against a team answer of "Chlorophyll" was scored CORRECT
        # and simultaneously told they had disagreed with their team.
        self.room_ref.update({
            'questions': [{
                'type': 'identification', 'question': 'Which pigment?',
                'correctAnswer': 'Chlorophyll',
            }],
        })
        self.close([
            (self.members[0], 'Chlorophyll'),
            (self.members[1], 'Chlorophyll'),
            (self.members[2], 'chlorophyll'),
        ])
        answers = self.player(self.members[2])['answers']
        self.assertTrue(answers['q0']['correct'], 'team was scored correct')
        self.assertTrue(
            answers['q0']['agreed'],
            'a case-only difference must not read as disagreeing with the team',
        )

    def test_a_client_cannot_close_the_question_before_the_deadline(self):
        # A fresh timer: this is the moment a member picks, not the moment the
        # round ends.
        self.room_ref.update({'teamStartedAt': timezone.now()})
        resp = self.pick(self.members[0], 'A. yes', force=True)
        self.assertEqual(resp.status_code, 400)
        body = resp.json()
        self.assertTrue(body['pending'])
        self.assertGreater(body['secondsLeft'], 0)
        self.assertEqual(self.team()['answeredCount'], 0)

    def test_a_non_member_cannot_pick_for_a_team(self):
        rogue = User.objects.create_user(username='mrogue', password='pass')
        self.room_ref.collection('players').document(str(rogue.id)).set({
            'displayName': 'rogue', 'score': 0, 'teamId': '1', 'isFinished': False,
        })
        resp = self.pick(rogue, 'A. yes')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(self.team()['answeredCount'], 0)

    def test_a_spectator_cannot_pick(self):
        resp = self.pick(self.outsider, 'A. yes')
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(resp.json()['spectator'])
        self.assertEqual(self.team('2')['answeredCount'], 0)

    def test_advancing_clears_the_previous_questions_picks(self):
        self.close([(u, 'A. yes') for u in self.members])
        self.advance_to(1)
        # The next question starts from nothing: it cannot inherit the votes.
        self.assertTrue(self.pick(self.members[0], 'B. no', index=1).json()['pending'])
        self.assertEqual(self.team()['answeredCount'], 1)

    def test_a_team_answers_each_question_once(self):
        self.close([(u, 'A. yes') for u in self.members])
        self.advance_to(1)
        self.close([(u, 'B. no') for u in self.members], index=1)
        team = self.team()
        self.assertEqual(team['answeredCount'], 2)
        self.assertEqual(team['correctCount'], 1)
        self.assertEqual(sorted(team['resolvedQuestions']), [0, 1])

    def advance(self, target, user=None):
        self.client.force_authenticate(user=user or self.members[0])
        return self.client.post(reverse('team-advance'), {
            'roomCode': 'MAJ1', 'questionIndex': target}, format='json')

    def test_the_room_cannot_be_advanced_past_an_open_question(self):
        # Fresh timer and nobody has answered: moving on now would take the
        # question away from the rest of the team.
        self.room_ref.update({'teamStartedAt': timezone.now()})
        resp = self.advance(1)
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.json()['questionIndex'], 0)
        self.assertGreater(resp.json()['secondsLeft'], 0)
        self.assertEqual(self.room_ref.get().to_dict()['teamQuestionIndex'], 0)

    def test_the_room_advances_once_the_question_is_answered(self):
        self.close([(u, 'A. yes') for u in self.members])
        resp = self.advance(1)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.json()['questionIndex'], 1)
        self.assertEqual(self.room_ref.get().to_dict()['teamQuestionIndex'], 1)

    def test_a_spectator_cannot_advance_the_room(self):
        resp = self.advance(1, user=self.outsider)
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(resp.json()['spectator'])
        self.assertEqual(self.room_ref.get().to_dict()['teamQuestionIndex'], 0)

    def test_someone_who_is_not_in_the_room_cannot_advance_it(self):
        stranger = User.objects.create_user(username='mstranger', password='pass')
        resp = self.advance(1, user=stranger)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(self.room_ref.get().to_dict()['teamQuestionIndex'], 0)

    def test_a_question_cannot_be_skipped_or_rewound(self):
        self.advance(5)
        self.assertEqual(self.advance(0).status_code, 409)
        self.assertEqual(self.room_ref.get().to_dict()['teamQuestionIndex'], 0)


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
            'status': 'active', 'hostId': self.host.id, 'ownerId': self.host.id,
            'teamMode': True,
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
            'memberIds': [str(self.small.id), str(self.host.id)], 'memberCount': 2,
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
        # The owner runs the room, so they hold a seat too. They never answered,
        # which is exactly the case the average has to ignore.
        self.room_ref.collection('players').document(str(self.host.id)).set({
            'displayName': 'host', 'score': 0, 'answeredCount': 0,
            'correctCount': 0, 'streak': 0, 'teamId': '2', 'isFinished': True,
        })

    def finish_as(self, user=None, **extra):
        # Settlement is the owner's action, so ranking is exercised through the
        # host's confirm and read back off the room.
        self.client.force_authenticate(user=user or self.host)
        return self.client.post(
            reverse('finish-game'), {'roomCode': 'FAIR1', **extra}, format='json')

    def test_the_smaller_team_wins_on_average_not_on_raw_total(self):
        # Raw scores are 3000 vs 2000, so ranking on totals puts Big first.
        self.assertEqual(self.room_ref.collection('teams').document('1').get().to_dict()['score'], 3000)
        resp = self.finish_as(confirm='true')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.json()['teamRank'], 1)

    def test_team_results_snapshot_carries_the_rank_score_it_sorted_on(self):
        self.finish_as(confirm='true')
        results = self.room_ref.get().to_dict()['teamResults']
        self.assertEqual([r['teamId'] for r in results], ['2', '1'])
        self.assertEqual(results[0]['rankScore'], 2000)
        self.assertEqual(results[1]['rankScore'], 1000)
        # The raw banked total is still there for the "total points" line.
        self.assertEqual(results[0]['score'], 2000)
        self.assertEqual(results[1]['score'], 3000)

    def test_a_member_who_never_answered_does_not_dilute_the_average(self):
        # The host holds a seat in Small and never answered. If the denominator
        # counted them, Small's average would halve and lose.
        self.room_ref.collection('players').document(str(self.host.id)).update({
            'teamId': '2', 'score': 0, 'answeredCount': 0, 'correctCount': 0,
        })
        self.finish_as(confirm='true')
        results = self.room_ref.get().to_dict()['teamResults']
        by_id = {r['teamId']: r for r in results}
        self.assertEqual(by_id['2']['activeMembers'], 1)
        self.assertEqual(by_id['2']['rankScore'], 2000)
        self.assertEqual(by_id['1']['activeMembers'], 3)

    def test_placement_xp_is_paid_on_the_averaged_ranking(self):
        small_activity = Activity.objects.filter(user=self.small).count()
        self.finish_as(confirm='true')
        self.assertGreater(Activity.objects.filter(user=self.small).count(), small_activity)

    def test_tied_averages_share_a_rank(self):
        # Both teams at 1000 average -> both rank 1, and the next would be 3.
        self.room_ref.collection('teams').document('1').update({'score': 3000})
        self.room_ref.collection('teams').document('2').update({'score': 1000})
        self.finish_as(confirm='true')
        results = self.room_ref.get().to_dict()['teamResults']
        self.assertEqual([r['rankScore'] for r in results], [1000, 1000])
        # A tie at the top is a shared first place, not a win and a loss.
        self.assertEqual(sorted({r['rank'] for r in results}), [1])

    def test_a_team_with_no_active_members_still_has_a_defined_value(self):
        self.room_ref.collection('players').document(str(self.bigs[0].id)).update({
            'score': 0, 'answeredCount': 0,
        })
        self.finish_as(confirm='true')
        results = self.room_ref.get().to_dict()['teamResults']
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


class TypedAnswerGradingTests(TestCase):
    """How a typed answer is compared to the expected one.

    The rule is deliberately narrow: lenient about capitalisation and whitespace,
    because the phone keyboard introduces both by itself, and strict about
    spelling. These pin the strict half as much as the lenient half -- a grader
    that silently accepted "photosynthosis" would be the worse bug.
    """

    def test_capitalisation_does_not_matter(self):
        self.assertTrue(answer_matches('Mitochondria', 'mitochondria'))
        self.assertTrue(answer_matches('mitochondria', 'MITOCHONDRIA'))

    def test_surrounding_and_repeated_whitespace_does_not_matter(self):
        self.assertTrue(answer_matches('  new   york  ', 'new york'))
        self.assertTrue(answer_matches('new york', 'New York'))

    def test_a_misspelling_is_still_wrong(self):
        # The whole point of the change: forgiving case is not the same as
        # forgiving a typo.
        self.assertFalse(answer_matches('photosynthosis', 'photosynthesis'))
        self.assertFalse(answer_matches('mitochondriaa', 'mitochondria'))

    def test_different_words_are_wrong(self):
        self.assertFalse(answer_matches('cytoplasm', 'mitochondria'))
        self.assertFalse(answer_matches('', 'mitochondria'))

    def test_none_is_wrong(self):
        self.assertFalse(answer_matches(None, 'mitochondria'))
        self.assertFalse(answer_matches('mitochondria', None))

    def test_non_ascii_compares_in_its_own_case(self):
        # `casefold` rather than `lower`; these differ, and lower() gets it wrong.
        self.assertTrue(answer_matches('beyoncé', 'BEYONCÉ'))


class QuestionTypeNormalisationTests(TestCase):
    """Every spelling of a question type resolves to one canonical value.

    The upload screen posts short ids while the AI generator posts display
    labels, and they were compared with `== 'identification'`. Anything but that
    one string took the multiple-choice branch, so an upload asking for typed
    answers silently produced four options per question.
    """

    def test_short_ids_and_labels_both_resolve(self):
        self.assertEqual(normalise_question_type('sa'), 'identification')
        self.assertEqual(normalise_question_type('Short Answer'), 'identification')
        self.assertEqual(normalise_question_type('Identification'), 'identification')
        self.assertEqual(normalise_question_type('identification'), 'identification')

    def test_fill_in_the_blank_is_its_own_typed_type(self):
        self.assertEqual(normalise_question_type('Fill-in-the-Blank'), 'fill_in_blank')
        self.assertEqual(normalise_question_type('fib'), 'fill_in_blank')

    def test_unknown_and_empty_default_to_multiple_choice(self):
        self.assertEqual(normalise_question_type(None), 'mcq')
        self.assertEqual(normalise_question_type(''), 'mcq')
        self.assertEqual(normalise_question_type('nonsense'), 'mcq')

    def test_a_fill_in_the_blank_quiz_serialises_as_such(self):
        host = User.objects.create_user(username='fibhost', password='pass')
        quiz = Quiz.objects.create(user=host, title='Gaps', quiz_type='Fill-in-the-Blank')
        QuizQuestion.objects.create(
            quiz=quiz, question_text='Water is H2_', options=[], correct_answer='H2O',
        )
        questions = build_questions_from_quiz(quiz)
        self.assertEqual(questions[0]['type'], 'fill_in_blank')
        # Grading does not care which of the two it is.
        self.assertIn(questions[0]['type'], TYPED_QUESTION_TYPES)


class TvLeaderboardTests(TestCase):
    """The TV display authenticates with nothing but the room code.

    This endpoint was quietly switched to IsAuthenticated while the browser page
    kept sending a bare fetch, so every poll on every classroom television has
    been failing 401 since. It is public again, deliberately -- these tests are
    what stops that from drifting a third time, and they also pin the throttle
    bucket that the unauthenticated version depends on to stay up.
    """

    def setUp(self):
        self.host = User.objects.create_user(username='tvhost', password='pass')
        self.p1 = User.objects.create_user(username='tvp1', password='pass')
        self.p2 = User.objects.create_user(username='tvp2', password='pass')

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()
        self.url = reverse('room-leaderboard', args=['TV001'])
        self.room_ref = self.store.collection('gameRooms').document('TV001')
        self.room_ref.set({
            'status': 'active', 'hostId': self.host.id, 'hostName': 'Teacher',
            'topic': 'Water Cycle', 'questionCount': 10, 'timePerQuestion': 15,
        })
        for i, u in enumerate((self.p1, self.p2), start=1):
            self.room_ref.collection('players').document(str(u.id)).set({
                'displayName': u.username, 'score': i * 100, 'answeredCount': i,
                'correctCount': i, 'streak': i, 'teamId': None,
            })

    def get_without_credentials(self):
        """No force_authenticate -- this is the browser-on-a-TV case."""
        return self.client.get(self.url)

    def test_the_room_code_alone_is_enough(self):
        resp = self.get_without_credentials()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['roomCode'], 'TV001')
        self.assertEqual([p['displayName'] for p in resp.data['players']], ['tvp2', 'tvp1'])

    def test_the_payload_carries_no_questions_and_no_answer_key(self):
        # The one thing a public endpoint must never hand out. The quiz content
        # lives on the room document itself, so this asserts the view selects
        # fields rather than echoing the room.
        resp = self.get_without_credentials()
        self.assertNotIn('questions', resp.data)
        self.assertNotIn('correctAnswer', resp.data)
        self.assertNotIn('answerKey', str(resp.data))

    def test_an_unknown_room_is_a_404_not_an_empty_leaderboard(self):
        # Otherwise a mistyped code renders a plausible-looking all-zero board.
        resp = self.client.get(reverse('room-leaderboard', args=['NOPE9']))
        self.assertEqual(resp.status_code, 404)

    def test_the_tv_bucket_replaces_the_anon_budget(self):
        # Reachable only because the view overrides throttle_classes: at the
        # default anon rate of 100/day the first display exhausts it in about
        # three minutes of 2s polling, and the screen then 429s for the rest of
        # the lesson.
        from game.views import RoomLeaderboardView
        from core.throttling import TvLeaderboardThrottle

        self.assertEqual(RoomLeaderboardView.permission_classes, [AllowAny])
        self.assertEqual(RoomLeaderboardView.throttle_classes, [TvLeaderboardThrottle])
        self.assertEqual(TvLeaderboardThrottle.scope, 'tv')

    def test_the_configured_rate_outlasts_a_full_session_of_polling(self):
        from django.conf import settings

        from core.throttling import TvLeaderboardThrottle

        # 18000/hour against 1800/hour per display leaves room for ten screens
        # sharing one classroom NAT. Asserted so a well-meaning trim of the
        # default back to a few hundred cannot silently break the TV again.
        num, _, period = settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'][TvLeaderboardThrottle.scope].partition('/')
        self.assertEqual(period, 'hour')
        self.assertGreaterEqual(int(num), 1800 * 10)

    def test_a_display_survives_past_the_old_anon_ceiling(self):
        # The concrete failure this endpoint had: at the default anon rate of
        # 100/day, request 101 returned 429 and the television sat on an error
        # for the rest of the lesson. Polling 150 times is ~5 minutes of real
        # 2s polling, and every one of them has to come back 200.
        for _ in range(150):
            resp = self.get_without_credentials()
            self.assertEqual(resp.status_code, 200)

class GameArchiveTests(TestCase):
    """A hosted game leaves a durable GameRoom row the class can list afterwards.

    Everything here exists because the archive is the ONLY record of a classic
    game that outlives the room. Firestore cannot answer "which games did this
    class play" (rooms are addressed only by the room code), classic results are
    never written to the room document at all, and a rematch wipes finishedAt.
    So the failure mode of a break here is not an error, it is a silently empty
    Games tab months later.
    """

    def setUp(self):
        self.educator = User.objects.create_user(
            username='teacher', password='pass', role='educator')
        self.student = User.objects.create_user(
            username='pupil', password='pass', role='student')
        self.rival = User.objects.create_user(
            username='rival', password='pass', role='educator')
        self.course = Course.objects.create(
            name='Year 9 Biology', educator=self.educator, description='cells')
        self.course.students.add(self.student)

        self.store = FakeFirestoreClient()
        patcher = patch('game.views.get_firestore', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = APIClient()

        # CreateGameView needs a real quiz or a file upload, and it only accepts
        # a quiz the host owns -- so each host gets their own.
        self.quizzes = {u: self._quiz_for(u) for u in (self.educator, self.student, self.rival)}

    @staticmethod
    def _quiz_for(user, title=None):
        quiz = Quiz.objects.create(user=user, title=title or f'{user.username} quiz')
        for i in range(5):
            QuizQuestion.objects.create(
                quiz=quiz, question_text=f'Question {i + 1}',
                options=['one', 'two', 'three', 'four'], correct_answer='one',
                explanation='',
            )
        return quiz

    # --- create: course scoping ---

    def create(self, user=None, **extra):
        user = user or self.educator
        self.client.force_authenticate(user=user)
        return self.client.post(reverse('create-game'), {
            'quizId': self.quizzes[user].id, **extra,
        }, format='json')


    def test_an_educator_hosting_for_a_class_files_the_room_under_it(self):
        resp = self.create(courseId=self.course.id)
        self.assertEqual(resp.status_code, 200, resp.data)

        room = GameRoom.objects.get(room_code=resp.json()['roomCode'])
        self.assertEqual(room.course, self.course)
        self.assertEqual(room.owner, self.educator)
        self.assertEqual(room.status, GameRoom.STATUS_WAITING)

    def test_the_course_id_also_reaches_the_room_document(self):
        resp = self.create(courseId=self.course.id)
        code = resp.json()['roomCode']
        self.assertEqual(
            self.store.collection('gameRooms').document(code).get().to_dict()['courseId'],
            self.course.id)

    def test_another_educator_cannot_file_a_game_under_someone_elses_class(self):
        resp = self.create(user=self.rival, courseId=self.course.id)
        self.assertEqual(resp.status_code, 403)
        # And nothing was created -- not even a room code handed out.
        self.assertFalse(GameRoom.objects.exists())

    def test_a_students_course_id_is_ignored_not_honoured(self):
        # Enrolled students may legitimately try to file a game under the class
        # they are in. The room is still created (they are allowed to host), but
        # it belongs to nobody's course history.
        resp = self.create(user=self.student, courseId=self.course.id)
        self.assertEqual(resp.status_code, 200, resp.data)
        room = GameRoom.objects.get(room_code=resp.json()['roomCode'])
        self.assertIsNone(room.course)
        self.assertNotIn(
            'courseId',
            self.store.collection('gameRooms').document(room.room_code).get().to_dict())

    def test_a_missing_course_is_a_404(self):
        self.assertEqual(self.create(courseId=999999).status_code, 404)

    def test_a_game_hosted_outside_any_class_is_still_archived(self):
        # The archive is not course-scoped-only: "games this educator has run"
        # is worth answering even for a game started from the FAB.
        resp = self.create()
        self.assertEqual(resp.status_code, 200, resp.data)
        room = GameRoom.objects.get(room_code=resp.json()['roomCode'])
        self.assertIsNone(room.course)
        self.assertEqual(room.owner, self.educator)

    # --- lifecycle: start / settle ---

    def _archive(self, **create_extra):
        resp = self.create(**create_extra)
        return GameRoom.objects.get(room_code=resp.json()['roomCode']), resp.json()['roomCode']

    def test_starting_a_room_stamps_the_time_it_went_live(self):
        room, code = self._archive(courseId=self.course.id)
        self.client.force_authenticate(user=self.educator)
        resp = self.client.post(reverse('start-game'), {'roomCode': code}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)

        room.refresh_from_db()
        self.assertEqual(room.status, GameRoom.STATUS_ACTIVE)
        self.assertIsNotNone(room.started_at)

    def test_a_second_start_does_not_move_the_original_start_time(self):
        # START is re-issued by clients on reconnect; the moment the class
        # actually started must not drift to the last retry.
        room, code = self._archive(courseId=self.course.id)
        self.client.force_authenticate(user=self.educator)
        self.client.post(reverse('start-game'), {'roomCode': code}, format='json')
        first = GameRoom.objects.get(pk=room.pk).started_at

        self.client.post(reverse('start-game'), {'roomCode': code}, format='json')
        self.assertEqual(GameRoom.objects.get(pk=room.pk).started_at, first)

    def _started_classic_room(self):
        """A real create -> start, with one student and the educator host joined."""
        room, code = self._archive(courseId=self.course.id)
        room_ref = self.store.collection('gameRooms').document(code)
        self.client.force_authenticate(user=self.educator)
        self.client.post(reverse('start-game'), {'roomCode': code}, format='json')
        for user, score in ((self.educator, 0), (self.student, 900)):
            # `set`, not `update`: only the host gets a player document from
            # CreateGameView, so the student's does not exist yet.
            room_ref.collection('players').document(str(user.id)).set({
                'displayName': user.username, 'score': score,
                'correctCount': 1, 'answeredCount': 1, 'isFinished': True,
                'answers': {'0': {'picked': 'a', 'correct': True}},
            })
        return room, code

    def _settle(self, code):
        return self.client.post(
            reverse('finish-game'), {'roomCode': code, 'confirm': 'true'}, format='json')

    def _finished_classic_room(self):
        """Drive a real create -> start -> settle and hand back the archive row."""
        room, code = self._started_classic_room()
        resp = self._settle(code)
        self.assertEqual(resp.status_code, 200, resp.data)
        return GameRoom.objects.get(pk=room.pk), code

    def test_settling_stores_the_same_results_the_students_see(self):
        room, code = self._finished_classic_room()
        self.assertEqual(room.status, GameRoom.STATUS_FINISHED)
        self.assertIsNotNone(room.finished_at)
        self.assertIsNotNone(room.started_at)

        payload = room.final_payload
        self.assertEqual(payload['mode'], 'classic')
        self.assertEqual(payload['roomCode'], code)
        names = sorted(p['name'] for p in payload['participants'])
        self.assertEqual(names, ['pupil'])

        # And it really is the same snapshot, not a parallel one that can drift.
        activity = Activity.objects.filter(user=self.student, kind='game').first()
        self.assertIsNotNone(activity)
        self.assertEqual(activity.payload['results'], payload)

    def test_the_player_count_excludes_the_educator_host(self):
        # The host ran the room; counting them would put "2 players" on a game
        # with exactly one competitor.
        room, _ = self._finished_classic_room()
        self.assertEqual(room.player_count, 1)

    def test_the_host_name_is_recorded_outside_the_results(self):
        # An educator host is excluded from the standings, so the results alone
        # cannot say who ran the game.
        room, _ = self._finished_classic_room()
        self.assertEqual(room.host_name, 'teacher')
        self.assertNotIn('teacher', [p['name'] for p in room.final_payload['participants']])

    def test_finishing_the_room_never_dies_with_the_archive(self):
        # The archive is best-effort by design: losing the history row must not
        # cost the class its XP or leave the room stuck mid-game. The database
        # itself is made to fail here rather than the helper, so this exercises
        # the guard that actually runs in production -- FinishGameView turns any
        # exception out of _settle into a 500, taking the XP payout with it.
        room, code = self._started_classic_room()
        with patch.object(GameRoom, 'objects') as broken_db:
            broken_db.filter.side_effect = RuntimeError('db down')
            resp = self._settle(code)

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            self.store.collection('gameRooms').document(code).get().to_dict()['status'],
            'finished')
        # The room really is settled: the students were paid despite the archive
        # being unreachable.
        self.assertTrue(Activity.objects.filter(user=self.student, kind='game').exists())


    # --- rematch: round one survives ---

    def test_a_rematch_files_round_one_away_instead_of_erasing_it(self):
        room, code = self._finished_classic_room()
        round_one = room.final_payload

        resp = self.client.post(reverse('rematch'), {'roomCode': code}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)

        room.refresh_from_db()
        self.assertEqual(room.previous_round, round_one)
        self.assertIsNone(room.final_payload)
        self.assertEqual(room.status, GameRoom.STATUS_WAITING)
        self.assertIsNotNone(room.previous_round_finished_at)

    def test_a_rematch_leaves_the_game_where_it_was_in_the_class_history(self):
        # created_at deliberately survives: a rematch is the same game played
        # twice, so it must not jump back to the top of the list as a new one.
        room, code = self._finished_classic_room()
        created = room.created_at

        self.client.post(reverse('rematch'), {'roomCode': code}, format='json')
        self.assertEqual(GameRoom.objects.get(pk=room.pk).created_at, created)

    def test_the_rematched_round_gets_its_own_times(self):
        room, code = self._finished_classic_room()
        self.client.post(reverse('rematch'), {'roomCode': code}, format='json')
        self.assertIsNone(GameRoom.objects.get(pk=room.pk).started_at)
        self.assertIsNone(GameRoom.objects.get(pk=room.pk).finished_at)

        self.client.post(reverse('start-game'), {'roomCode': code}, format='json')
        self.assertIsNotNone(GameRoom.objects.get(pk=room.pk).started_at)

    def test_swapping_the_quiz_on_a_rematch_is_recorded(self):
        room, code = self._finished_classic_room()
        quiz = self._quiz_for(self.educator, title='Round two topic')

        resp = self.client.post(
            reverse('rematch'), {'roomCode': code, 'quizId': quiz.id}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)

        room.refresh_from_db()
        self.assertEqual(room.quiz_id, quiz.id)
        self.assertEqual(room.topic, 'Round two topic')



class CourseGamesHistoryTests(TestCase):
    """GET /users/courses/<id>/games/ -- the class's Games tab."""

    def setUp(self):
        self.educator = User.objects.create_user(
            username='teacher', password='pass', role='educator')
        self.student = User.objects.create_user(
            username='pupil', password='pass', role='student')
        self.course = Course.objects.create(
            name='Year 9 Biology', educator=self.educator, description='c')
        self.other_course = Course.objects.create(
            name='Year 10 Chemistry', educator=self.educator, description='c')

        self.client = APIClient()

    def url(self, course=None):
        return reverse('course_games', kwargs={'course_id': (course or self.course).id})

    def archive(self, code, course, **kwargs):
        defaults = {
            'owner': self.educator,
            'topic': f'{code} topic',
            'status': GameRoom.STATUS_FINISHED,
            'player_count': 3,
            # `finished_at` is not auto (only `created_at` is), and these rows
            # stand in for games that actually ended.
            'finished_at': timezone.now(),
            # Normally written by game.views.archive_room; set here so these
            # tests read as "a room that was actually hosted".
            'host_name': 'teacher',
        }
        defaults.update(kwargs)
        return GameRoom.objects.create(room_code=code, course=course, **defaults)


    def get(self, user=None):
        self.client.force_authenticate(user=user or self.educator)
        return self.client.get(self.url())

    def test_the_educator_gets_the_class_games_newest_first(self):
        self.archive('OLD1', self.course, created_at=timezone.now() - timedelta(days=2))
        self.archive('NEW1', self.course)
        resp = self.get()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([g['room_code'] for g in resp.json()['games']], ['NEW1', 'OLD1'])

    def test_another_classs_games_never_leak_in(self):
        self.archive('MINE', self.course)
        self.archive('THEIRS', self.other_course)
        self.assertEqual([g['room_code'] for g in self.get().json()['games']], ['MINE'])

    def test_a_class_with_no_games_is_an_empty_list_not_an_error(self):
        resp = self.get()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['games'], [])

    def test_a_student_cannot_read_the_host_history(self):
        # These are the educator's own hosted games, and GameRoom.owner is the
        # educator, so a student would only ever see an empty list. Refused
        # outright rather than quietly empty.
        self.archive('MINE', self.course)
        self.assertEqual(self.get(user=self.student).status_code, 403)

    def test_another_educator_cannot_read_it(self):
        rival = User.objects.create_user(
            username='rival', password='pass', role='educator')
        self.assertEqual(self.get(user=rival).status_code, 403)

    def test_anonymous_is_rejected(self):
        self.assertEqual(self.client.get(self.url()).status_code, 401)

    def test_a_missing_class_is_a_404(self):
        self.client.force_authenticate(user=self.educator)
        resp = self.client.get(reverse('course_games', kwargs={'course_id': 999999}))
        self.assertEqual(resp.status_code, 404)

    def test_a_live_room_is_listed_so_the_tab_can_show_it_running(self):
        # Filtering to finished-only would hide a game the teacher is in the
        # middle of running until the moment it ended.
        self.archive('LIVE', self.course, status=GameRoom.STATUS_WAITING)
        self.assertEqual([g['status'] for g in self.get().json()['games']], ['waiting'])

    def test_the_results_payload_reaches_the_client_untouched(self):
        # It is handed straight to ActivityResultsView, which already renders
        # the Recent Activity shape.
        payload = {'mode': 'classic', 'roomCode': 'PAID', 'questionCount': 3,
                   'participants': [{'user_id': 1, 'name': 'pupil', 'score': 900}]}
        self.archive('PAID', self.course, final_payload=payload)
        self.assertEqual(self.get().json()['games'][0]['final_payload'], payload)

    def test_the_serialised_row_carries_what_the_card_renders(self):
        self.archive('SHOW1', self.course, topic='Mitosis', player_count=4,
                     question_count=6, final_payload={'mode': 'classic', 'participants': []})
        game = self.get().json()['games'][0]
        self.assertEqual(game['topic'], 'Mitosis')
        self.assertEqual(game['player_count'], 4)
        self.assertEqual(game['question_count'], 6)
        self.assertEqual(game['host_name'], 'teacher')
        self.assertIsNotNone(game['finished_at'])
        # No rematch on this one, so there is no previous round to offer.
        self.assertIsNone(game['previous_round'])
        self.assertIsNone(game['previous_round_finished_at'])


class MyGamesHistoryTests(TestCase):
    """GET /users/games/mine/ -- every room this user hosted, class or not.

    The per-course endpoint cannot return a course-less room (FAB-hosted
    games archive with course=None), which is the whole reason this exists.
    """

    def setUp(self):
        self.educator = User.objects.create_user(
            username='teacher', password='pass', role='educator')
        self.rival = User.objects.create_user(
            username='rival', password='pass', role='educator')
        self.student = User.objects.create_user(
            username='pupil', password='pass', role='student')
        self.course = Course.objects.create(
            name='Year 9 Biology', educator=self.educator, description='c')
        self.client = APIClient()

    def url(self):
        return reverse('my_games')

    def archive(self, code, owner, course=None, **kwargs):
        defaults = {
            'topic': f'{code} topic',
            'status': GameRoom.STATUS_FINISHED,
            'player_count': 2,
            'finished_at': timezone.now(),
            'host_name': owner.username,
        }
        defaults.update(kwargs)
        return GameRoom.objects.create(
            room_code=code, owner=owner, course=course, **defaults)

    def get(self, user=None):
        self.client.force_authenticate(user=user or self.educator)
        return self.client.get(self.url())

    def test_a_course_less_room_is_listed(self):
        # The point of the endpoint: a FAB-hosted game archives with no class
        # and must still be reachable.
        self.archive('FAB1', self.educator, course=None)
        resp = self.get()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([g['room_code'] for g in resp.json()['games']], ['FAB1'])

    def test_class_and_class_less_rooms_mixed_newest_first(self):
        self.archive('OLDER', self.educator, created_at=timezone.now() - timedelta(days=1))
        self.archive('NEWER', self.educator, course=self.course)
        self.assertEqual([g['room_code'] for g in self.get().json()['games']],
                         ['NEWER', 'OLDER'])

    def test_another_users_rooms_never_leak_in(self):
        self.archive('MINE', self.educator)
        self.archive('THEIRS', self.rival, course=self.course)
        self.assertEqual([g['room_code'] for g in self.get().json()['games']], ['MINE'])

    def test_a_student_only_sees_what_they_hosted(self):
        self.archive('TEACHERS', self.educator, course=self.course)
        self.archive('PUPILS', self.student)
        resp = self.get(user=self.student)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([g['room_code'] for g in resp.json()['games']], ['PUPILS'])

    def test_anonymous_is_rejected(self):
        self.assertEqual(self.client.get(self.url()).status_code, 401)

    def test_no_games_is_an_empty_list_not_an_error(self):
        resp = self.get()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['games'], [])

    def test_the_row_says_which_class_it_belonged_to(self):
        # The all-games list needs the class label; the per-course list gained
        # the same two fields so both feed one card shape.
        self.archive('IN', self.educator, course=self.course)
        self.archive('LOOSE', self.educator, course=None)
        games = {g['room_code']: g for g in self.get().json()['games']}
        self.assertEqual(games['IN']['course_id'], self.course.id)
        self.assertEqual(games['IN']['course_name'], 'Year 9 Biology')
        self.assertIsNone(games['LOOSE']['course_id'])
        self.assertIsNone(games['LOOSE']['course_name'])

    def test_the_results_payload_reaches_the_client_untouched(self):
        payload = {'mode': 'classic', 'roomCode': 'PAID', 'questionCount': 3,
                   'participants': [{'user_id': 1, 'name': 'pupil', 'score': 900}]}
        self.archive('PAID', self.educator, final_payload=payload)
        self.assertEqual(self.get().json()['games'][0]['final_payload'], payload)