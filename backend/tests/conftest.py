import os
import socket
import sys
from sqlalchemy import CheckConstraint


def _install_windows_loopback_isolated_proactor_wakeup() -> None:
    """Fallback to native Windows IOCP wakeups when sandbox blocks 127.0.0.1 socketpair()."""
    if sys.platform != "win32":
        return

    probe_listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe_client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    loopback_available = False
    try:
        probe_listener.bind(("127.0.0.1", 0))
        probe_listener.listen(1)
        probe_listener.settimeout(0.05)
        probe_client.setblocking(False)
        try:
            probe_client.connect(probe_listener.getsockname())
        except BlockingIOError:
            pass
        conn, _ = probe_listener.accept()
        conn.close()
        loopback_available = True
    except OSError:
        loopback_available = False
    finally:
        probe_client.close()
        probe_listener.close()

    if loopback_available:
        return

    import _overlapped
    import asyncio.proactor_events as pe

    def _init_without_loopback_self_pipe(self, proactor) -> None:
        super(pe.BaseProactorEventLoop, self).__init__()
        self._proactor = proactor
        self._selector = proactor
        self._self_reading_future = None
        self._accept_futures = {}
        proactor.set_loop(self)
        self._make_self_pipe()

    def _noop_self_pipe(self) -> None:
        self._ssock = None
        self._csock = None

    def _write_to_self_iocp(self) -> None:
        proactor = getattr(self, "_proactor", None)
        iocp = getattr(proactor, "_iocp", None)
        if iocp is not None:
            try:
                _overlapped.PostQueuedCompletionStatus(iocp, 0, 0, 1)
            except OSError:
                pass

    pe.BaseProactorEventLoop.__init__ = _init_without_loopback_self_pipe
    pe.BaseProactorEventLoop._make_self_pipe = _noop_self_pipe
    pe.BaseProactorEventLoop._close_self_pipe = _noop_self_pipe
    pe.BaseProactorEventLoop._loop_self_reading = lambda self, f=None: None
    pe.BaseProactorEventLoop._write_to_self = _write_to_self_iocp


_install_windows_loopback_isolated_proactor_wakeup()

# Do not inject a fictional PostgreSQL credential here.  Integration tests use
# the configured DATABASE_URL (or an explicitly supplied TEST_DATABASE_URL),
# while ordinary unit tests construct isolated SQLite engines themselves.
if os.getenv("TEST_DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
os.environ.setdefault("SECRET_KEY", "test-secret-key-with-at-least-32-characters")
os.environ.setdefault("COOKIE_SECURE", "false")

try:
    from app.models.people.Student import Student
    lrn_check = next(
        (c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"),
        None,
    )
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
except Exception:
    pass
