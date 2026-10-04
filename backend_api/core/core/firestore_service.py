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
        # Derived, never read from `members` by the client: the group card in the
        # app renders `members_count`, so it has to exist on write.
        'members_count': 1,
        'privacy': 'open',          # 'open' = code joins instantly, 'private' = admin approval
        'join_requests': [],        # firebase uids waiting for admin approval
        'created_at': firestore.SERVER_TIMESTAMP,
    })
    return group_ref[1].id


def _with_members_count(group: dict) -> dict:
    """Backfill `members_count` on docs written before it was tracked.

    Older group documents predate the field, and the app renders it directly.
    Deriving it from `members` on read keeps those groups from displaying
    "undefined members" without needing a migration over the collection.
    """
    if not group.get('members_count'):
        members = group.get('members') or []
        group['members_count'] = len(members)
    return group


def join_group_by_code(firebase_uid: str, join_code: str):
    db = get_db()
    groups = db.collection('studyGroups').where('join_code', '==', join_code).limit(1).stream()
    for group in groups:
        data = group.to_dict() or {}
        members = data.get('members') or []
        if firebase_uid in members:
            return _with_members_count({'id': group.id, **data, 'status': 'joined'})
        if data.get('privacy') == 'private':
            group.reference.update({'join_requests': firestore.ArrayUnion([firebase_uid])})
            return _with_members_count({'id': group.id, **data, 'status': 'pending'})
        group.reference.update({
            'members': firestore.ArrayUnion([firebase_uid]),
            'members_count': len(members) + 1,
        })
        return _with_members_count({'id': group.id, **data, 'status': 'joined'})
    return None


def get_user_groups(firebase_uid: str) -> list:
    db = get_db()
    docs = db.collection('studyGroups').where('members', 'array_contains', firebase_uid).stream()
    return [_with_members_count({'id': d.id, **d.to_dict()}) for d in docs]


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


# ── CLASS CHAT (a study group owned by a course) ───────────────────
#
# A class chat is a normal `studyGroups` document so it reuses the existing
# chat screen, attachments, reactions and Firestore rules. What makes it
# different is who decides membership: `firestore.rules` only lets a user read
# a group (and its messages) when their uid is in `resource.data.members`, so
# the class roster has to be mirrored into that array or students would be
# locked out of their own class chat.
#
# The Django roster is the single source of truth and only ever flows one way
# (Django -> Firestore). Students cannot add or remove themselves from a class
# chat, so the two copies cannot disagree.

def create_course_chat_group(educator_uid: str, course_id: int, course_name: str,
                             member_uids: list) -> str:
    """Create the class chat for a course and return its Firestore doc id.

    `privacy` is 'private' on purpose: members come from the roster, not from
    someone happening to know a join code, so the group is never advertised in
    code-join lookups.
    """
    db = get_db()
    members = [uid for uid in dict.fromkeys(member_uids) if uid]
    group_ref = db.collection('studyGroups').add({
        'name': f"{course_name} — Class Chat",
        'description': 'Class discussion for this course.',
        'join_code': generate_join_code(),
        'created_by': educator_uid,
        'members': members,
        'privacy': 'private',
        'join_requests': [],
        'course_id': course_id,
        'is_course_chat': True,
        'created_at': firestore.SERVER_TIMESTAMP,
    })
    return group_ref[1].id


def sync_course_chat_members(group_id: str, member_uids: list) -> bool:
    """Make the group's member list exactly `member_uids`.

    Replaces rather than adds, so removing a student from a course also revokes
    their access to the class chat -- Firestore rules re-check `members` on
    every read, which is what makes the removal actually take effect.
    """
    db = get_db()
    ref = db.collection('studyGroups').document(group_id)
    if not ref.get().exists:
        return False
    members = [uid for uid in dict.fromkeys(member_uids) if uid]
    ref.update({
        'members': members,
        'members_count': len(members),
    })
    return True


def add_group_members(group_id: str, uids: list) -> bool:
    """Add uids to a group without disturbing the existing member list.

    Used when a course gains a student, where a full replace would mean
    re-reading and rewriting the whole roster just to append one uid.
    """
    new_uids = [uid for uid in dict.fromkeys(uids) if uid]
    if not new_uids:
        return False
    db = get_db()
    ref = db.collection('studyGroups').document(group_id)
    doc = ref.get()
    if not doc.exists:
        return False
    existing = set(doc.to_dict().get('members') or [])
    additions = [uid for uid in new_uids if uid not in existing]
    if not additions:
        return True
    ref.update({
        'members': firestore.ArrayUnion(additions),
        'members_count': len(existing) + len(additions),
    })
    return True


def remove_group_member_uid(group_id: str, firebase_uid: str) -> bool:
    """Drop one uid from a group and keep `members_count` in step."""
    if not firebase_uid:
        return False
    db = get_db()
    ref = db.collection('studyGroups').document(group_id)
    doc = ref.get()
    if not doc.exists:
        return False
    existing = doc.to_dict().get('members') or []
    if firebase_uid not in existing:
        return False
    remaining = [uid for uid in existing if uid != firebase_uid]
    ref.update({
        'members': remaining,
        'members_count': len(remaining),
    })
    return True


def delete_course_chat_group(group_id: str) -> bool:
    """Remove a course's class chat along with its messages.

    Messages live in a subcollection, and Firestore does not cascade deletes,
    so they have to be enumerated and removed explicitly.
    """
    db = get_db()
    ref = db.collection('studyGroups').document(group_id)
    if not ref.get().exists:
        return False
    messages = ref.collection('messages')
    for doc in messages.stream():
        doc.reference.delete()
    ref.delete()
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


def send_message(group_id: str, sender_uid: str, text: str, sender_name: str = '', sender_avatar: str = '', attachments=None, quiz_embed=None) -> str:
    db = get_db()
    payload = {
        'sender_uid': sender_uid,
        'sender_name': sender_name,
        'sender_avatar': sender_avatar,
        'text': text,
        'attachments': attachments or [],
        'reactions': {},
        'created_at': firestore.SERVER_TIMESTAMP,
        'is_synced': True,
    }
    # Only write the field when there is one: older readers do a
    # `data.get('quiz_embed')` and a missing key is cheaper than an empty
    # dict on the thousands of plain messages already stored.
    if quiz_embed:
        payload['quiz_embed'] = quiz_embed
    msg_ref = db.collection('studyGroups').document(group_id).collection('messages').add(payload)
    return msg_ref[1].id


def get_messages(group_id: str, limit: int = 50, resolve_users: callable = None) -> list:
    db = get_db()
    # Order DESCENDING and take the newest `limit`, then reverse back to
    # ascending. Ordering ascending and applying .limit() first returned the 50
    # OLDEST messages in the group, so once a group passed 50 messages a freshly
    # shared quiz never appeared in this payload at all -- and the mobile
    # Firestore listener that supplements this fetch is unbounded, so the two
    # paths disagreed about which messages existed.
    docs = (db.collection('studyGroups').document(group_id)
            .collection('messages')
            # Pass the direction as a string. google-cloud-firestore defines
            # ASCENDING/DESCENDING as plain strings in
            # google.cloud.firestore_v1.base_query and does not re-export them
            # from the google.cloud.firestore namespace, so `firestore.DESCENDING`
            # raises AttributeError -- and order_by() here is a Firestore call,
            # not the Django ORM's -field-name form.
            .order_by('created_at', direction='DESCENDING')
            .limit(limit)
            .stream())
    messages = []
    for d in reversed(list(docs)):
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
            'quiz_embed': data.get('quiz_embed') or {},
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


