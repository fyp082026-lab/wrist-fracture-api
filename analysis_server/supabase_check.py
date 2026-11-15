"""Detects a broken Supabase service key, which otherwise looks like bad user tokens.

With a rotated or deleted key every auth call fails with "Unregistered API key"
(or "Invalid API key"). Without this check the API answered 401 to every user,
so the app told clinicians their session had expired.

FLOW: main.py creates one SupabaseProbe. verify_token() calls is_api_key_error()
and mark_key_error() when a sign-in check fails; GET /health calls status() and
shows the message to whoever checks the server.
"""
import time

KEY_ERROR_MARKERS = ("api key", "apikey")
PROBE_INTERVAL_S = 300


def is_api_key_error(exc):
    """True when an error text says the server's key was rejected.
    Result goes to: main.py verify_token() (answer 503, not 401) and status() below."""
    text = str(exc).lower()
    return any(m in text for m in KEY_ERROR_MARKERS)


class SupabaseProbe:
    """Cheap, cached check that the service key is accepted (one call per interval)."""

    def __init__(self, supabase, interval=PROBE_INTERVAL_S, clock=time.monotonic):
        self._sb = supabase
        self._interval = interval
        self._clock = clock
        self._checked_at = None
        self._error = None

    def status(self):
        """None when Supabase accepts the key, otherwise a readable error message.
        Result goes to: main.py GET /health (fields supabase / supabase_error)."""
        # Ask Supabase again only when the last answer is older than the interval.
        now = self._clock()
        if self._checked_at is None or now - self._checked_at >= self._interval:
            try:
                self._sb.auth.admin.list_users(page=1, per_page=1)
                self._error = None
            except Exception as e:  # report, never crash /health
                self._error = (
                    "Supabase rejected the server's service key (rotated or deleted). "
                    "Update SUPABASE_SERVICE_ROLE_KEY in ~/app/.env on the server."
                    if is_api_key_error(e) else f"Supabase unreachable: {str(e)[:200]}"
                )
            self._checked_at = now
        return self._error

    def mark_key_error(self):
        """Record a key failure seen on a real request so /health reflects it at once.
        Called by main.py verify_token(); the stored message is returned by status()."""
        self._error = (
            "Supabase rejected the server's service key (rotated or deleted). "
            "Update SUPABASE_SERVICE_ROLE_KEY in ~/app/.env on the server."
        )
        self._checked_at = self._clock()
