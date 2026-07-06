from firebase_admin import firestore
import random, string

def get_db():
    return firestore.client()


# ── USER PROFILE ────────────────────────────────────────────────

def create_user_profile(firebase_uid: str, data: dict):
    db = get_db()
    user_ref = db.collection('users').document(firebase_uid)
    user_ref.set({
        'firebase_uid': firebase_uid,
        'username': data.get('username', ''),
        'email': data.get('email', ''),
        'first_name': data.get('first_name', ''),
        'last_name': data.get('last_name', ''),
        'is_student': data.get('is_student', True),
        'is_educator': data.get('is_educator', False),
        'is_admin': data.get('is_admin', False),
        'level': 1,
        'current_xp': 0,
        'total_points': 0,
        'streak': 0,
        'courses_completed': 0,
        'study_hours': 0.0,
        'quizzes_taken': 0,
        'group_activities_count': 0,
        'created_at': firestore.SERVER_TIMESTAMP,
    })

def generate_join_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

def get_user_profile(firebase_uid: str):
    db = get_db()
    doc = db.collection('users').document(firebase_uid).get()
    return doc.to_dict() if doc.exists else None


def update_user_profile(firebase_uid: str, updates: dict):
    db = get_db()
    db.collection('users').document(firebase_uid).update(updates)


def add_xp(firebase_uid: str, amount: int):
    db = get_db()
    user_ref = db.collection('users').document(firebase_uid)

    @firestore.transactional
    def update_in_transaction(transaction, user_ref):
        snapshot = user_ref.get(transaction=transaction)
        data = snapshot.to_dict()
        current_xp = data.get('current_xp', 0) + amount
        total_points = data.get('total_points', 0) + amount
        level = data.get('level', 1)

        next_level_xp = level * 1000
        while current_xp >= next_level_xp:
            level += 1
            current_xp -= next_level_xp
            next_level_xp = level * 1000

        transaction.update(user_ref, {
            'current_xp': current_xp,
            'total_points': total_points,
            'level': level,
        })

    transaction = db.transaction()
    update_in_transaction(transaction, user_ref)


# ── BADGES ───────────────────────────────────────────────────────

def award_badge(firebase_uid: str, icon: str, name: str):
    db = get_db()
    badges_ref = db.collection('users').document(firebase_uid).collection('badges')
    badges_ref.add({
        'icon': icon,
        'name': name,
        'earned_at': firestore.SERVER_TIMESTAMP,
    })


def get_badges(firebase_uid: str) -> list:
    db = get_db()
    docs = db.collection('users').document(firebase_uid).collection('badges').stream()
    return [{'id': d.id, **d.to_dict()} for d in docs]


# ── STUDY GROUPS ─────────────────────────────────────────────────

def create_study_group(firebase_uid: str, name: str, description: str, join_code: str) -> str:
    db = get_db()
    group_ref = db.collection('studyGroups').add({
        'name': name,
        'description': description,
        'join_code': join_code,
        'created_by': firebase_uid,
        'members': [firebase_uid],
        'created_at': firestore.SERVER_TIMESTAMP,
    })
    return group_ref[1].id


def join_group_by_code(firebase_uid: str, join_code: str):
    db = get_db()
    groups = db.collection('studyGroups').where('join_code', '==', join_code).limit(1).stream()
    for group in groups:
        group.reference.update({'members': firestore.ArrayUnion([firebase_uid])})
        return {'id': group.id, **group.to_dict()}
    return None


def get_user_groups(firebase_uid: str) -> list:
    db = get_db()
    docs = db.collection('studyGroups').where('members', 'array_contains', firebase_uid).stream()
    return [{'id': d.id, **d.to_dict()} for d in docs]


# ── GROUP MESSAGES ───────────────────────────────────────────────

def send_message(group_id: str, sender_uid: str, text: str) -> str:
    db = get_db()
    msg_ref = db.collection('studyGroups').document(group_id).collection('messages').add({
        'sender_uid': sender_uid,
        'text': text,
        'created_at': firestore.SERVER_TIMESTAMP,
        'is_synced': True,
    })
    return msg_ref[1].id


def get_messages(group_id: str, limit: int = 50) -> list:
    db = get_db()
    docs = (db.collection('studyGroups').document(group_id)
            .collection('messages')
            .order_by('created_at')
            .limit(limit)
            .stream())
    return [{'id': d.id, **d.to_dict()} for d in docs]


# ── QUIZ ─────────────────────────────────────────────────────────

def save_quiz(firebase_uid: str, content: dict, quiz_type: str, group_id: str = None) -> str:
    db = get_db()
    doc_ref = db.collection('quizzes').add({
        'created_by': firebase_uid,
        'content': content,
        'quiz_type': quiz_type,
        'group_id': group_id,
        'created_at': firestore.SERVER_TIMESTAMP,
    })
    return doc_ref[1].id


def get_quiz(quiz_id: str):
    db = get_db()
    doc = db.collection('quizzes').document(quiz_id).get()
    return {'id': doc.id, **doc.to_dict()} if doc.exists else None
