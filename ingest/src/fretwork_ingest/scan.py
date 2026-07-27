"""Media folder scanner.

Walks a folder for audio files, fingerprints each one, reads its tags, and
upserts the result into source_audio. DRM-protected files are recorded and
reported but never processed further -- no tag extraction is attempted on
them, and they never become match or job candidates.

This module never implements, suggests, or researches DRM circumvention. The
FairPlay check below is metadata-only: it looks at the MPEG-4 sample
description atom to see whether the audio is marked as protected, the same
information any media player reads before deciding it cannot play the file.
It never attempts to decode, decrypt, or otherwise access protected audio
bytes.
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import mutagen

from . import db
from .blobstore import sha256_file

AUDIO_EXTENSIONS = {".mp3", ".m4a", ".flac", ".wav", ".ogg", ".opus", ".aac", ".wma"}
DRM_EXTENSIONS = {".m4p"}
ALL_EXTENSIONS = AUDIO_EXTENSIONS | DRM_EXTENSIONS

# MPEG-4 sample-entry fourcc used for FairPlay-protected audio in place of
# the normal "mp4a" codec atom.
_FAIRPLAY_CODEC_PREFIX = "drms"


@dataclass
class ScanReport:
    scanned: list[str] = field(default_factory=list)
    tagged_ok: list[str] = field(default_factory=list)
    missing_tags: list[str] = field(default_factory=list)
    drm_skipped: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def scanned_count(self) -> int:
        return len(self.scanned)

    @property
    def tagged_ok_count(self) -> int:
        return len(self.tagged_ok)

    @property
    def missing_tags_count(self) -> int:
        return len(self.missing_tags)

    @property
    def drm_skipped_count(self) -> int:
        return len(self.drm_skipped)

    @property
    def error_count(self) -> int:
        return len(self.errors)


def _is_fairplay_protected_m4a(path: Path) -> bool:
    """Best-effort, metadata-only detection of FairPlay-protected .m4a.

    Checks the parsed MPEG-4 codec fourcc first; falls back to a raw scan
    for the protected sample-entry marker if mutagen cannot parse the file
    at all (which itself is common for protected files). Neither path reads
    or attempts to use the encrypted audio payload.
    """
    try:
        from mutagen.mp4 import MP4

        audio = MP4(path)
        codec = (getattr(audio.info, "codec", "") or "").lower()
        if codec.startswith(_FAIRPLAY_CODEC_PREFIX):
            return True
    except Exception:
        pass

    try:
        with path.open("rb") as fh:
            head = fh.read(1024 * 1024)
        return b"drms" in head
    except OSError:
        return False


def _read_tags(path: Path) -> tuple[Optional[str], Optional[str], Optional[str], Optional[int]]:
    """Return (artist, title, album, duration_ms) using mutagen's easy tags."""
    audio = mutagen.File(str(path), easy=True)
    if audio is None:
        raise ValueError("mutagen could not identify the file format")

    def _first(key: str) -> Optional[str]:
        values = audio.tags.get(key) if audio.tags else None
        if not values:
            return None
        return str(values[0]).strip() or None

    artist = _first("artist")
    title = _first("title")
    album = _first("album")
    duration_ms: Optional[int] = None
    if audio.info is not None and getattr(audio.info, "length", None):
        duration_ms = int(round(audio.info.length * 1000))
    return artist, title, album, duration_ms


def scan_media(root: Path, conn: sqlite3.Connection) -> ScanReport:
    """Walk root for audio files, fingerprint/tag/upsert each, and report.

    conn is an open connection (see db.get_connection) to the ingest
    database that rows are upserted into. This is an addition to the
    root-only signature sketched in the task brief: persistence needs a
    database handle, and threading one through explicitly (rather than a
    module-level global or a path re-opened per file) keeps the function
    testable against an in-memory or temp-file database.
    """
    report = ScanReport()

    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        ext = path.suffix.lower()
        if ext not in ALL_EXTENSIONS:
            continue

        path_str = str(path)
        is_drm = ext in DRM_EXTENSIONS or (ext == ".m4a" and _is_fairplay_protected_m4a(path))

        try:
            fingerprint = sha256_file(path)
        except OSError as exc:
            report.errors.append(f"{path_str}: {exc}")
            continue

        scanned_at = int(time.time() * 1000)

        if is_drm:
            db.upsert_source_audio(
                conn,
                fingerprint=fingerprint,
                path=path_str,
                artist=None,
                title=None,
                album=None,
                duration_ms=None,
                drm_protected=True,
                scanned_at=scanned_at,
            )
            report.drm_skipped.append(path_str)
            continue

        try:
            artist, title, album, duration_ms = _read_tags(path)
        except Exception as exc:  # mutagen raises many distinct error types
            report.errors.append(f"{path_str}: {exc}")
            db.upsert_source_audio(
                conn,
                fingerprint=fingerprint,
                path=path_str,
                artist=None,
                title=None,
                album=None,
                duration_ms=None,
                drm_protected=False,
                scanned_at=scanned_at,
            )
            report.missing_tags.append(path_str)
            continue

        db.upsert_source_audio(
            conn,
            fingerprint=fingerprint,
            path=path_str,
            artist=artist,
            title=title,
            album=album,
            duration_ms=duration_ms,
            drm_protected=False,
            scanned_at=scanned_at,
        )
        report.scanned.append(path_str)
        if artist and title:
            report.tagged_ok.append(path_str)
        else:
            report.missing_tags.append(path_str)

    return report
