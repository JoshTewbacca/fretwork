"""Tests for fretwork_ingest.db: schema creation and idempotency."""

from pathlib import Path

from fretwork_ingest import db


def test_init_db_creates_all_tables(tmp_path: Path) -> None:
    db_path = tmp_path / "fretwork.db"
    db.init_db(db_path)

    conn = db.get_connection(db_path)
    try:
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
    finally:
        conn.close()

    expected = {
        "schema_version",
        "source_audio",
        "matches",
        "jobs",
        "bundles",
        "events",
    }
    assert expected.issubset(tables)


def test_init_db_sets_schema_version(tmp_path: Path) -> None:
    db_path = tmp_path / "fretwork.db"
    db.init_db(db_path)

    conn = db.get_connection(db_path)
    try:
        assert db.get_schema_version(conn) == db.SCHEMA_VERSION
    finally:
        conn.close()


def test_init_db_is_idempotent(tmp_path: Path) -> None:
    db_path = tmp_path / "fretwork.db"

    db.init_db(db_path)
    db.init_db(db_path)
    db.init_db(db_path)

    conn = db.get_connection(db_path)
    try:
        rows = conn.execute("SELECT version FROM schema_version").fetchall()
        assert len(rows) == 1
        assert rows[0]["version"] == db.SCHEMA_VERSION
    finally:
        conn.close()


def test_source_audio_upsert_roundtrip(tmp_path: Path) -> None:
    db_path = tmp_path / "fretwork.db"
    db.init_db(db_path)
    conn = db.get_connection(db_path)
    try:
        db.upsert_source_audio(
            conn,
            fingerprint="abc123",
            path="C:/music/song.mp3",
            artist="Artist",
            title="Title",
            album="Album",
            duration_ms=180000,
            drm_protected=False,
            scanned_at=1234567890,
        )
        row = db.get_source_audio(conn, "abc123")
        assert row is not None
        assert row["artist"] == "Artist"
        assert row["drm_protected"] == 0

        # Upsert again with changed tags -- same fingerprint, new values win.
        db.upsert_source_audio(
            conn,
            fingerprint="abc123",
            path="C:/music/song.mp3",
            artist="Artist",
            title="New Title",
            album="Album",
            duration_ms=180000,
            drm_protected=False,
            scanned_at=1234567999,
        )
        row = db.get_source_audio(conn, "abc123")
        assert row["title"] == "New Title"
        assert len(db.list_source_audio(conn)) == 1
    finally:
        conn.close()


def test_match_status_lifecycle(tmp_path: Path) -> None:
    db_path = tmp_path / "fretwork.db"
    db.init_db(db_path)
    conn = db.get_connection(db_path)
    try:
        db.upsert_match(conn, "song-1", "fp-1", 0.5, "pending-review")
        assert len(db.list_matches_by_status(conn, "pending-review")) == 1

        db.set_match_status(conn, "song-1", "fp-1", "confirmed")
        match = db.get_match(conn, "song-1", "fp-1")
        assert match["status"] == "confirmed"
        assert len(db.list_matches_by_status(conn, "pending-review")) == 0
    finally:
        conn.close()


def test_events_insert_or_ignore_by_id(tmp_path: Path) -> None:
    db_path = tmp_path / "fretwork.db"
    db.init_db(db_path)
    conn = db.get_connection(db_path)
    try:
        db.insert_event_ignore(conn, "evt-1", 100, "session_start", '{"id":"evt-1"}')
        # Re-sending the same id must be a no-op, not an overwrite.
        db.insert_event_ignore(conn, "evt-1", 999, "session_end", '{"id":"evt-1","changed":true}')

        rows = db.list_events_since(conn, "0")
        assert len(rows) == 1
        assert rows[0]["ts"] == 100
        assert rows[0]["type"] == "session_start"
    finally:
        conn.close()


def test_list_events_since_orders_by_id(tmp_path: Path) -> None:
    db_path = tmp_path / "fretwork.db"
    db.init_db(db_path)
    conn = db.get_connection(db_path)
    try:
        db.insert_event_ignore(conn, "evt-1", 100, "session_start", "{}")
        db.insert_event_ignore(conn, "evt-2", 200, "session_end", "{}")
        db.insert_event_ignore(conn, "evt-3", 300, "session_start", "{}")

        rows = db.list_events_since(conn, "evt-1")
        ids = [r["id"] for r in rows]
        assert ids == ["evt-2", "evt-3"]
    finally:
        conn.close()
