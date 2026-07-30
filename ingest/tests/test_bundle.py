"""Tests for bundle building.

The encode step is stubbed out: what matters here is the SyncMap shape the
phone parses, the deterministic bundle id, and the database row. ffmpeg itself
is exercised by running the CLI against a real file, not by a unit test.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from fretwork_ingest import bundle as bundle_module
from fretwork_ingest import db
from fretwork_ingest.audio import EncodedAudio
from fretwork_ingest.blobstore import BlobStore
from fretwork_ingest.bundle import build_full_mix_bundle, start_only_sync_map

SONG_ID = "song-1"
FINGERPRINT = "a" * 64


class TestStartOnlySyncMap:
    def test_anchors_the_first_bar_to_where_the_music_starts(self) -> None:
        sync_map = start_only_sync_map(1833)

        assert sync_map["version"] == 1
        assert sync_map["points"] == [
            {
                "masterBarIndex": 0,
                "barOccurence": 0,
                "ratioPosition": 0,
                "audioMs": 1833,
                "source": "auto",
            }
        ]

    def test_is_flagged_for_review_because_tempo_is_unverified(self) -> None:
        # ADR-002 puts the trust line at 0.7. Knowing where the music starts
        # says nothing about whether the tab's tempo matches the recording.
        sync_map = start_only_sync_map(0)
        assert sync_map["status"] == "needs-review"
        assert sync_map["confidence"] < 0.7

    def test_still_emits_an_anchor_when_there_is_no_lead_in(self) -> None:
        sync_map = start_only_sync_map(0)
        assert sync_map["points"][0]["audioMs"] == 0


@pytest.fixture()
def stub_encode(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace the ffmpeg call with a file written straight to disk."""

    def fake_encode(source: Path, destination: Path, **kwargs: object) -> EncodedAudio:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"encoded-bytes-for-" + source.name.encode())
        return EncodedAudio(
            path=destination,
            duration_ms=286_281,
            bitrate_kbps=96,
            lead_in_ms=1833,
        )

    monkeypatch.setattr(bundle_module, "encode", fake_encode)


def _build(tmp_path: Path, source_name: str = "song.flac") -> tuple[object, Path]:
    source = tmp_path / source_name
    source.write_bytes(b"pretend audio")
    db_path = tmp_path / "fretwork.db"
    db.init_db(db_path)
    return source, db_path


@pytest.mark.usefixtures("stub_encode")
class TestBuildFullMixBundle:
    def test_writes_a_bundle_row_the_manifest_can_serve(self, tmp_path: Path) -> None:
        source, db_path = _build(tmp_path)
        conn = db.get_connection(db_path)
        try:
            built = build_full_mix_bundle(
                conn,
                BlobStore(tmp_path / "blobs"),
                song_id=SONG_ID,
                fingerprint=FINGERPRINT,
                source_path=source,
                work_dir=tmp_path / "work",
                now_ms=1_700_000_000_000,
            )
            rows = db.list_bundles_for_song(conn, SONG_ID)
        finally:
            conn.close()

        assert len(rows) == 1
        row = rows[0]
        assert row["backing_path"] == built.backing_hash
        # Separation has not run, so there is no guitar stem yet.
        assert row["guitar_path"] is None
        assert row["duration_ms"] == 286_281
        assert json.loads(row["sync_map_json"])["points"][0]["audioMs"] == 1833

    def test_stores_the_audio_in_the_blobstore(self, tmp_path: Path) -> None:
        source, db_path = _build(tmp_path)
        blobstore = BlobStore(tmp_path / "blobs")
        conn = db.get_connection(db_path)
        try:
            built = build_full_mix_bundle(
                conn,
                blobstore,
                song_id=SONG_ID,
                fingerprint=FINGERPRINT,
                source_path=source,
                work_dir=tmp_path / "work",
            )
        finally:
            conn.close()

        assert blobstore.has(built.backing_hash)

    def test_clears_its_scratch_file(self, tmp_path: Path) -> None:
        source, db_path = _build(tmp_path)
        work_dir = tmp_path / "work"
        conn = db.get_connection(db_path)
        try:
            build_full_mix_bundle(
                conn,
                BlobStore(tmp_path / "blobs"),
                song_id=SONG_ID,
                fingerprint=FINGERPRINT,
                source_path=source,
                work_dir=work_dir,
            )
        finally:
            conn.close()

        assert list(work_dir.glob("*-backing.*")) == []

    def test_rebuilding_replaces_rather_than_duplicates(self, tmp_path: Path) -> None:
        # The phone should never have to choose between two bundles for a song.
        source, db_path = _build(tmp_path)
        conn = db.get_connection(db_path)
        try:
            first = build_full_mix_bundle(
                conn,
                BlobStore(tmp_path / "blobs"),
                song_id=SONG_ID,
                fingerprint=FINGERPRINT,
                source_path=source,
                work_dir=tmp_path / "work",
            )
            second = build_full_mix_bundle(
                conn,
                BlobStore(tmp_path / "blobs"),
                song_id=SONG_ID,
                fingerprint=FINGERPRINT,
                source_path=source,
                work_dir=tmp_path / "work",
            )
            rows = db.list_bundles_for_song(conn, SONG_ID)
        finally:
            conn.close()

        assert first.bundle_id == second.bundle_id
        assert len(rows) == 1

    def test_refuses_a_missing_source(self, tmp_path: Path) -> None:
        _, db_path = _build(tmp_path)
        conn = db.get_connection(db_path)
        try:
            with pytest.raises(FileNotFoundError):
                build_full_mix_bundle(
                    conn,
                    BlobStore(tmp_path / "blobs"),
                    song_id=SONG_ID,
                    fingerprint=FINGERPRINT,
                    source_path=tmp_path / "gone.flac",
                    work_dir=tmp_path / "work",
                )
        finally:
            conn.close()
