"""Tests for the manager window's server side: asset vendoring and the page.

The UI logic itself is exercised in the browser rather than here; what these
cover is the part that fails silently -- a missing bundle, a page that is
served but references files that are not, or a copy step that quietly puts
alphaTab somewhere the page does not look.
"""

from pathlib import Path

from fastapi.testclient import TestClient

from fretwork_ingest import manager_assets
from fretwork_ingest.api import create_app
from fretwork_ingest.config import Config


def _make_app(tmp_path: Path):
    cfg = Config(
        media_root=tmp_path / "media",
        data_dir=tmp_path / "data",
        host="127.0.0.1",
        port=8765,
    )
    return create_app(cfg), cfg


# --- the page ----------------------------------------------------------------


def test_root_serves_the_manager_page(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    assert "Fretwork Library Manager" in response.text


def test_page_assets_are_served(tmp_path: Path) -> None:
    """The page is useless if its own stylesheet and script 404, and that is
    exactly the kind of break a refactor of the static mount would cause."""
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    assert client.get("/static/manager.css").status_code == 200
    assert client.get("/static/manager.js").status_code == 200


def test_page_references_only_assets_that_exist(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)
    html = client.get("/").text

    referenced = set()
    for attr in ('href="', 'src="'):
        start = 0
        while (index := html.find(attr, start)) != -1:
            end = html.find('"', index + len(attr))
            referenced.add(html[index + len(attr) : end])
            start = end

    for path in referenced:
        if not path.startswith("/static/"):
            continue
        # The vendored alphaTab bundle is deliberately allowed to be absent:
        # the page degrades to manual metadata entry when it is (and says so).
        if path.endswith(manager_assets.ALPHATAB_BUNDLE):
            continue
        assert client.get(path).status_code == 200, f"{path} is referenced but not served"


# --- asset vendoring ---------------------------------------------------------


def test_ensure_alphatab_reports_a_missing_source(tmp_path: Path) -> None:
    """No node_modules is a normal state on a fresh clone, and it must produce
    an explanation rather than an exception."""
    result = manager_assets.ensure_alphatab(repo_root=tmp_path)

    if manager_assets.alphatab_available():
        # Already vendored on this machine; the call short-circuits.
        assert result.available is True
    else:
        assert result.available is False
        assert "npm install" in result.message


def test_ensure_alphatab_copies_the_bundle(tmp_path: Path, monkeypatch) -> None:
    fake_repo = tmp_path / "repo"
    source = fake_repo / "app/node_modules/@coderline/alphatab/dist"
    source.mkdir(parents=True)
    (source / manager_assets.ALPHATAB_BUNDLE).write_text("// pretend bundle")

    vendor = tmp_path / "vendor"
    monkeypatch.setattr(manager_assets, "vendor_dir", lambda: vendor)

    result = manager_assets.ensure_alphatab(repo_root=fake_repo)

    assert result.available is True
    assert (vendor / manager_assets.ALPHATAB_BUNDLE).read_text() == "// pretend bundle"


def test_ensure_alphatab_is_idempotent(tmp_path: Path, monkeypatch) -> None:
    vendor = tmp_path / "vendor"
    vendor.mkdir()
    (vendor / manager_assets.ALPHATAB_BUNDLE).write_text("// already here")
    monkeypatch.setattr(manager_assets, "vendor_dir", lambda: vendor)

    result = manager_assets.ensure_alphatab(repo_root=tmp_path / "nonexistent")

    assert result.available is True
    # Not re-copied from a source that does not exist, and not clobbered.
    assert (vendor / manager_assets.ALPHATAB_BUNDLE).read_text() == "// already here"


def test_static_dir_points_at_the_shipped_assets() -> None:
    """Guards the parents[] arithmetic in static_dir(), which is the kind of
    thing that breaks invisibly when a file moves."""
    assert (manager_assets.static_dir() / "manager.html").is_file()
