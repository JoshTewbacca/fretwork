"""The ingest service's HTTP API.

Security note: there is no authentication in v1. Per docs/01-data-model.md
and docs/00-milestone-plan.md (Milestone 1), this is a personal, single-user
service that binds to the LAN and/or Tailscale tailnet interface only -- it
is never exposed to the public internet, so the trust boundary is "on my
network", not "has a token". If this service is ever bound to a public
interface, authentication must be added before that happens.

Endpoints from docs/01-data-model.md:
GET /health, GET /manifest, GET /blob/{hash}, GET /review-queue,
POST /review/{song_id}, POST /events/backup, GET /events/since/{event_id}.

Added by ADR-006 (docs/adr/ADR-006-library-ownership-and-sync.md):
GET /library, POST /blob, POST /songs, DELETE /songs/{song_id}.

This service used to be read-mostly -- the only writes were a review verdict
and an append-only event mirror, neither of which could create anything the
phone would then play. It now accepts uploads that add songs to the library.
The trust boundary is unchanged and still "on my tailnet, not holding a
token", which stays defensible for a single-user service that binds to the
tailnet interface only. But the blast radius is bigger than it was, so if
this is ever bound to a public interface, authentication is required before
that happens, not after.

Interpretation note on /manifest: written when the desktop schema had no
"songs" table, it reports one entry per confirmed/auto match rather than one
per song, so a song appears only once a recording has been matched to it.
ADR-006 adds the catalogue and GET /library, which is what the phone should
read. /manifest is kept unchanged and deprecated rather than extended in
place: a phone running a service-worker-cached build from before this change
is normal under ADR-003, and such a build parsing a changed /manifest is a
broken library screen with no error message.
"""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import time
from pathlib import Path
from typing import Any, Iterator, Literal, Optional, Sequence

from fastapi import Body, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import db
from .blobstore import BlobStore
from .config import Config

from . import __version__

LINKED_MATCH_STATUSES = ("auto", "confirmed")

# The PWA is served over HTTPS from Vercel and talks to this service directly
# from the browser (no server-side proxy), so the response needs CORS headers
# or every request is blocked before this code ever sees it. This service has
# no cookie/session auth (see the module docstring), so credentials stay off.
# Keep this list to the origins the PWA is actually served from; it is
# deliberately not a wildcard.
DEFAULT_ALLOWED_ORIGINS = (
    "https://fretwork-kappa.vercel.app",
    "http://localhost:5173",
)

# Machine-specific origins (e.g. a different Vercel preview URL) can be added
# without editing source: set a comma-separated FRETWORK_CORS_ORIGINS env var.
_CORS_ORIGINS_ENV_VAR = "FRETWORK_CORS_ORIGINS"


def _resolve_allowed_origins(allowed_origins: Sequence[str] | None) -> list[str]:
    if allowed_origins is not None:
        return list(allowed_origins)
    env_value = os.environ.get(_CORS_ORIGINS_ENV_VAR)
    if env_value:
        return [origin.strip() for origin in env_value.split(",") if origin.strip()]
    return list(DEFAULT_ALLOWED_ORIGINS)


# Tab files are small -- a few hundred KB is a big one. The cap exists so a
# misdirected upload fails fast instead of filling the disk, and it is checked
# while streaming rather than after buffering, since a cap you only enforce
# once the body is in memory has already cost you the memory.
MAX_UPLOAD_BYTES = 32 * 1024 * 1024

# Mirrors TabFormat in app/src/core/types.ts. Anything else is rejected at the
# door: the catalogue exists to be played, and a row the player cannot open is
# worse than a failed upload because it fails later and on a different device.
TAB_FORMATS = frozenset({"gp3", "gp4", "gp5", "gpx", "gp", "musicxml"})


class ReviewDecision(BaseModel):
    fingerprint: str
    decision: Literal["confirm", "reject"]


class SongUpload(BaseModel):
    """One catalogue row as the manager window or the phone sends it.

    Only desktop-owned fields (ADR-006). favourite, tags, lastPlayedAt and the
    correction hashes are absent by design -- accepting them would mean the
    desktop could echo them back on the next sync and overwrite the phone's
    copy, which is the exact failure the ownership split exists to prevent.
    """

    id: str
    title: str
    artist: str
    album: Optional[str] = None
    source_id: str
    source_external_id: Optional[str] = None
    source_url: Optional[str] = None
    tab_blob_hash: str
    tab_format: str
    default_track_index: Optional[int] = None
    target_tempo_bpm: Optional[int] = None
    # Carried by the one-time migration so a pushed library keeps its real
    # dates; omitted for a genuinely new song, which is added now.
    added_at: Optional[int] = None


def _bundle_payload(row: sqlite3.Row) -> dict[str, Any]:
    """Serialize one bundle row. Shared by /manifest and /library."""
    return {
        "id": row["id"],
        "backing_hash": row["backing_path"],
        "guitar_hash": row["guitar_path"],
        "duration_ms": row["duration_ms"],
        # The phone needs this to place bars in the audio; without it a
        # bundle is unplayable.
        "sync_map": json.loads(row["sync_map_json"]) if row["sync_map_json"] else None,
        "created_at": row["created_at"],
    }


