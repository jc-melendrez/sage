import json
import os

import firebase_admin
from firebase_admin import auth, credentials, firestore
from django.conf import settings

_db = None


def initialize_firebase():
    """
    Initialize Firebase Admin SDK if it hasn't already been initialized.

    Priority:
    1. Local credentials file (FIREBASE_CREDENTIALS_PATH)
    2. Railway environment variable (FIREBASE_SERVICE_ACCOUNT)
    """

    if firebase_admin._apps:
        return

    try:
        cred = None

        # Local development
        cred_path = getattr(settings, "FIREBASE_CREDENTIALS_PATH", None)
        if cred_path and os.path.exists(cred_path):
            print("[Firebase] Using local service account file.")
            cred = credentials.Certificate(cred_path)

        # Railway / Production
        elif os.getenv("FIREBASE_SERVICE_ACCOUNT"):
            print("[Firebase] Using FIREBASE_SERVICE_ACCOUNT environment variable.")
            service_account = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT"])
            cred = credentials.Certificate(service_account)

        else:
            raise RuntimeError(
                "Firebase credentials not configured. "
                "Set FIREBASE_CREDENTIALS_PATH locally or "
                "FIREBASE_SERVICE_ACCOUNT on Railway."
            )

        firebase_admin.initialize_app(cred)
        print("[Firebase] Firebase Admin initialized successfully.")

    except Exception as e:
        print(f"[Firebase Init Error] {e}")
        raise


def get_firestore():
    """Return a Firestore client."""
    global _db

    if _db is None:
        initialize_firebase()
        _db = firestore.client()

    return _db


def verify_firebase_token(id_token):
    """
    Verify a Firebase ID token.

    Returns:
        dict: Decoded token if valid.
        None: If verification fails.
    """
    try:
        initialize_firebase()
        decoded_token = auth.verify_id_token(id_token)
        return decoded_token

    except Exception as e:
        print(f"[Firebase Token Verification Error] {e}")
        return None


def create_firebase_user(email, password):
    """
    Create a Firebase Auth account so a Django user can sign in via the mobile app.

    Returns the Firebase UID, or None if creation fails (e.g. offline / duplicate email).
    """
    try:
        initialize_firebase()
        user = auth.create_user(email=email, password=password)
        return user.uid
    except Exception as e:
        print(f"[Firebase] Failed to create Auth user {email}: {e}")
        return None