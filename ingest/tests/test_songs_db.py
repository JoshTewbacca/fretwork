"""Tests for the songs catalogue added by ADR-006.

Kept in its own module rather than appended to test_db.py because the
catalogue is a distinct concern from the audio-ingest tables, and because
the ownership rules it encodes are the thing most likely to be broken by a
later change that looks harmless.
"""

from pathlib import Path

from fretwork_ingest import db


def _open(tmp_path: Path):
    db_path = tmp_path / "fretwork.db"
    db.init_db(db_path)
    return db.get_connection(db_path)


def _insert(conn, song_id: str = "song-1", **overrides) -> None:
    fields = {
        "song_id": song_id,
        "title": "Welcome To The Black Parade",
        "artist": "My Chemical Romance",
        "album": None,
        "source_id": "purchased",
        "source_external_id": None,
        "source_url": None,
        "tab_blob_hash": "a" * 64,
        "tab_format": "gp",
        "default_track_index": 0,
        "target_tempo_bpm": 150,
        "added_at": 1000,
        "updated_at": 1000,
    }
    fields.update(overrides)
    db.upsert_song(conn, **fields)


def test_init_db_creates_songs_table(tmp_path: Path) -> None:
    conn = _open(tmp_path)
    try:
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        assert "songs" in tables
    finally:
        conn.close()


def test_upsert_song_round_trips(tmp_path: Path) -> None:
    conn = _open(tmp_path)
    try:
        _insert(conn)
        row = db.get_song(conn, "song-1")

        assert row is not None
        assert row["title"] == "Welcome To The Black Parade"
        assert row["artist"] == "My Chemical Romance"
        assert row["tab_format"] == "gp"
        assert row["target_tempo_bpm"] == 150
        assert row["archived"] == 0
    finally:
        conn.close()


def test_upsert_song_updates_in_place(tmp_path: Path) -> None:
    conn = _open(tmp_path)
    try:
        _insert(conn)
        _insert(conn, title="Welcome to the Black Parade", updated_at=2000)

        rows = db.list_songs(conn)
        assert len(rows) == 1
        assert rows[0]["title"] == "Welcome to the Black Parade"
        assert rows[0]["updated_at"] == 2000
    finally:
        conn.close()


def test_archiving_keeps_the_row(tmp_path: Path) -> None:
    """ADR-006: delete archives, never drops. Practice data hangs off this id."""
    conn = _open(tmp_path)
    try:
        _insert(conn)
        db.set_song_archived(conn, "song-1", True, 3000)

        row = db.get_song(conn, "song-1")
        assert row is not None
        assert row["archived"] == 1
        assert row["updated_at"] == 3000
    finally:
        conn.close()


def test_list_songs_includes_archived(tmp_path: Path) -> None:
    """A song that vanished from the payload would look to the phone exactly
    like one that had never existed, so archived rows stay in the list."""
    conn = _open(tmp_path)
    try:
        _insert(conn, song_id="song-1")
        _insert(conn, song_id="song-2", artist="U2", title="Where The Streets Have No Name")
        db.set_song_archived(conn, "song-1", True, 3000)

        ids = {row["id"] for row in db.list_songs(conn)}
        assert ids == {"song-1", "song-2"}
    finally:
        conn.close()


def test_readding_an_archived_song_unarchives_it(tmp_path: Path) -> None:
    conn = _open(tmp_path)
    try:
        _insert(conn)
        db.set_song_archived(conn, "song-1", True, 3000)
        _insert(conn, updated_at=4000)

        row = db.get_song(conn, "song-1")
        assert row is not None
        assert row["archived"] == 0
    finally:
        conn.close()


def test_existing_v1_database_gains_the_table_and_the_version(tmp_path: Path) -> None:
    """The upgrade path that matters: there is already a real fretwork.db on
    this machine written at schema version 1. It must gain the catalogue in
    place, keep its rows, and stop reporting a version it has outgrown."""
    db_path = tmp_path / "fretwork.db"

    # Build a v1-shaped database: every table except songs, version pinned to 1.
    conn = db.get_connection(db_path)
    try:
        with conn:
            for statement in db._SCHEMA_STATEMENTS:
                if "CREATE TABLE IF NOT EXISTS songs" in statement:
                    continue
                if "idx_songs_updated_at" in statement:
                    continue
                conn.execute(statement)
            conn.execute("INSERT INTO schema_version (version) VALUES (1)")
        db.upsert_source_audio(
            conn,
            fingerprint="f" * 64,
            path="D:/Music/x.mp3",
            artist="U2",
            title="Where The Streets Have No Name",
            album=None,
            duration_ms=286000,
            drm_protected=False,
            scanned_at=500,
        )
    finally:
        conn.close()

    db.init_db(db_path)

    conn = db.get_connection(db_path)
    try:
        assert db.get_schema_version(conn) == 2
        assert db.get_song(conn, "song-1") is None  # table exists, is empty
        # The pre-existing row survived the upgrade.
        assert db.get_source_audio(conn, "f" * 64) is not None
    finally:
        conn.close()
