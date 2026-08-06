"""Tests for the ADR-006 endpoints: GET /library, POST /blob, POST /songs,
DELETE /songs/{id}.

These cover the integrity rules rather than just the happy path, because the
happy path is the part that a later change is least likely to break silently.
"""

import hashlib
import json
from pathlib import Path

from fastapi.testclient import TestClient

from fretwork_ingest import db
from fretwork_ingest.api import MAX_UPLOAD_BYTES, create_app
from fretwork_ingest.config import Config

TAB_BYTES = b"not really a guitar pro file, but bytes are bytes"
TAB_HASH = hashlib.sha256(TAB_BYTES).hexdigest()


def _make_app(tmp_path: Path):
    cfg = Config(
        media_root=tmp_path / "media",
        data_dir=tmp_path / "data",
        host="127.0.0.1",
        port=8765,
    )
    return create_app(cfg), cfg


def _song_body(**overrides) -> dict:
    body = {
        "id": "song-1",
        "title": "Welcome To The Black Parade",
        "artist": "My Chemical Romance",
        "source_id": "purchased",
        "tab_blob_hash": TAB_HASH,
        "tab_format": "gp",
        "default_track_index": 0,
        "target_tempo_bpm": 150,
    }
    body.update(overrides)
    return body


def _upload_tab(client: TestClient) -> str:
    response = client.post("/blob", content=TAB_BYTES)
    assert response.status_code == 200
    return response.json()["hash"]


# --- POST /blob --------------------------------------------------------------


