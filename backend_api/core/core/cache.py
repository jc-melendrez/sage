"""A database-backed cache that degrades instead of taking the API down.

`DatabaseCache` stores its entries in the `django_cache` table, which is
created by `manage.py createcachetable` and by nothing else -- no migration
creates it. Every DRF throttle writes a counter on every request, so a
deployed database missing that table turns *every* endpoint, login included,
into an unhandled `ProgrammingError: relation "django_cache" does not exist`.

That happened once: the Procfile release step was the only thing creating the
table, and anything that skipped it (a failed release phase, a database
rebuilt without re-running it, a release phase without DATABASE_URL so the
table landed in ephemeral SQLite) left the whole API returning 500.

This backend keeps the shared, cross-worker counters DatabaseCache was
introduced for, but treats a missing table as a degradation rather than an
outage: the first failed statement latches an in-process LocMemCache and every
subsequent read and write is served from it. Throttling becomes per-worker
again -- the behaviour from before DatabaseCache -- which is a far better
failure mode than an API that cannot authenticate anybody.

The latch is deliberate. Retrying the table on each request would turn a
permanent schema problem into a stream of exceptions and a slow response on
every call. Re-running `manage.py createcachetable` and restarting the workers
is the actual fix; the fallback exists so that a forgot-to-run-command bug
degrades instead of blacking out the product.

The latch is reported through the `django.request` logger rather than `print`,
so it lands in the same stream as the 500s this replaces and is not swallowed by
stdout buffering.

Note the methods guarded below are the *public* ones, because those are the
signatures LocMemCache shares. The private helpers (`_base_set`,
`_base_delete_many`) still raise if they somehow run against a vanished table
with nothing around them to catch it; every path from the public API reaches
the database through a guarded method.

Caveat: after a failed statement inside a `transaction.atomic` block Django
marks the connection `needs_rollback`, so anything later in the *same*
transaction would fail too. `ATOMIC_REQUESTS` is off, and DRF runs the throttle
outside any atomic block, so this is safe today. If `ATOMIC_REQUESTS` is ever
turned on, the `except DatabaseError` below has to become a real rollback
rather than a swallow.
"""

import logging
import threading

from django.core.cache.backends.db import DatabaseCache
from django.core.cache.backends.locmem import LocMemCache
from django.db import DatabaseError, connections

logger = logging.getLogger('django.request')

# Public methods that issue SQL. LocMemCache implements all of them with the
# same signature, so the fallback is a straight delegation. get_many covers
# get(), and incr()/decr() are built on get() + add(), so nothing escapes.
_SQL_METHODS = (
    'get', 'get_many', 'set', 'add', 'touch',
    'delete', 'delete_many', 'has_key', 'clear',
)

# Django keeps cache instances in an asgiref Local, so every thread in a worker
# gets its own ResilientDatabaseCache. Per-instance state would mean the thread
# that degrades is not the thread that later reports health, and a threaded
# server would answer healthz with a pristine instance -- hiding the very
# failure the endpoint exists to surface. Keyed by table so two differently
# configured caches (tests, override_settings) never share a latch.
_LATCH_LOCK = threading.Lock()
_LATCHES = {}


def _latch_for(table):
    with _LATCH_LOCK:
        return _LATCHES.setdefault(table, {'reason': None, 'fallback': None})


def reset_latch(table=None):
    """Clear degradation state so a test can exercise the degrade path itself.

    The latch is deliberately sticky in a running worker, so this is the only
    way back. Clearing all of it when given no argument is for test teardown.
    """
    with _LATCH_LOCK:
        if table is None:
            _LATCHES.clear()
        else:
            _LATCHES.pop(table, None)


def _degrades_to_fallback(method_name):
    """Wrap a DatabaseCache method so a DatabaseError serves from the fallback."""

    def decorate(method):
        def wrapper(self, *args, **kwargs):
            if self._latch['fallback'] is None:
                try:
                    return method(self, *args, **kwargs)
                except DatabaseError as exc:
                    self._degrade(exc)
            return getattr(self._latch['fallback'], method_name)(*args, **kwargs)

        wrapper.__name__ = method.__name__
        wrapper.__doc__ = method.__doc__
        return wrapper

    return decorate


class ResilientDatabaseCache(DatabaseCache):
    """DatabaseCache that falls back to a per-process cache on DatabaseError."""

    def __init__(self, table, params):
        super().__init__(table, params)
        self._latch = _latch_for(self._table)
        # Same knobs as the real backend, so the fallback behaves comparably
        # rather than silently applying a much smaller ceiling.
        self._fallback_params = {
            'timeout': params.get('timeout', self.default_timeout),
            'max_entries': params.get('max_entries', self._max_entries),
        }

    def _degrade(self, exc):
        """Latch the fallback process-wide and say so once, on the way past."""
        with _LATCH_LOCK:
            if self._latch['fallback'] is not None:
                return
            self._latch['reason'] = str(exc)
            # One LocMemCache per process, shared by every thread, so throttle
            # counters stay consistent within a worker rather than fragmenting
            # per thread. The name is derived from the table so separate
            # configurations stay separate.
            self._latch['fallback'] = LocMemCache(
                f'sage-cache-fallback-{self._table}', self._fallback_params
            )
        logger.error(
            'django_cache is unusable, serving this worker from an in-process '
            'cache until it is restarted. Throttle counters are per-process '
            'again until `manage.py createcachetable` has been run: %s',
            exc,
        )

    @property
    def degraded(self):
        return self._latch['fallback'] is not None

    @property
    def _degraded_reason(self):
        return self._latch['reason']

    def health(self):
        """(table_present, degraded) for the health check endpoint."""
        connection = connections['default']
        try:
            with connection.cursor() as cursor:
                names = connection.introspection.table_names(cursor)
        except DatabaseError:
            return False, self.degraded
        return self._table in names, self.degraded


for _name in _SQL_METHODS:
    setattr(ResilientDatabaseCache, _name, _degrades_to_fallback(_name)(
        getattr(DatabaseCache, _name)
    ))