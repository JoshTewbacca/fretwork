"""Building audio bundles: the desktop half of Milestone 3.

A bundle is what the phone downloads to play along to the real recording
instead of the synth: the audio, its duration, and a SyncMap telling alphaTab
where bars sit in that audio.

This module handles the full-mix bundle, which needs nothing but ffmpeg. Stem
separation (Demucs) and beat tracking will extend the same bundle rather than
replace it: `guitar_path` stays null until separation runs, and the SyncMap
gains anchors when a beat tracker runs. Both are additive, so a bundle built
today keeps working and gets better.

The SyncMap shape mirrors the PWA's `SyncMap` in app/src/core/types.ts. Keep
them in step: the phone parses this JSON directly.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from . import db
from .audio import DEFAULT_BITRATE_KBPS, DEFAULT_CODEC, EncodedAudio, codec_extension, encode
from .blobstore import BlobStore

# ADR-002: below 0.7 a map is 'needs-review' rather than trusted. A full-mix
# bundle has only its start verified -- we know where the music begins, but
# nothing has checked that the tab's tempo matches the recording's -- so it
# sits deliberately below the line until a beat tracker or the user says
# otherwise.
START_ONLY_CONFIDENCE = 0.5


@dataclass(frozen=True)
class BuiltBundle:
    bundle_id: str
    song_id: str
    fingerprint: str
    backing_hash: str
    duration_ms: int
    sync_map: dict[str, Any]


def start_only_sync_map(lead_in_ms: int) -> dict[str, Any]:
    """A SyncMap anchoring only the first bar to where the music starts.

    With one anchor alphaTab maps the two time axes linearly from it (see
    docs/03-alphatab-notes.md), so a recording whose tempo matches the tab
    tracks correctly for its whole length, and one whose tempo does not drifts
    steadily -- which is exactly what 'needs-review' is there to flag.
    """
    return {
        "version": 1,
        "points": [
            {
                "masterBarIndex": 0,
                "barOccurence": 0,
                "ratioPosition": 0,
                "audioMs": lead_in_ms,
                "source": "auto",
            }
        ],
        "confidence": START_ONLY_CONFIDENCE,
        "status": "needs-review",
    }


def build_full_mix_bundle(
    conn: sqlite3.Connection,
    blobstore: BlobStore,
    song_id: str,
    fingerprint: str,
    source_path: Path,
    work_dir: Path,
    codec: str = DEFAULT_CODEC,
    bitrate_kbps: int = DEFAULT_BITRATE_KBPS,
    now_ms: Optional[int] = None,
) -> BuiltBundle:
    """Encode a source recording and record it as a bundle for `song_id`."""
    if not source_path.exists():
        raise FileNotFoundError(f"source audio is missing: {source_path}")

    work_dir.mkdir(parents=True, exist_ok=True)
    # Named by fingerprint so a re-run overwrites its own scratch file rather
    # than accumulating one per attempt.
    encoded_path = work_dir / f"{fingerprint}-backing{codec_extension(codec)}"
    encoded: EncodedAudio = encode(
        source_path, encoded_path, bitrate_kbps=bitrate_kbps, codec=codec
    )

    backing_hash = blobstore.put_file(encoded.path)
    encoded_path.unlink(missing_ok=True)

    sync_map = start_only_sync_map(encoded.lead_in_ms)
    # Deterministic in the song+fingerprint pair so rebuilding replaces the
    # bundle instead of leaving the phone to choose between two of them.
    bundle_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"fretwork:{song_id}:{fingerprint}"))
    created_at = now_ms if now_ms is not None else int(time.time() * 1000)

    db.upsert_bundle(
        conn,
        bundle_id=bundle_id,
        song_id=song_id,
        fingerprint=fingerprint,
        backing_path=backing_hash,
        guitar_path=None,
        duration_ms=encoded.duration_ms,
        sync_map_json=json.dumps(sync_map),
        created_at=created_at,
    )

    return BuiltBundle(
        bundle_id=bundle_id,
        song_id=song_id,
        fingerprint=fingerprint,
        backing_hash=backing_hash,
        duration_ms=encoded.duration_ms,
        sync_map=sync_map,
    )
