"""In-memory stand-in for google-cloud-firestore, used by core.game tests.

Duck-types just enough of the sync client API used by core.game.views:

- ``client.collection(name)`` -> FakeCollectionReference
- ``collection.document(doc_id)`` -> FakeDocumentReference
- ``document.set(data, merge=False)`` / ``document.get()`` /
  ``document.update(updates)`` / ``document.delete()``
- ``collection.stream()`` -> list of FakeDocumentSnapshot
- ``client.transaction()`` -> FakeTransaction
- ``FakeDocumentSnapshot`` exposes ``.id``, ``.exists``, ``.to_dict()``,
  ``.reference``

It also honours the real ``@fs.transactional`` decorator from
google.cloud.firestore, which requires the transaction object to expose
``_read_only``, ``_max_attempts``, ``_clean_up()``, ``_begin(retry_id=...)``,
``_id``, ``_commit()`` and ``_rollback()``.

Transforms are resolved eagerly on write: ``Increment`` adds to the existing
value, ``ArrayUnion`` appends non-duplicate members, and ``SERVER_TIMESTAMP``
becomes a sentinel object.
"""

from google.cloud.firestore_v1 import transforms as fs_transforms


class FakeStoreError(Exception):
    """Raised when a document update targets a non-existent document."""


class FakeDocumentSnapshot:
    def __init__(self, path, data, store=None):
        self._path = path
        self._data = data
        self._store = store
        self.id = path[-1] if path else None

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        if self._data is None:
            return None
        return dict(self._data)

    @property
    def reference(self):
        return FakeDocumentReference(self._store, self._path)

    def __repr__(self):
        return f'<FakeDocumentSnapshot id={self.id!r} exists={self.exists}>'


class FakeStore:
    """Dict-backed document store. Paths are alternating segment tuples,
    e.g. ('gameRooms', 'ABC123', 'players', '7')."""

    def __init__(self):
        self._docs = {}

    def set(self, path, data, merge=False):
        if merge and path in self._docs:
            self._apply(self._docs[path], dict(data))
            return
        self._docs[path] = dict(data)

    def get(self, path):
        if path not in self._docs:
            return self._snapshot(path, None)
        return self._snapshot(path, dict(self._docs[path]))

    def update(self, path, updates):
        if path not in self._docs:
            raise FakeStoreError(f'Document {path} does not exist')
        self._apply(self._docs[path], dict(updates))

    def delete(self, path):
        self._docs.pop(path, None)

    def stream(self, collection_path):
        prefix = collection_path
        return [
            self._snapshot(p, dict(d))
            for p, d in self._docs.items()
            if len(p) == len(prefix) + 1 and p[: len(prefix)] == prefix
        ]

    def _snapshot(self, path, data):
        return FakeDocumentSnapshot(path, data, self)

    @staticmethod
    def _apply(doc, updates):
        for key, value in updates.items():
            if '.' in key:
                parts = key.split('.')
                target = doc
                for part in parts[:-1]:
                    target = target.setdefault(part, {})
                target[parts[-1]] = FakeStore._resolve(
                    target.get(parts[-1]), value
                )
            else:
                doc[key] = FakeStore._resolve(doc.get(key), value)

    @staticmethod
    def _resolve(existing, value):
        if isinstance(value, fs_transforms.Increment):
            return (existing or 0) + value.value
        if isinstance(value, fs_transforms.ArrayUnion):
            current = list(existing or [])
            for item in value.values:
                if item not in current:
                    current.append(item)
            return current
        if value is fs_transforms.SERVER_TIMESTAMP:
            return value
        return value


class FakeDocumentReference:
    def __init__(self, store, path):
        self._store = store
        self._path = path
        self.id = path[-1] if path else None

    def collection(self, name):
        return FakeCollectionReference(self._store, self._path + (name,))

    def set(self, data, merge=False):
        self._store.set(self._path, data, merge)

    def get(self, transaction=None):
        return self._store.get(self._path)

    def update(self, updates):
        self._store.update(self._path, updates)

    def delete(self):
        self._store.delete(self._path)


class FakeCollectionReference:
    def __init__(self, store, path):
        self._store = store
        self._path = path
        self.id = path[-1] if path else None

    def document(self, doc_id):
        return FakeDocumentReference(self._store, self._path + (doc_id,))

    def stream(self, transaction=None):
        return self._store.stream(self._path)


class FakeTransaction:
    """Minimal duck-typed transaction satisfying fs.transactional."""

    def __init__(self, store):
        self._store = store
        self._read_only = False
        self._max_attempts = 1
        self._id = None

    def _clean_up(self):
        pass

    def _begin(self, retry_id=None):
        self._id = retry_id or 'fake-txn-id'

    def _commit(self):
        pass

    def _rollback(self):
        pass

    def get(self, ref):
        return ref._store.get(ref._path)

    def update(self, ref, updates):
        ref._store.update(ref._path, updates)

    def set(self, ref, data, merge=False):
        ref._store.set(ref._path, data, merge)


class FakeFirestoreClient:
    def __init__(self, store=None):
        self._store = store or FakeStore()

    def collection(self, name):
        return FakeCollectionReference(self._store, (name,))

    def transaction(self):
        return FakeTransaction(self._store)