def test_post_blob_returns_the_server_computed_hash(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    response = client.post("/blob", content=TAB_BYTES)

    assert response.status_code == 200
    assert response.json() == {"hash": TAB_HASH, "size": len(TAB_BYTES)}


def test_uploaded_blob_is_downloadable(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    file_hash = _upload_tab(client)
    response = client.get(f"/blob/{file_hash}")

    assert response.status_code == 200
    assert response.content == TAB_BYTES


def test_post_blob_is_idempotent(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    first = client.post("/blob", content=TAB_BYTES).json()
    second = client.post("/blob", content=TAB_BYTES).json()

    assert first == second


def test_post_blob_rejects_an_empty_body(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    assert client.post("/blob", content=b"").status_code == 400


def test_post_blob_rejects_an_oversized_upload(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    response = client.post("/blob", content=b"x" * (MAX_UPLOAD_BYTES + 1))

    assert response.status_code == 413


def test_oversized_upload_leaves_no_temp_file_behind(tmp_path: Path) -> None:
    app, cfg = _make_app(tmp_path)
    client = TestClient(app)

    client.post("/blob", content=b"x" * (MAX_UPLOAD_BYTES + 1))

    work_dir = cfg.data_dir / "work"
    leftovers = list(work_dir.glob("*.upload")) if work_dir.exists() else []
    assert leftovers == []


# --- POST /songs -------------------------------------------------------------


def test_post_song_stores_the_row(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)
    _upload_tab(client)

    response = client.post("/songs", json=_song_body())

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "song-1"
    assert body["title"] == "Welcome To The Black Parade"
    assert body["source"]["source_id"] == "purchased"
    assert body["archived"] is False


def test_post_song_rejects_a_hash_with_no_blob_behind_it(tmp_path: Path) -> None:
    """A catalogue row the phone can never download is worse than a failed
    upload: it fails later, on a different device, as a song that will not
    open."""
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    response = client.post("/songs", json=_song_body())

    assert response.status_code == 422
    assert "no blob stored" in response.json()["detail"]


def test_post_song_rejects_an_unsupported_format(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)
    _upload_tab(client)

    response = client.post("/songs", json=_song_body(tab_format="pdf"))

    assert response.status_code == 422


def test_post_song_preserves_added_at_across_updates(tmp_path: Path) -> None:
    """added_at records when the song entered the library, not when the row
    was last written -- otherwise a re-sync silently restamps the whole
    library to today."""
    app, _ = _make_app(tmp_path)
    client = TestClient(app)
    _upload_tab(client)

    first = client.post("/songs", json=_song_body(added_at=12345)).json()
    second = client.post("/songs", json=_song_body(title="Renamed")).json()

    assert first["added_at"] == 12345
    assert second["added_at"] == 12345
    assert second["title"] == "Renamed"


def test_post_song_ignores_phone_owned_fields(tmp_path: Path) -> None:
    """The desktop must not learn favourite/tags: a field it can store is a
    field it can echo back and overwrite on the next sync."""
    app, _ = _make_app(tmp_path)
    client = TestClient(app)
    _upload_tab(client)

    response = client.post(
        "/songs", json=_song_body(favourite=True, tags=["riffs"], last_played_at=999)
    )

    assert response.status_code == 200
    body = response.json()
    assert "favourite" not in body
    assert "tags" not in body
    assert "last_played_at" not in body


# --- GET /library ------------------------------------------------------------


def test_library_is_empty_before_anything_is_added(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    body = client.get("/library").json()

    assert body == {"version": 2, "songs": []}


def test_library_returns_songs_with_no_audio(tmp_path: Path) -> None:
    """The case /manifest structurally cannot report, and the normal one."""
    app, _ = _make_app(tmp_path)
    client = TestClient(app)
    _upload_tab(client)
    client.post("/songs", json=_song_body())

    body = client.get("/library").json()

    assert len(body["songs"]) == 1
    song = body["songs"][0]
    assert song["tab_blob_hash"] == TAB_HASH
    assert song["tab_format"] == "gp"
    assert song["bundles"] == []

    # The same song is absent from /manifest, which is the point of adding
    # a second endpoint rather than extending that one.
    assert client.get("/manifest").json()["songs"] == []


def test_library_attaches_bundles_to_their_song(tmp_path: Path) -> None:
    app, cfg = _make_app(tmp_path)
    client = TestClient(app)
    _upload_tab(client)
    client.post("/songs", json=_song_body())

    conn = db.get_connection(cfg.db_path)
    try:
        db.upsert_bundle(
            conn,
            bundle_id="bundle-1",
            song_id="song-1",
            fingerprint="f" * 64,
            backing_path="b" * 64,
            guitar_path=None,
            duration_ms=309000,
            sync_map_json=json.dumps({"version": 1, "points": [], "confidence": 0.5,
                                      "status": "needs-review"}),
            created_at=42,
        )
    finally:
        conn.close()

    song = client.get("/library").json()["songs"][0]

    assert len(song["bundles"]) == 1
    assert song["bundles"][0]["backing_hash"] == "b" * 64
    assert song["bundles"][0]["sync_map"]["status"] == "needs-review"


def test_archived_songs_stay_in_the_library_payload(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)
    _upload_tab(client)
    client.post("/songs", json=_song_body())

    client.delete("/songs/song-1")
    songs = client.get("/library").json()["songs"]

    assert len(songs) == 1
    assert songs[0]["archived"] is True


# --- DELETE /songs/{id} ------------------------------------------------------


def test_delete_archives_rather_than_dropping(tmp_path: Path) -> None:
    app, cfg = _make_app(tmp_path)
    client = TestClient(app)
    _upload_tab(client)
    client.post("/songs", json=_song_body())

    response = client.delete("/songs/song-1")

    assert response.status_code == 200
    conn = db.get_connection(cfg.db_path)
    try:
        row = db.get_song(conn, "song-1")
        assert row is not None
        assert row["archived"] == 1
    finally:
        conn.close()


def test_delete_leaves_practice_events_intact(tmp_path: Path) -> None:
    """The reason archiving exists at all (ADR-003: losing audio is an
    inconvenience, losing practice history is not)."""
    app, cfg = _make_app(tmp_path)
    client = TestClient(app)
    _upload_tab(client)
    client.post("/songs", json=_song_body())
    client.post(
        "/events/backup",
        json=[{"id": "evt-1", "ts": 1, "type": "playthrough", "songId": "song-1"}],
    )

    client.delete("/songs/song-1")

    events = client.get("/events/since/0").json()["events"]
    assert [e["id"] for e in events] == ["evt-1"]


def test_delete_unknown_song_is_404(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    client = TestClient(app)

    assert client.delete("/songs/nope").status_code == 404
