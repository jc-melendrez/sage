"""Smoke test for the Teams-like task flow. Run with:
    python manage.py test test_tasks
"""
import json
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.test.client import BOUNDARY, MULTIPART_CONTENT, encode_multipart
from django.utils import timezone

from users.authentication import SAGERefreshToken
from users.models import ClassActivity, Course, TaskSubmission, TaskSubmissionFile, User


def auth(user):
    token = SAGERefreshToken.for_user(user).access_token
    return {'HTTP_AUTHORIZATION': 'Bearer %s' % token}


def upload(name, body=b'x'):
    return SimpleUploadedFile(name, body)


class TaskFlowTest(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user('teacher', password='x', role='educator')
        self.alice = User.objects.create_user('alice', password='x')
        self.bob = User.objects.create_user('bob', password='x')
        self.course = Course.objects.create(name='Bio 101', educator=self.teacher)
        self.course.students.add(self.alice, self.bob)
        self.due = timezone.now() + timedelta(days=2)

    def make_task(self, **kwargs):
        defaults = dict(course=self.course, kind='task', title='Lab report',
                        note='Write it up.', due_date=self.due, max_points=50,
                        status='published')
        defaults.update(kwargs)
        return ClassActivity.objects.create(**defaults)

    def post_files(self, url, files, user, **extra):
        payload = {'file': files}
        payload.update(extra)
        return self.client.post(url, data=payload, content_type=MULTIPART_CONTENT, **auth(user))

    def patch_files(self, url, payload, user):
        # The test client only auto-encodes multipart for post(), so PATCH
        # bodies have to be encoded by hand.
        body = encode_multipart(BOUNDARY, payload)
        return self.client.patch(url, data=body, content_type=MULTIPART_CONTENT, **auth(user))

    def test_educator_creates_task_with_materials(self):
        res = self.client.post(
            '/api/users/courses/%d/activities/' % self.course.id,
            data={'kind': 'task', 'title': 'Lab report', 'note': 'Write it up.',
                  'due_date': self.due.isoformat(), 'max_points': 50,
                  'status': 'published', 'allow_multiple_files': 'true',
                  'attachments': [upload('worksheet.pdf', b'%PDF-1.4 fake')]},
            content_type=MULTIPART_CONTENT, **auth(self.teacher))
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertEqual(body['max_points'], 50)
        self.assertTrue(body['allow_multiple_files'])
        self.assertEqual(len(body['attachments']), 1)
        # due_date now round-trips as a full datetime, not a bare date
        self.assertIn('T', body['due_date'])

    def test_educator_edits_task(self):
        task = self.make_task()
        res = self.client.patch(
            '/api/users/activities/%d/' % task.id,
            data=json.dumps({'title': 'Lab report v2', 'max_points': 75}),
            content_type='application/json', **auth(self.teacher))
        self.assertEqual(res.status_code, 200, res.content)
        task.refresh_from_db()
        self.assertEqual(task.title, 'Lab report v2')
        self.assertEqual(task.max_points, 75)

    def test_educator_appends_material_on_edit(self):
        task = self.make_task()
        res = self.patch_files('/api/users/activities/%d/' % task.id,
                               {'attachments': [upload('notes.pdf', b'nnn')]}, self.teacher)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(len(res.json()['attachments']), 1)
        self.assertEqual(res.json()['attachments'][0]['file_size'], 3)

    def test_student_submits_multiple_files(self):
        task = self.make_task()
        res = self.post_files(
            '/api/users/tasks/%d/submit/' % task.id,
            [upload('report.docx', b'one'), upload('data.csv', b'two')],
            self.alice, description='Not sure about Q3')
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertEqual(len(body['files']), 2)
        self.assertEqual(body['description'], 'Not sure about Q3')
        self.assertFalse(body['is_late'])

        # A second call extends the same turn-in instead of replacing it.
        res = self.post_files('/api/users/tasks/%d/submit/' % task.id,
                              [upload('appendix.png', b'three')], self.alice)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(len(res.json()['files']), 3)
        self.assertEqual(TaskSubmissionFile.objects.count(), 3)
        self.assertEqual(TaskSubmission.objects.count(), 1)

    def test_late_flag(self):
        task = self.make_task(due_date=timezone.now() - timedelta(hours=1))
        res = self.post_files('/api/users/tasks/%d/submit/' % task.id,
                              [upload('late.pdf')], self.alice)
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(res.json()['is_late'])

    def test_single_file_task_rejects_second_file(self):
        task = self.make_task(allow_multiple_files=False)
        url = '/api/users/tasks/%d/submit/' % task.id
        res = self.post_files(url, [upload('a.pdf')], self.alice)
        self.assertEqual(res.status_code, 201, res.content)
        res = self.post_files(url, [upload('b.pdf')], self.alice)
        self.assertEqual(res.status_code, 400, res.content)

    def test_student_can_fetch_and_delete_own_file(self):
        task = self.make_task()
        self.post_files('/api/users/tasks/%d/submit/' % task.id,
                        [upload('a.pdf', b'hello'), upload('b.pdf', b'bye')], self.alice)
        file_id = TaskSubmissionFile.objects.first().id
        url = '/api/users/tasks/%d/submissions/files/%d/' % (task.id, file_id)

        res = self.client.get(url, **auth(self.alice))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['file_size'], 5)
        self.assertEqual(res.json()['file_data'], 'aGVsbG8=')

        # Bob cannot read Alice's file.
        self.assertEqual(self.client.get(url, **auth(self.bob)).status_code, 403)

        res = self.client.delete(url, **auth(self.alice))
        self.assertEqual(res.status_code, 204)
        self.assertEqual(TaskSubmissionFile.objects.count(), 1)
        # The turn-in survives while any file remains.
        self.assertEqual(TaskSubmission.objects.count(), 1)

        # Removing the last file clears the whole turn-in.
        last = TaskSubmissionFile.objects.first().id
        self.client.delete('/api/users/tasks/%d/submissions/files/%d/' % (task.id, last),
                           **auth(self.alice))
        self.assertEqual(TaskSubmission.objects.count(), 0)

    def test_drafts_hidden_from_students(self):
        draft = self.make_task(title='Secret plan', status='draft')
        self.make_task(title='Visible work')

        res = self.client.get('/api/users/courses/%d/activities/' % self.course.id, **auth(self.alice))
        self.assertEqual(res.status_code, 200)
        self.assertEqual([a['title'] for a in res.json()], ['Visible work'])

        # The educator still sees both.
        res = self.client.get('/api/users/activities/', **auth(self.teacher))
        self.assertEqual(len(res.json()), 2)

        # A student cannot reach a draft by guessing its id.
        res = self.client.get('/api/users/tasks/%d/submit/' % draft.id, **auth(self.alice))
        self.assertEqual(res.status_code, 404)

    def test_grading_and_ungrading(self):
        task = self.make_task()
        self.post_files('/api/users/tasks/%d/submit/' % task.id, [upload('a.pdf')], self.alice)
        sub = TaskSubmission.objects.get()
        url = '/api/users/tasks/%d/submissions/%d/grade/' % (task.id, sub.id)

        res = self.client.patch(url, data=json.dumps({'score': 45, 'feedback': 'Nice work'}),
                                content_type='application/json', **auth(self.teacher))
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['score'], 45)
        self.assertIsNotNone(res.json()['graded_at'])

        res = self.client.patch(url, data=json.dumps({'score': 999}),
                                content_type='application/json', **auth(self.teacher))
        self.assertEqual(res.status_code, 400)

        res = self.client.patch(url, data=json.dumps({'score': None, 'feedback': ''}),
                                content_type='application/json', **auth(self.teacher))
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNone(res.json()['score'])
        self.assertIsNone(res.json()['graded_at'])

    def test_educator_deletes_material(self):
        task = self.make_task()
        res = self.patch_files('/api/users/activities/%d/' % task.id,
                               {'attachments': [upload('notes.pdf', b'n')]}, self.teacher)
        self.assertEqual(res.status_code, 200, res.content)
        att_id = res.json()['attachments'][0]['id']
        url = '/api/users/tasks/%d/attachments/%d/' % (task.id, att_id)

        # Students can read materials but not remove them.
        self.assertEqual(self.client.get(url, **auth(self.alice)).status_code, 200)
        self.assertEqual(self.client.delete(url, **auth(self.alice)).status_code, 403)

        res = self.client.delete(url, **auth(self.teacher))
        self.assertEqual(res.status_code, 204)
        self.assertEqual(task.attachments.count(), 0)

    def test_max_points_validation(self):
        res = self.client.post('/api/users/courses/%d/activities/' % self.course.id,
                               data=json.dumps({'kind': 'task', 'title': 'X', 'max_points': 0}),
                               content_type='application/json', **auth(self.teacher))
        self.assertEqual(res.status_code, 400)

    def test_blank_multipart_clears_optional_fields(self):
        """A multipart edit can only send strings, so a blank value means null.

        Without this, adding a material while also removing the deadline would
        silently keep the old deadline, because omitting the key skips it.
        """
        task = self.make_task(ref_id=7)
        res = self.patch_files('/api/users/activities/%d/' % task.id, {
            'due_date': '',
            'ref_id': '',
            'attachments': [upload('notes.pdf', b'n')],
        }, self.teacher)
        self.assertEqual(res.status_code, 200, res.content)
        task.refresh_from_db()
        self.assertIsNone(task.due_date)
        self.assertIsNone(task.ref_id)
        self.assertEqual(task.attachments.count(), 1)
