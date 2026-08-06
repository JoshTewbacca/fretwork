"""The desktop window around the manager page.

pywebview rather than Tauri: this service is already Python, so the window
costs one dependency and no second toolchain (docs/04-library-manager.md).

The window is a frame around a page the HTTP service already serves, which is
why there is no separate UI stack here. The same page is reachable from the
phone over the tailnet, so the manager works from either place without being
built twice.

The server runs on a background thread rather than in a child process: the
window and the API then share one process to start and one to stop, and
closing the window ends both. A crashed server with an orphaned window (or the
reverse) is a worse failure than either alone.
"""

from __future__ import annotations

import threading
import time
import urllib.error
import urllib.request
from typing import Optional

from .api import create_app
from .config import Config
from .manager_assets import ensure_alphatab

WINDOW_TITLE = "Fretwork Library Manager"
_STARTUP_TIMEOUT_S = 10.0


def _serve_forever(cfg: Config) -> None:
    import uvicorn

    uvicorn.run(create_app(cfg), host=cfg.host, port=cfg.port, log_level="warning")


def _wait_until_serving(url: str, timeout_s: float = _STARTUP_TIMEOUT_S) -> bool:
    """Poll /health until the background server answers.

    Without this the window opens against a socket that is not listening yet
    and shows a browser error page, which looks like a broken app rather than
    a slow one.
    """
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.15)
    return False


def run_manager_window(cfg: Config, host: Optional[str] = None) -> int:
    """Start the API on a background thread and open the window on it."""
    try:
        import webview  # pywebview
    except ImportError:
        print(
            "pywebview is not installed. Install it with:\n"
            "  .venv\\Scripts\\python.exe -m pip install pywebview\n"
            "Or run 'serve' instead and open the manager in a browser."
        )
        return 1

    print(ensure_alphatab().message)

    # Bind the window's own server to loopback whatever the config says: a
    # window on this machine has no reason to be reachable from the network,
    # and 'serve' remains the way to expose the service to the phone.
    window_cfg = Config(
        media_root=cfg.media_root,
        data_dir=cfg.data_dir,
        host=host or "127.0.0.1",
        port=cfg.port,
        demucs_segment_size=cfg.demucs_segment_size,
        audio_codec=cfg.audio_codec,
        audio_bitrate_kbps=cfg.audio_bitrate_kbps,
    )

    thread = threading.Thread(target=_serve_forever, args=(window_cfg,), daemon=True)
    thread.start()

    base_url = f"http://{window_cfg.host}:{window_cfg.port}"
    if not _wait_until_serving(f"{base_url}/health"):
        print(f"the service did not start on {base_url} within {_STARTUP_TIMEOUT_S:.0f}s")
        return 1

    webview.create_window(WINDOW_TITLE, base_url, width=860, height=900)
    webview.start()
    return 0
