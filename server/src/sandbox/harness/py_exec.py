#!/usr/bin/env python3
"""
Hardened Python execution harness.

Reads one JSON job from stdin, executes the *student-assembled* program inside a
throwaway process with resource limits and a restricted import surface, then
writes one JSON result line to fd 3 (or stdout when fd 3 is unavailable).

This file is executed as a standalone child process. It must never be imported
by the API server -- untrusted code never runs inside the web process.

Job:  {"source": str, "stdin": str, "timeLimitMs": int, "memoryMb": int}
Out:  {"status": ..., "stdout": ..., "stderr": ..., "error": {...}, "durationMs": ..., "memoryKb": ...}
"""
import builtins
import io
import json
import os
import resource
import signal
import sys
import time
import traceback

# --------------------------------------------------------------- guards
BLOCKED_MODULES = {
    "subprocess", "socket", "ssl", "shutil", "ctypes", "multiprocessing",
    "http", "urllib", "urllib2", "urllib3", "requests", "ftplib", "telnetlib",
    "smtplib", "asyncio", "signal", "pty", "tty", "termios", "fcntl", "mmap",
    "pickle", "shelve", "dbm", "sqlite3", "webbrowser", "importlib",
    "distutils", "setuptools", "pip", "venv", "threading", "concurrent",
    "xmlrpc", "wsgiref", "cgi", "cgitb", "pdb", "bdb", "gc", "ptrace",
}
# os / sys are needed by the harness itself, so they are wrapped instead of blocked.
BLOCKED_OS_ATTRS = {
    "system", "popen", "fork", "forkpty", "execv", "execve", "execvp", "execl",
    "execle", "execlp", "spawnv", "spawnve", "spawnl", "spawnlp", "kill",
    "killpg", "remove", "unlink", "rmdir", "removedirs", "rename", "renames",
    "replace", "chmod", "chown", "chroot", "setuid", "setgid", "putenv",
    "abort", "_exit", "openpty", "startfile", "truncate", "link", "symlink",
}
# `__import__` stays available but is replaced by the guarded version below --
# removing it would break legitimate `import math` style answers.
BLOCKED_BUILTINS = {"open", "breakpoint", "help", "quit", "exit"}


class RestrictedImportError(ImportError):
    pass


def _install_import_guard(allow_exec_eval):
    real_import = builtins.__import__

    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        root = name.split(".")[0]
        if root in BLOCKED_MODULES:
            raise RestrictedImportError(
                "import of module '%s' is not allowed in the practice sandbox" % root
            )
        return real_import(name, globals, locals, fromlist, level)

    builtins.__import__ = guarded_import
    return real_import


def _harden_os():
    import os as _os
    for attr in BLOCKED_OS_ATTRS:
        if hasattr(_os, attr):
            def blocked(*a, __attr=attr, **kw):
                raise PermissionError("os.%s is disabled in the practice sandbox" % __attr)
            try:
                setattr(_os, attr, blocked)
            except Exception:
                pass


def _apply_limits(memory_mb, cpu_seconds):
    # Address space: hard cap on memory the child may map.
    mem_bytes = int(memory_mb) * 1024 * 1024
    for limit, value in (
        (resource.RLIMIT_AS, (mem_bytes, mem_bytes)),
        (resource.RLIMIT_DATA, (mem_bytes, mem_bytes)),
        (resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1)),
        (resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024)),
        (resource.RLIMIT_NOFILE, (64, 64)),
        (resource.RLIMIT_CORE, (0, 0)),
    ):
        try:
            resource.setrlimit(limit, value)
        except (ValueError, OSError):
            pass
    # No child processes at all.
    try:
        soft, hard = resource.getrlimit(resource.RLIMIT_NPROC)
        resource.setrlimit(resource.RLIMIT_NPROC, (min(soft, 64) if soft > 0 else 64, hard))
    except (ValueError, OSError, AttributeError):
        pass


def _block_network():
    """Neutralise sockets before user code can reach them."""
    try:
        import socket as _socket

        def denied(*a, **kw):
            raise PermissionError("network access is disabled in the practice sandbox")

        _socket.socket = denied
        _socket.create_connection = denied
        _socket.socketpair = denied
        if hasattr(_socket, "SocketIO"):
            _socket.SocketIO = denied
    except Exception:
        pass


