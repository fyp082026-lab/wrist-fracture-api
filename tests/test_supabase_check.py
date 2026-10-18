from types import SimpleNamespace

from app.supabase_check import SupabaseProbe, is_api_key_error


def test_detects_key_errors_only():
    assert is_api_key_error(Exception("Unregistered API key"))
    assert is_api_key_error(Exception("Invalid API key"))
    assert not is_api_key_error(Exception("invalid JWT: unable to parse or verify signature"))
    assert not is_api_key_error(Exception("Token has expired"))


def probe_with(list_users):
    sb = SimpleNamespace(auth=SimpleNamespace(admin=SimpleNamespace(list_users=list_users)))
    now = [0.0]
    return SupabaseProbe(sb, interval=300, clock=lambda: now[0]), now


def test_ok_key_reports_no_error_and_caches():
    calls = []
    probe, now = probe_with(lambda **_: calls.append(1) or [])
    assert probe.status() is None
    assert probe.status() is None
    assert len(calls) == 1  # cached inside the interval
    now[0] = 301
    probe.status()
    assert len(calls) == 2


def test_rejected_key_is_reported():
    def boom(**_):
        raise Exception("Unregistered API key")
    probe, _ = probe_with(boom)
    assert "service key" in probe.status()


def test_mark_key_error_shows_immediately():
    probe, _ = probe_with(lambda **_: [])
    assert probe.status() is None
    probe.mark_key_error()
    assert "service key" in probe.status()
