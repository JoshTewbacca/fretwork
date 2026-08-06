"""SQLite access for the ingest service.

Schema mirrors docs/01-data-model.md "Desktop entities" exactly for
source_audio, matches, jobs and bundles. An additional schema_version table
and events table (practice-event mirror, described in the same doc's HTTP API
section but not given an explicit column list) are added here; see the
deviation note on Event below.

All access goes through parameterised queries. Connections use
sqlite3.Row as the row factory so callers can use both index and column-name
access.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

SCHEMA_VERSION = 2

_SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS source_audio (
        fingerprint TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        artist TEXT,
        title TEXT,
        album TEXT,
        duration_ms INTEGER,
        drm_protected INTEGER NOT NULL DEFAULT 0,
        scanned_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS matches (
        song_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        PRIMARY KEY (song_id, fingerprint)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        song_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        segment_size INTEGER,
        error TEXT,
        updated_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS bundles (
        id TEXT PRIMARY KEY,
        song_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        backing_path TEXT,
        guitar_path TEXT,
        duration_ms INTEGER,
        sync_map_json TEXT,
        created_at INTEGER NOT NULL
    )
    """,
    # Deviation from docs/01-data-model.md: the data model describes the
    # practice-event mirror in prose ("POST /events/backup ... append-only
    # practice-event mirror") but does not give it a column list the way it
    # does for the four tables above -- the PWA-side PracticeEvent union
    # (data-model.md store: events) is the closest authoritative shape. This
    # table mirrors that: id is the PWA event ULID (insert-or-ignore gives
    # the union-by-id semantics ADR-003 asks for), ts/type are pulled out for
    # indexing and range scans, and payload_json holds the full event so the
    # desktop never needs to understand every PracticeEvent variant.
    """
    CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL
    )
    """,
    # Schema version 2, per docs/adr/ADR-006-library-ownership-and-sync.md: the
    # desktop gains a catalogue. Before this the desktop knew a song only as an
    # id borrowed from a match row, which is why /manifest could not describe a
    # library and ADR-003's rebuild-after-eviction path could not run.
    #
    # Only the fields the desktop owns are here. favourite, tags, lastPlayedAt
    # and the correction hashes are deliberately absent rather than nullable:
    # a column the desktop can write is a column a sync can overwrite, and the
    # ADR's ownership table says those belong to the phone.
    """
    CREATE TABLE IF NOT EXISTS songs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT,
        source_id TEXT NOT NULL,
        source_external_id TEXT,
        source_url TEXT,
        tab_blob_hash TEXT NOT NULL,
        tab_format TEXT NOT NULL,
        default_track_index INTEGER,
        target_tempo_bpm INTEGER,
        archived INTEGER NOT NULL DEFAULT 0,
        added_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts)",
    "CREATE INDEX IF NOT EXISTS idx_matches_status ON matches (status)",
    "CREATE INDEX IF NOT EXISTS idx_songs_updated_at ON songs (updated_at)",
]


def get_connection(path: Path) -> sqlite3.Connection:
    """Open a connection with row factory and foreign keys pragma set."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(path: Path) -> None:
    """Create the schema if absent. Safe to call repeatedly (idempotent).

    Every statement is CREATE ... IF NOT EXISTS and this runs on every start,
    so a database written by an older version gains new tables in place with
    no data loss and no migration machinery. That holds only for additive
    changes; a change that alters or drops a column will need real migrations
    and this function is where that would go.

    The recorded version is also advanced, which it previously was not: the
    row was inserted once and never updated, so a database created at version
    1 would keep reporting 1 no matter how far the schema moved on.
    """
    conn = get_connection(path)
    try:
        with conn:
            for statement in _SCHEMA_STATEMENTS:
                conn.execute(statement)
            row = conn.execute("SELECT version FROM schema_version").fetchone()
            if row is None:
                conn.execute(
                    "INSERT INTO schema_version (version) VALUES (?)",
                    (SCHEMA_VERSION,),
                )
            elif row["version"] < SCHEMA_VERSION:
                conn.execute(
                    "UPDATE schema_version SET version = ?", (SCHEMA_VERSION,)
                )
    finally:
        conn.close()


# --- source_audio -----------------------------------------------------------


