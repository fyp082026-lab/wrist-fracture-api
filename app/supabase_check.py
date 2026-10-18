"""Detects a broken Supabase service key, which otherwise looks like bad user tokens.

With a rotated or deleted key every auth call fails with "Unregistered API key"
(or "Invalid API key"). Without this check the API answered 401 to every user,
so the app told clinicians their session had expired.
"""
import time

KEY_ERROR_MARKERS = ("api key", "apikey")
PROBE_INTERVAL_S = 300


def is_api_key_error(exc):
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
        """Record a key failure seen on a real request so /health reflects it at once."""
        self._error = (
            "Supabase rejected the server's service key (rotated or deleted). "
            "Update SUPABASE_SERVICE_ROLE_KEY in ~/app/.env on the server."
        )
        self._checked_at = self._clock()