def _song_payload(row: sqlite3.Row, bundles: list[dict[str, Any]]) -> dict[str, Any]:
    """Serialize one catalogue row for /library.

    snake_case throughout, matching the rest of this API rather than the
    camelCase of the PWA's Song. One convention per surface: the phone
    already maps names at this boundary (see app/src/desktop/client.ts), and
    a payload that is camelCase in places and snake_case in others is worse
    than one that is consistently either.
    """
    return {
        "id": row["id"],
        "title": row["title"],
        "artist": row["artist"],
        "album": row["album"],
        "source": {
            "source_id": row["source_id"],
            "external_id": row["source_external_id"],
            "url": row["source_url"],
        },
        "tab_blob_hash": row["tab_blob_hash"],
        "tab_format": row["tab_format"],
        "default_track_index": row["default_track_index"],
        "target_tempo_bpm": row["target_tempo_bpm"],
        "archived": bool(row["archived"]),
        "added_at": row["added_at"],
        "updated_at": row["updated_at"],
        "bundles": bundles,
    }


def create_app(cfg: Config, allowed_origins: Sequence[str] | None = None) -> FastAPI:
    cfg.ensure_dirs()
    db.init_db(cfg.db_path)
    blobstore = BlobStore(cfg.blob_dir)

    app = FastAPI(title="Fretwork Ingest", version=__version__)
    app.state.config = cfg
    app.state.blobstore = blobstore

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_resolve_allowed_origins(allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        expose_headers=[],
    )

    def get_conn() -> Iterator[sqlite3.Connection]:
        conn = db.get_connection(cfg.db_path)
        try:
            yield conn
        finally:
            conn.close()

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/manifest")
    def manifest(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
        songs: dict[str, dict[str, Any]] = {}
        for status in LINKED_MATCH_STATUSES:
            for m in db.list_matches_by_status(conn, status):
                song_id = m["song_id"]
                if song_id not in songs:
                    source = db.get_source_audio(conn, m["fingerprint"])
                    songs[song_id] = {
                        "song_id": song_id,
                        "fingerprint": m["fingerprint"],
                        "match_status": m["status"],
                        "confidence": m["confidence"],
                        "source_audio": (
                            {
                                "artist": source["artist"],
                                "title": source["title"],
                                "album": source["album"],
                                "duration_ms": source["duration_ms"],
                            }
                            if source is not None
                            else None
                        ),
                        "bundles": [],
                    }
                    # Filled once per song, not once per match: a song with
                    # both an auto and a confirmed match would otherwise list
                    # every bundle twice and the phone would download twice.
                    for b in db.list_bundles_for_song(conn, song_id):
                        songs[song_id]["bundles"].append(_bundle_payload(b))
        return {"songs": list(songs.values())}

    @app.get("/library")
    def library(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
        """The catalogue: everything the phone needs to rebuild a playable library.

        Unlike /manifest this is keyed on the songs table, so a song appears
        whether or not a recording has ever been matched to it -- which is the
        normal case, and the reason /manifest could not serve this purpose.

        A bundle whose song_id has no catalogue row is not returned here. That
        can happen for audio matched before the phone pushed its library up;
        the audio is not lost (/manifest still lists it) and the bundle joins
        its song as soon as that song exists.
        """
        return {
            "version": 2,
            "songs": [
                _song_payload(row, [_bundle_payload(b) for b in db.list_bundles_for_song(conn, row["id"])])
                for row in db.list_songs(conn)
            ],
        }

    @app.get("/blob/{file_hash}")
    def get_blob(file_hash: str) -> FileResponse:
        path = blobstore.get_path(file_hash)
        if path is None:
            raise HTTPException(status_code=404, detail="blob not found")
        return FileResponse(path=path, media_type="application/octet-stream")

    @app.post("/blob")
    async def put_blob(request: Request) -> dict[str, Any]:
        """Store uploaded bytes, return the hash the server computed for them.

        The hash is never taken from the client. The blob store is
        content-addressed (docs/01-data-model.md design rule 1), and a store
        whose key is not provably the digest of the value is not
        content-addressed -- it just has opaque filenames, and every integrity
        and dedupe guarantee built on top of it becomes a guess.

        Streamed to a temp file rather than buffered so the size cap can be
        enforced as the bytes arrive.
        """
        work_dir = cfg.data_dir / "work"
        work_dir.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=work_dir, suffix=".upload")
        tmp_path = Path(tmp_name)
        try:
            total = 0
            with os.fdopen(fd, "wb") as fh:
                async for chunk in request.stream():
                    total += len(chunk)
                    if total > MAX_UPLOAD_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail=f"upload exceeds {MAX_UPLOAD_BYTES} bytes",
                        )
                    fh.write(chunk)
            if total == 0:
                raise HTTPException(status_code=400, detail="empty body")
            file_hash = blobstore.put_file(tmp_path)
        finally:
            tmp_path.unlink(missing_ok=True)
        return {"hash": file_hash, "size": total}

    @app.post("/songs")
    def put_song(
        song: SongUpload, conn: sqlite3.Connection = Depends(get_conn)
    ) -> dict[str, Any]:
        """Add or update one catalogue row. Idempotent on id.

        Rejects a tab hash with no blob behind it. The alternative is a
        catalogue row the phone will queue, fail to download, and retry
        forever with backoff -- a failure that surfaces on the wrong device,
        hours later, as a song that will not open.
        """
        if song.tab_format not in TAB_FORMATS:
            raise HTTPException(
                status_code=422,
                detail=f"unsupported tab_format {song.tab_format!r}",
            )
        if not blobstore.has(song.tab_blob_hash):
            raise HTTPException(
                status_code=422,
                detail=f"no blob stored for tab_blob_hash {song.tab_blob_hash}",
            )

        now = int(time.time() * 1000)
        existing = db.get_song(conn, song.id)
        # Set once, then preserved: added_at is when the song entered the
        # library, not when this row was last written.
        if existing is not None:
            added_at = existing["added_at"]
        elif song.added_at is not None:
            added_at = song.added_at
        else:
            added_at = now

        db.upsert_song(
            conn,
            song_id=song.id,
            title=song.title,
            artist=song.artist,
            album=song.album,
            source_id=song.source_id,
            source_external_id=song.source_external_id,
            source_url=song.source_url,
            tab_blob_hash=song.tab_blob_hash,
            tab_format=song.tab_format,
            default_track_index=song.default_track_index,
            target_tempo_bpm=song.target_tempo_bpm,
            added_at=added_at,
            updated_at=now,
        )
        row = db.get_song(conn, song.id)
        assert row is not None  # just written
        return _song_payload(row, [])

    @app.delete("/songs/{song_id}")
    def archive_song(
        song_id: str, conn: sqlite3.Connection = Depends(get_conn)
    ) -> dict[str, Any]:
        """Archive a song. Never deletes the row.

        ADR-003 ranks losing practice history as unacceptable where losing
        audio is an inconvenience. A sync that can hard-delete is a sync that
        can destroy months of practice data from one mistyped click in a
        desktop window, and no confirmation dialog makes that acceptable.
        """
        existing = db.get_song(conn, song_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="song not found")
        db.set_song_archived(conn, song_id, True, int(time.time() * 1000))
        return {"song_id": song_id, "archived": True}

    @app.get("/review-queue")
    def review_queue(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
        pending = db.list_matches_by_status(conn, "pending-review")
        grouped: dict[str, list[dict[str, Any]]] = {}
        for m in pending:
            source = db.get_source_audio(conn, m["fingerprint"])
            grouped.setdefault(m["song_id"], []).append(
                {
                    "fingerprint": m["fingerprint"],
                    "confidence": m["confidence"],
                    "source_audio": (
                        {
                            "path": source["path"],
                            "artist": source["artist"],
                            "title": source["title"],
                            "album": source["album"],
                        }
                        if source is not None
                        else None
                    ),
                }
            )
        entries = [
            {
                "song_id": song_id,
                "candidates": sorted(
                    candidates, key=lambda c: c["confidence"], reverse=True
                ),
            }
            for song_id, candidates in grouped.items()
        ]
        return {"entries": entries}

    @app.post("/review/{song_id}")
    def review(
        song_id: str,
        decision: ReviewDecision,
        conn: sqlite3.Connection = Depends(get_conn),
    ) -> dict[str, Any]:
        existing = db.get_match(conn, song_id, decision.fingerprint)
        if existing is None:
            raise HTTPException(status_code=404, detail="match not found")
        new_status = "confirmed" if decision.decision == "confirm" else "rejected"
        db.set_match_status(conn, song_id, decision.fingerprint, new_status)
        return {
            "song_id": song_id,
            "fingerprint": decision.fingerprint,
            "status": new_status,
        }

    @app.post("/events/backup")
    def events_backup(
        events: list[dict[str, Any]] = Body(...),
        conn: sqlite3.Connection = Depends(get_conn),
    ) -> dict[str, int]:
        received = 0
        for event in events:
            try:
                event_id = str(event["id"])
                ts = int(event["ts"])
                event_type = str(event["type"])
            except (KeyError, TypeError, ValueError) as exc:
                raise HTTPException(
                    status_code=422, detail=f"malformed event: {exc}"
                ) from exc
            db.insert_event_ignore(conn, event_id, ts, event_type, json.dumps(event))
            received += 1
        return {"received": received}

    @app.get("/events/since/{event_id}")
    def events_since(
        event_id: str, conn: sqlite3.Connection = Depends(get_conn)
    ) -> dict[str, Any]:
        rows = db.list_events_since(conn, event_id)
        return {"events": [json.loads(row["payload_json"]) for row in rows]}

    return app