def upsert_source_audio(
    conn: sqlite3.Connection,
    fingerprint: str,
    path: str,
    artist: Optional[str],
    title: Optional[str],
    album: Optional[str],
    duration_ms: Optional[int],
    drm_protected: bool,
    scanned_at: int,
) -> None:
    with conn:
        conn.execute(
            """
            INSERT INTO source_audio
                (fingerprint, path, artist, title, album, duration_ms,
                 drm_protected, scanned_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fingerprint) DO UPDATE SET
                path = excluded.path,
                artist = excluded.artist,
                title = excluded.title,
                album = excluded.album,
                duration_ms = excluded.duration_ms,
                drm_protected = excluded.drm_protected,
                scanned_at = excluded.scanned_at
            """,
            (
                fingerprint,
                path,
                artist,
                title,
                album,
                duration_ms,
                1 if drm_protected else 0,
                scanned_at,
            ),
        )


def get_source_audio(conn: sqlite3.Connection, fingerprint: str) -> Optional[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM source_audio WHERE fingerprint = ?", (fingerprint,)
    ).fetchone()


def list_source_audio(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM source_audio ORDER BY path").fetchall()


# --- matches -----------------------------------------------------------------


def upsert_match(
    conn: sqlite3.Connection,
    song_id: str,
    fingerprint: str,
    confidence: float,
    status: str,
) -> None:
    with conn:
        conn.execute(
            """
            INSERT INTO matches (song_id, fingerprint, confidence, status)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(song_id, fingerprint) DO UPDATE SET
                confidence = excluded.confidence,
                status = excluded.status
            """,
            (song_id, fingerprint, confidence, status),
        )


def get_match(conn: sqlite3.Connection, song_id: str, fingerprint: str) -> Optional[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM matches WHERE song_id = ? AND fingerprint = ?",
        (song_id, fingerprint),
    ).fetchone()


def list_matches_by_status(conn: sqlite3.Connection, status: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM matches WHERE status = ? ORDER BY song_id", (status,)
    ).fetchall()


def list_matches_for_song(conn: sqlite3.Connection, song_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM matches WHERE song_id = ? ORDER BY confidence DESC",
        (song_id,),
    ).fetchall()


def set_match_status(
    conn: sqlite3.Connection, song_id: str, fingerprint: str, status: str
) -> None:
    with conn:
        conn.execute(
            "UPDATE matches SET status = ? WHERE song_id = ? AND fingerprint = ?",
            (status, song_id, fingerprint),
        )


# --- jobs ----------------------------------------------------------------


def upsert_job(
    conn: sqlite3.Connection,
    job_id: str,
    fingerprint: str,
    song_id: str,
    stage: str,
    attempts: int,
    segment_size: Optional[int],
    error: Optional[str],
    updated_at: int,
) -> None:
    with conn:
        conn.execute(
            """
            INSERT INTO jobs
                (id, fingerprint, song_id, stage, attempts, segment_size,
                 error, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                fingerprint = excluded.fingerprint,
                song_id = excluded.song_id,
                stage = excluded.stage,
                attempts = excluded.attempts,
                segment_size = excluded.segment_size,
                error = excluded.error,
                updated_at = excluded.updated_at
            """,
            (job_id, fingerprint, song_id, stage, attempts, segment_size, error, updated_at),
        )


def list_jobs(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM jobs ORDER BY updated_at DESC").fetchall()


# --- bundles ---------------------------------------------------------------


def upsert_bundle(
    conn: sqlite3.Connection,
    bundle_id: str,
    song_id: str,
    fingerprint: str,
    backing_path: Optional[str],
    guitar_path: Optional[str],
    duration_ms: Optional[int],
    sync_map_json: Optional[str],
    created_at: int,
) -> None:
    with conn:
        conn.execute(
            """
            INSERT INTO bundles
                (id, song_id, fingerprint, backing_path, guitar_path,
                 duration_ms, sync_map_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                song_id = excluded.song_id,
                fingerprint = excluded.fingerprint,
                backing_path = excluded.backing_path,
                guitar_path = excluded.guitar_path,
                duration_ms = excluded.duration_ms,
                sync_map_json = excluded.sync_map_json,
                created_at = excluded.created_at
            """,
            (
                bundle_id,
                song_id,
                fingerprint,
                backing_path,
                guitar_path,
                duration_ms,
                sync_map_json,
                created_at,
            ),
        )


def list_bundles(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM bundles ORDER BY created_at DESC").fetchall()


def list_bundles_for_song(conn: sqlite3.Connection, song_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM bundles WHERE song_id = ? ORDER BY created_at DESC", (song_id,)
    ).fetchall()


# --- songs -------------------------------------------------------------------


def upsert_song(
    conn: sqlite3.Connection,
    song_id: str,
    title: str,
    artist: str,
    album: Optional[str],
    source_id: str,
    source_external_id: Optional[str],
    source_url: Optional[str],
    tab_blob_hash: str,
    tab_format: str,
    default_track_index: Optional[int],
    target_tempo_bpm: Optional[int],
    added_at: int,
    updated_at: int,
) -> None:
    """Insert or update one catalogue row.

    added_at is preserved on update: it records when the song entered the
    library, which the one-time migration from the phone carries across so
    that a pushed library does not all claim to have been added the day it
    was pushed. updated_at always advances -- it is what drives sync.

    An update also clears `archived`, because the only thing that calls this
    is a deliberate add, and re-adding a song you previously removed should
    bring it back rather than silently write to a row the phone still hides.
    """
    with conn:
        conn.execute(
            """
            INSERT INTO songs
                (id, title, artist, album, source_id, source_external_id,
                 source_url, tab_blob_hash, tab_format, default_track_index,
                 target_tempo_bpm, archived, added_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                artist = excluded.artist,
                album = excluded.album,
                source_id = excluded.source_id,
                source_external_id = excluded.source_external_id,
                source_url = excluded.source_url,
                tab_blob_hash = excluded.tab_blob_hash,
                tab_format = excluded.tab_format,
                default_track_index = excluded.default_track_index,
                target_tempo_bpm = excluded.target_tempo_bpm,
                archived = 0,
                updated_at = excluded.updated_at
            """,
            (
                song_id,
                title,
                artist,
                album,
                source_id,
                source_external_id,
                source_url,
                tab_blob_hash,
                tab_format,
                default_track_index,
                target_tempo_bpm,
                added_at,
                updated_at,
            ),
        )


def get_song(conn: sqlite3.Connection, song_id: str) -> Optional[sqlite3.Row]:
    return conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()


def list_songs(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """Every catalogue row, archived ones included.

    Archived songs stay in the response on purpose (ADR-006): the phone hides
    them but keeps their passages and events, and a song that vanished from
    the payload entirely would look to the phone exactly like one that had
    never existed.
    """
    return conn.execute("SELECT * FROM songs ORDER BY artist, title").fetchall()


def set_song_archived(conn: sqlite3.Connection, song_id: str, archived: bool, updated_at: int) -> None:
    with conn:
        conn.execute(
            "UPDATE songs SET archived = ?, updated_at = ? WHERE id = ?",
            (1 if archived else 0, updated_at, song_id),
        )


# --- events ------------------------------------------------------------------


def insert_event_ignore(
    conn: sqlite3.Connection, event_id: str, ts: int, event_type: str, payload_json: str
) -> None:
    """Insert a practice event, ignoring it if the id already exists.

    Events are append-only and unioned by id (ADR-003); re-sending an event
    already known to the desktop must be a no-op, not an overwrite.
    """
    with conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO events (id, ts, type, payload_json)
            VALUES (?, ?, ?, ?)
            """,
            (event_id, ts, event_type, payload_json),
        )


def list_events_since(conn: sqlite3.Connection, event_id: str) -> list[sqlite3.Row]:
    """Return events after event_id, ordered by id.

    Event ids are ULIDs, which sort lexicographically by creation time, so a
    plain string comparison on id gives a correct "since" range scan without
    needing a separate sequence column. event_id = "0" returns every event.
    """
    return conn.execute(
        "SELECT * FROM events WHERE id > ? ORDER BY id", (event_id,)
    ).fetchall()


@dataclass
class SchemaInfo:
    version: int


def get_schema_version(conn: sqlite3.Connection) -> Optional[int]:
    row = conn.execute("SELECT version FROM schema_version").fetchone()
    return row["version"] if row else None
