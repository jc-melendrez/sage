import firebase_admin
from firebase_admin import credentials, firestore, auth
import os
from django.conf import settings

_db = None

def initialize_firebase():
    """Initialize Firebase Admin SDK if not already done."""
    if not firebase_admin._apps:
        try:
            cred_path = getattr(settings, 'FIREBASE_CREDENTIALS_PATH', None)
            if cred_path and os.path.exists(cred_path):
                cred = credentials.Certificate(cred_path)
                firebase_admin.initialize_app(cred)
            else:
                # Fallback for environments without a local key file (e.g., production)
                firebase_admin.initialize_app()
        except Exception as e:
            print(f"[Firebase Init Error] {e}")

def get_firestore():
    global _db
    if _db is None:
        initialize_firebase()
        _db = firestore.client()
    return _db

def verify_firebase_token(id_token):
    """Verify a Firebase ID token and return the decoded payload."""
    try:
        initialize_firebase()
        decoded_token = auth.verify_id_token(id_token)
        return decoded_token
    except Exception as e:
        print(f"[Firebase Token Verification Error] {e}")
        return None