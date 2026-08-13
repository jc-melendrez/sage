from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase, APIClient

from .models import Course

User = get_user_model()


class CourseAPITests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='teacher', password='pass123', is_educator=True, is_student=False,
            first_name='Ada', last_name='Lovelace',
        )
        self.student1 = User.objects.create_user(
            username='student1', password='pass123', is_student=True, is_educator=False,
            first_name='Lin', last_name='Torvalds',
        )
        self.student2 = User.objects.create_user(
            username='student2', password='pass123', is_student=True, is_educator=False,
        )
        self.client.force_authenticate(user=self.educator)

    def test_create_course(self):
        resp = self.client.post(reverse('create_course'), {'name': 'Algebra I', 'description': 'Intro'})
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(Course.objects.count(), 1)
        course = Course.objects.get()
        self.assertEqual(course.educator, self.educator)
        self.assertTrue(course.join_code)

    def test_non_educator_cannot_create_course(self):
        self.client.force_authenticate(user=self.student1)
        resp = self.client.post(reverse('create_course'), {'name': 'Hack'})
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(Course.objects.count(), 0)

    def test_join_by_code(self):
        course = Course.objects.create(name='Biology', educator=self.educator)
        self.client.force_authenticate(user=self.student1)
        resp = self.client.post(reverse('join_course'), {'join_code': course.join_code})
        self.assertEqual(resp.status_code, 200)
        self.assertIn(self.student1, course.students.all())

    def test_join_by_code_is_idempotent(self):
        course = Course.objects.create(name='Biology', educator=self.educator)
        course.students.add(self.student1)
        self.client.force_authenticate(user=self.student1)
        resp = self.client.post(reverse('join_course'), {'join_code': course.join_code})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(course.students.count(), 1)

    def test_join_invalid_code(self):
        self.client.force_authenticate(user=self.student1)
        resp = self.client.post(reverse('join_course'), {'join_code': 'NOPE99'})
        self.assertEqual(resp.status_code, 404)

    def test_educator_adds_student(self):
        course = Course.objects.create(name='Physics', educator=self.educator)
        resp = self.client.post(
            reverse('course_add_student', args=[course.id]),
            {'user_id': self.student1.id},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn(self.student1, course.students.all())

    def test_educator_removes_student(self):
        course = Course.objects.create(name='Physics', educator=self.educator)
        course.students.add(self.student1)
        resp = self.client.post(
            reverse('course_remove_student', args=[course.id]),
            {'user_id': self.student1.id},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn(self.student1, course.students.all())

    def test_non_educator_cannot_modify_roster(self):
        course = Course.objects.create(name='Physics', educator=self.educator)
        self.client.force_authenticate(user=self.student1)
        resp = self.client.post(
            reverse('course_add_student', args=[course.id]),
            {'user_id': self.student2.id},
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(course.students.count(), 0)

    def test_courses_have_independent_rosters(self):
        c1 = Course.objects.create(name='Math', educator=self.educator)
        c2 = Course.objects.create(name='Art', educator=self.educator)
        c1.students.add(self.student1)
        c2.students.add(self.student2)

        resp = self.client.get(reverse('my_courses'))
        self.assertEqual(resp.status_code, 200)
        by_name = {c['name']: c for c in resp.data}
        self.assertEqual(by_name['Math']['student_count'], 1)
        self.assertEqual(by_name['Math']['students'][0]['username'], 'student1')
        self.assertEqual(by_name['Art']['student_count'], 1)
        self.assertEqual(by_name['Art']['students'][0]['username'], 'student2')

    def test_enrolled_courses_for_student(self):
        c1 = Course.objects.create(name='Math', educator=self.educator)
        c2 = Course.objects.create(name='Art', educator=self.educator)
        c1.students.add(self.student1)
        c2.students.add(self.student1)

        self.client.force_authenticate(user=self.student1)
        resp = self.client.get(reverse('enrolled_courses'))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 2)

    def test_course_detail_roster_access(self):
        course = Course.objects.create(name='Math', educator=self.educator)
        course.students.add(self.student1)

        self.client.force_authenticate(user=self.student1)
        resp = self.client.get(reverse('course_detail', args=[course.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['student_count'], 1)

    def test_non_member_cannot_view_course(self):
        course = Course.objects.create(name='Math', educator=self.educator)
        self.client.force_authenticate(user=self.student2)
        resp = self.client.get(reverse('course_detail', args=[course.id]))
        self.assertEqual(resp.status_code, 403)
