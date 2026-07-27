"""Tests for fretwork_ingest.api: /health and /blob via FastAPI TestClient."""

from pathlib import Path

from fastapi.testclient import TestClient

from fretwork_ingest import __version__
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


def test_health(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == __version__


def test_blob_missing_hash_returns_404(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    response = client.get("/blob/" + "0" * 64)

    assert response.status_code == 404


def test_blob_existing_hash_streams_bytes(tmp_path: Path) -> None:
    app, cfg = _make_app(tmp_path)
    client = TestClient(app)

    src = tmp_path / "sample.bin"
    payload = b"fake audio payload bytes"
    src.write_bytes(payload)
    file_hash = app.state.blobstore.put_file(src)

    response = client.get(f"/blob/{file_hash}")

    assert response.status_code == 200
    assert response.content == payload


def test_review_queue_empty_by_default(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    response = client.get("/review-queue")

    assert response.status_code == 200
    assert response.json() == {"entries": []}


def test_events_backup_and_since_roundtrip(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    events = [
        {"id": "01AAA", "ts": 1000, "type": "session_start"},
        {"id": "01AAB", "ts": 1001, "type": "session_end"},
    ]
    post_response = client.post("/events/backup", json=events)
    assert post_response.status_code == 200
    assert post_response.json() == {"received": 2}

    # Re-posting the same events must be a no-op (insert-or-ignore by id).
    post_again = client.post("/events/backup", json=events)
    assert post_again.status_code == 200

    since_response = client.get("/events/since/0")
    assert since_response.status_code == 200
    body = since_response.json()
    assert len(body["events"]) == 2


def test_manifest_empty_by_default(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    response = client.get("/manifest")

    assert response.status_code == 200
    assert response.json() == {"songs": []}
