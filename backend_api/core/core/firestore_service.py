from firebase_admin import firestore
from core.firebase import initialize_firebase
from core.s3 import upload_to_s3, get_attachment_key
import random, string
from datetime import datetime

def get_db():
    initialize_firebase()
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
        'role': data.get('role', 'student'),
        'is_student': data.get('is_student', True),
        'is_educator': data.get('is_educator', False),
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
        'privacy': 'open',          # 'open' = code joins instantly, 'private' = admin approval
        'join_requests': [],        # firebase uids waiting for admin approval
        'created_at': firestore.SERVER_TIMESTAMP,
    })
    return group_ref[1].id


def join_group_by_code(firebase_uid: str, join_code: str):
    db = get_db()
    groups = db.collection('studyGroups').where('join_code', '==', join_code).limit(1).stream()
    for group in groups:
        data = group.to_dict() or {}
        members = data.get('members') or []
        if firebase_uid in members:
            return {'id': group.id, **data, 'status': 'joined'}
        if data.get('privacy') == 'private':
            group.reference.update({'join_requests': firestore.ArrayUnion([firebase_uid])})
            return {'id': group.id, **data, 'status': 'pending'}
        group.reference.update({'members': firestore.ArrayUnion([firebase_uid])})
        return {'id': group.id, **data, 'status': 'joined'}
    return None


def get_user_groups(firebase_uid: str) -> list:
    db = get_db()
    docs = db.collection('studyGroups').where('members', 'array_contains', firebase_uid).stream()
    return [{'id': d.id, **d.to_dict()} for d in docs]


def get_study_group(group_id: str) -> dict | None:
    db = get_db()
    doc = db.collection('studyGroups').document(group_id).get()
    return {'id': doc.id, **doc.to_dict()} if doc.exists else None


def update_study_group(group_id: str, updates: dict) -> bool:
    db = get_db()
    ref = db.collection('studyGroups').document(group_id)
    if not ref.get().exists:
        return False
    ref.update(updates)
    return True


def leave_study_group(group_id: str, firebase_uid: str) -> bool:
    """Remove a user from the group. Deletes the group when the last member leaves."""
    db = get_db()
    ref = db.collection('studyGroups').document(group_id)
    doc = ref.get()
    if not doc.exists:
        return False
    members = doc.to_dict().get('members') or []
    if firebase_uid not in members:
        return False
    if len(members) <= 1:
        ref.delete()
    else:
        ref.update({'members': firestore.ArrayRemove([firebase_uid])})
    return True


def remove_group_member(group_id: str, target_uid: str) -> bool:
    """Admin action: remove a member. The group creator can never be removed."""
    db = get_db()
    ref = db.collection('studyGroups').document(group_id)
    doc = ref.get()
    if not doc.exists:
        return False
    data = doc.to_dict() or {}
    members = data.get('members') or []
    if data.get('created_by') == target_uid or target_uid not in members:
        return False
    if len(members) <= 1:
        ref.delete()
    else:
        ref.update({'members': firestore.ArrayRemove([target_uid])})
    return True


def approve_join_request(group_id: str, firebase_uid: str) -> bool:
    """Move a pending requester into the member list."""
    db = get_db()
    ref = db.collection('studyGroups').document(group_id)
    doc = ref.get()
    if not doc.exists:
        return False
    requests = (doc.to_dict() or {}).get('join_requests') or []
    if firebase_uid not in requests:
        return False
    ref.update({
        'join_requests': firestore.ArrayRemove([firebase_uid]),
        'members': firestore.ArrayUnion([firebase_uid]),
    })
    return True


def reject_join_request(group_id: str, firebase_uid: str) -> bool:
    """Drop a pending join request without adding the requester."""
    db = get_db()
    ref = db.collection('studyGroups').document(group_id)
    doc = ref.get()
    if not doc.exists:
        return False
    requests = (doc.to_dict() or {}).get('join_requests') or []
    if firebase_uid not in requests:
        return False
    ref.update({'join_requests': firestore.ArrayRemove([firebase_uid])})
    return True


# ── GROUP MESSAGES ───────────────────────────────────────────────

ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢']

# Chat attachment constraints (mirrors frontend limits).
ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_ATTACHMENT_TYPES = {
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}


