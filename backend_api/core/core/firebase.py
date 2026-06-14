import firebase_admin
from firebase_admin import credentials, firestore
import os

_db = None

def get_firestore():
    global _db
    if _db is None:
        if not firebase_admin._apps:
            cred_path = os.path.join(os.path.dirname(__file__), '..', 'serviceAccountKey.json')
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
        _db = firestore.client()
    return _db