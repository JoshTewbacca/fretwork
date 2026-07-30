"""The ingest service's HTTP API.

Security note: there is no authentication in v1. Per docs/01-data-model.md
and docs/00-milestone-plan.md (Milestone 1), this is a personal, single-user
service that binds to the LAN and/or Tailscale tailnet interface only -- it
is never exposed to the public internet, so the trust boundary is "on my
network", not "has a token". If this service is ever bound to a public
interface, authentication must be added before that happens.

Endpoint set is exactly the list in docs/01-data-model.md:
GET /health, GET /manifest, GET /blob/{hash}, GET /review-queue,
POST /review/{song_id}, POST /events/backup, GET /events/since/{event_id}.

Interpretation note on /manifest: the desktop schema has no "songs" table
(song metadata lives in the PWA's IndexedDB) -- the desktop only knows a
song_id once a match links it to a fingerprint. "songs plus bundle ids and
blob hashes" is therefore built from confirmed/auto matches (joined with
source_audio for display context) plus any bundles for that song_id, not
from a local songs table.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Iterator, Literal, Sequence

from fastapi import Body, Depends, FastAPI, HTTPException
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


class ReviewDecision(BaseModel):
    fingerprint: str
    decision: Literal["confirm", "reject"]


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
                        songs[song_id]["bundles"].append(
                            {
                                "id": b["id"],
                                "backing_hash": b["backing_path"],
                                "guitar_hash": b["guitar_path"],
                                "duration_ms": b["duration_ms"],
                                # The phone needs this to place bars in the
                                # audio; without it a bundle is unplayable.
                                "sync_map": (
                                    json.loads(b["sync_map_json"])
                                    if b["sync_map_json"]
                                    else None
                                ),
                                "created_at": b["created_at"],
                            }
                        )
        return {"songs": list(songs.values())}

    @app.get("/blob/{file_hash}")
    def get_blob(file_hash: str) -> FileResponse:
        path = blobstore.get_path(file_hash)
        if path is None:
            raise HTTPException(status_code=404, detail="blob not found")
        return FileResponse(path=path, media_type="application/octet-stream")

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