def upload_group_attachment(group_id: str, upload, filename: str) -> dict:
    """Stream an uploaded file to the private S3 bucket for a group chat.

    Returns a message-ready attachment dict ({key, name, mime, size}) where
    `key` is the S3 object key. Files are never made public — downloads go
    through GroupAttachmentLinkView, which mints a short-lived presigned URL
    for verified group members. Raises ValueError on an unsupported content
    type."""
    content_type = getattr(upload, 'content_type', '') or 'application/octet-stream'
    if content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise ValueError(
            f"Unsupported file type (content_type required: "
            f"{', '.join(sorted(ALLOWED_ATTACHMENT_TYPES))}). Got: {content_type}"
        )
    object_key = get_attachment_key(group_id, filename)
    upload_to_s3(upload, object_key, content_type)
    return {
        'key': object_key,
        'name': filename,
        'mime': content_type,
        'size': getattr(upload, 'size', 0),
    }


def send_message(group_id: str, sender_uid: str, text: str, sender_name: str = '', sender_avatar: str = '', attachments=None) -> str:
    db = get_db()
    msg_ref = db.collection('studyGroups').document(group_id).collection('messages').add({
        'sender_uid': sender_uid,
        'sender_name': sender_name,
        'sender_avatar': sender_avatar,
        'text': text,
        'attachments': attachments or [],
        'reactions': {},
        'created_at': firestore.SERVER_TIMESTAMP,
        'is_synced': True,
    })
    return msg_ref[1].id


def get_messages(group_id: str, limit: int = 50, resolve_users: callable = None) -> list:
    db = get_db()
    docs = (db.collection('studyGroups').document(group_id)
            .collection('messages')
            .order_by('created_at')
            .limit(limit)
            .stream())
    messages = []
    for d in docs:
        data = d.to_dict() or {}
        # Serialize the Firestore Timestamp to ISO-8601 — raw Timestamp
        # objects are not always JSON-serializable by DRF.
        created_at = data.get('created_at')
        if isinstance(created_at, datetime):
            created_at = created_at.isoformat()
        messages.append({
            'id': d.id,
            'sender_uid': data.get('sender_uid'),
            'sender_name': data.get('sender_name') or 'Member',
            'sender_avatar': data.get('sender_avatar') or '',
            'text': data.get('text'),
            'attachments': data.get('attachments') or [],
            'created_at': created_at,
            'reactions': data.get('reactions') or {},
        })

    # Legacy messages (pre sender_name / sender_avatar) get real data resolved
    # from Django. `resolve_users` maps firebase_uid -> {name, avatar}.
    if resolve_users:
        unknown = {
            m['sender_uid'] for m in messages
            if m['sender_uid'] and (m['sender_name'] == 'Member' or not m['sender_avatar'])
        }
        if unknown:
            user_map = resolve_users(unknown)
            for m in messages:
                info = user_map.get(m['sender_uid'])
                if not info:
                    continue
                if m['sender_name'] == 'Member':
                    m['sender_name'] = info['name']
                if not m['sender_avatar']:
                    m['sender_avatar'] = info['avatar']
    return messages


def get_message_reactions(group_id: str, message_id: str) -> dict | None:
    db = get_db()
    doc = (db.collection('studyGroups').document(group_id)
           .collection('messages').document(message_id).get())
    if not doc.exists:
        return None
    return doc.to_dict().get('reactions') or {}


def toggle_reaction(group_id: str, message_id: str, firebase_uid: str, emoji: str) -> dict:
    """
    Add or remove `firebase_uid`'s reaction of `emoji` on a message.
    Reactions are stored as { emoji: [uid, ...] }; an empty list deletes
    the key. Returns the resulting reactions map.
    """
    reactions = get_message_reactions(group_id, message_id)
    if reactions is None:
        raise LookupError('Message not found')

    db = get_db()
    msg_ref = (db.collection('studyGroups').document(group_id)
               .collection('messages').document(message_id))
    if firebase_uid in (reactions.get(emoji) or []):
        msg_ref.update({f'reactions.{emoji}': firestore.ArrayRemove([firebase_uid])})
        reactions[emoji] = [u for u in reactions[emoji] if u != firebase_uid]
        if not reactions[emoji]:
            del reactions[emoji]
    else:
        msg_ref.update({f'reactions.{emoji}': firestore.ArrayUnion([firebase_uid])})
        reactions[emoji] = (reactions.get(emoji) or []) + [firebase_uid]
    return reactions