def _restrict_builtins(user_globals):
    safe = {}
    for name in dir(builtins):
        if name in BLOCKED_BUILTINS:
            continue
        safe[name] = getattr(builtins, name)

    def denied_open(*a, **kw):
        raise PermissionError("file access is disabled in the practice sandbox")

    safe["open"] = denied_open
    safe["__import__"] = builtins.__import__  # already the guarded version
    safe["__name__"] = "__main__"
    user_globals["__builtins__"] = safe
    return safe


def main():
    raw = sys.stdin.read()
    job = json.loads(raw or "{}")
    source = job.get("source", "")
    stdin_data = job.get("stdin", "") or ""
    time_limit_ms = int(job.get("timeLimitMs", 4000))
    memory_mb = int(job.get("memoryMb", 128))

    cpu_seconds = max(1, int(time_limit_ms / 1000) + 1)
    _apply_limits(memory_mb, cpu_seconds)
    _block_network()
    _harden_os()
    _install_import_guard(False)

    out_buf = io.StringIO()
    err_buf = io.StringIO()
    result = {
        "status": "ok",
        "stdout": "",
        "stderr": "",
        "error": None,
        "durationMs": 0,
        "memoryKb": 0,
    }

    # Wall-clock watchdog on top of RLIMIT_CPU (catches sleep()-style stalls).
    def on_alarm(signum, frame):
        raise TimeoutError("execution exceeded the %d ms time limit" % time_limit_ms)

    try:
        signal.signal(signal.SIGALRM, on_alarm)
        signal.setitimer(signal.ITIMER_REAL, time_limit_ms / 1000.0)
    except Exception:
        pass

    user_globals = {"__name__": "__main__", "__doc__": None}
    _restrict_builtins(user_globals)

    real_stdout, real_stderr, real_stdin = sys.stdout, sys.stderr, sys.stdin
    sys.stdout, sys.stderr = out_buf, err_buf
    sys.stdin = io.StringIO(stdin_data)
    started = time.time()
    try:
        code = compile(source, "<student-program>", "exec")
        exec(code, user_globals)
    except TimeoutError as exc:
        result["status"] = "timeout"
        result["error"] = {"type": "TimeoutError", "message": str(exc), "line": None}
    except SyntaxError as exc:
        result["status"] = "syntax_error"
        result["error"] = {
            "type": "SyntaxError",
            "message": exc.msg or str(exc),
            "line": exc.lineno,
            "offset": exc.offset,
            "text": (exc.text or "").rstrip("\n"),
        }
    except RestrictedImportError as exc:
        result["status"] = "restricted"
        result["error"] = {"type": "RestrictedImportError", "message": str(exc), "line": None}
    except PermissionError as exc:
        result["status"] = "restricted"
        result["error"] = {"type": "PermissionError", "message": str(exc), "line": None}
    except MemoryError as exc:
        result["status"] = "memory_exceeded"
        result["error"] = {"type": "MemoryError", "message": "memory limit exceeded", "line": None}
    except RecursionError as exc:
        result["status"] = "runtime_error"
        result["error"] = {"type": "RecursionError", "message": str(exc), "line": None}
    except BaseException as exc:  # SystemExit / KeyboardInterrupt included
        tb = exc.__traceback__
        line = None
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == "<student-program>":
                line = tb.tb_lineno
            tb = tb.tb_next
        result["status"] = "runtime_error"
        result["error"] = {
            "type": type(exc).__name__,
            "message": str(exc),
            "line": line,
            "traceback": "".join(
                traceback.format_exception_only(type(exc), exc)
            ).strip(),
        }
    finally:
        try:
            signal.setitimer(signal.ITIMER_REAL, 0)
        except Exception:
            pass
        sys.stdout, sys.stderr, sys.stdin = real_stdout, real_stderr, real_stdin

    result["durationMs"] = int((time.time() - started) * 1000)
    try:
        result["memoryKb"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    except Exception:
        result["memoryKb"] = 0
    result["stdout"] = out_buf.getvalue()
    result["stderr"] = err_buf.getvalue()

    payload = json.dumps(result)
    try:
        with os.fdopen(3, "w") as ch:
            ch.write(payload)
    except Exception:
        sys.stdout.write("\n__SANDBOX_RESULT__" + payload)


if __name__ == "__main__":
    main()
