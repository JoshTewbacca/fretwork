"""Tests for fretwork_ingest.scan: media walk, fingerprinting, DRM handling."""

from pathlib import Path

from fretwork_ingest import db
from fretwork_ingest.scan import scan_media


def _init_conn(tmp_path: Path):
    db_path = tmp_path / "fretwork.db"
    db.init_db(db_path)
    return db.get_connection(db_path)


def test_m4p_extension_is_always_drm_skipped(tmp_path: Path) -> None:
    media_root = tmp_path / "media"
    media_root.mkdir()
    (media_root / "protected_song.m4p").write_bytes(b"not real audio bytes")

    conn = _init_conn(tmp_path)
    try:
        report = scan_media(media_root, conn)

        assert report.drm_skipped_count == 1
        assert str(media_root / "protected_song.m4p") in report.drm_skipped
        assert report.scanned_count == 0
        assert report.tagged_ok_count == 0

        rows = db.list_source_audio(conn)
        assert len(rows) == 1
        assert rows[0]["drm_protected"] == 1
        assert rows[0]["artist"] is None
        assert rows[0]["title"] is None
    finally:
        conn.close()


def test_m4a_with_fairplay_marker_is_drm_skipped(tmp_path: Path) -> None:
    media_root = tmp_path / "media"
    media_root.mkdir()
    # Not a real MPEG-4 container -- mutagen.mp4.MP4() will fail to parse it,
    # which exercises the raw-byte-scan fallback in _is_fairplay_protected_m4a.
    # The "drms" fourcc is the real-world marker FairPlay-protected audio
    # atoms use in place of "mp4a"; this test only checks the file is
    # recognised and skipped, it never decodes or decrypts anything.
    fake_protected = b"junkjunk" + b"drms" + b"more junk padding" * 20
    (media_root / "fairplay_song.m4a").write_bytes(fake_protected)

    conn = _init_conn(tmp_path)
    try:
        report = scan_media(media_root, conn)

        assert report.drm_skipped_count == 1
        assert report.scanned_count == 0

        rows = db.list_source_audio(conn)
        assert len(rows) == 1
        assert rows[0]["drm_protected"] == 1
    finally:
        conn.close()


def test_ordinary_m4a_without_marker_is_not_flagged_as_drm(tmp_path: Path) -> None:
    media_root = tmp_path / "media"
    media_root.mkdir()
    (media_root / "plain.m4a").write_bytes(b"just some bytes, no marker here" * 10)

    conn = _init_conn(tmp_path)
    try:
        report = scan_media(media_root, conn)

        assert report.drm_skipped_count == 0
        # mutagen can't identify this as a real MP4/M4A, so tag reading
        # fails -- it should land in errors + missing_tags, not crash the scan.
        assert report.error_count == 1
        assert report.missing_tags_count == 1

        rows = db.list_source_audio(conn)
        assert len(rows) == 1
        assert rows[0]["drm_protected"] == 0
    finally:
        conn.close()


def test_scan_ignores_non_audio_extensions(tmp_path: Path) -> None:
    media_root = tmp_path / "media"
    media_root.mkdir()
    (media_root / "notes.txt").write_text("not audio")
    (media_root / "cover.jpg").write_bytes(b"\xff\xd8\xff")

    conn = _init_conn(tmp_path)
    try:
        report = scan_media(media_root, conn)
        assert report.scanned_count == 0
        assert report.drm_skipped_count == 0
        assert report.error_count == 0
        assert db.list_source_audio(conn) == []
    finally:
        conn.close()


def test_scan_recurses_into_subfolders(tmp_path: Path) -> None:
    media_root = tmp_path / "media"
    nested = media_root / "Artist" / "Album"
    nested.mkdir(parents=True)
    (nested / "track.m4p").write_bytes(b"drm placeholder")

    conn = _init_conn(tmp_path)
    try:
        report = scan_media(media_root, conn)
        assert report.drm_skipped_count == 1
    finally:
        conn.close()
