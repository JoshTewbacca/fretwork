"""Tests for fretwork_ingest.blobstore: content-addressed round-trip."""

import hashlib
from pathlib import Path

from fretwork_ingest.blobstore import BlobStore, sha256_file


def test_sha256_file_matches_hashlib(tmp_path: Path) -> None:
    payload = b"some bytes that stand in for audio data" * 100
    src = tmp_path / "source.bin"
    src.write_bytes(payload)

    expected = hashlib.sha256(payload).hexdigest()
    assert sha256_file(src) == expected


def test_put_file_roundtrip(tmp_path: Path) -> None:
    store_root = tmp_path / "blobs"
    src = tmp_path / "audio.wav"
    payload = b"\x00\x01\x02\x03" * 1000
    src.write_bytes(payload)

    store = BlobStore(store_root)
    file_hash = store.put_file(src)

    assert file_hash == hashlib.sha256(payload).hexdigest()
    assert store.has(file_hash)

    retrieved_path = store.get_path(file_hash)
    assert retrieved_path is not None
    assert retrieved_path.read_bytes() == payload

    # Layout: blobs/<first2>/<hash>
    assert retrieved_path.parent.name == file_hash[:2]
    assert retrieved_path.name == file_hash


def test_get_path_missing_hash_returns_none(tmp_path: Path) -> None:
    store = BlobStore(tmp_path / "blobs")
    assert store.get_path("0" * 64) is None
    assert store.has("0" * 64) is False


def test_put_file_is_idempotent(tmp_path: Path) -> None:
    src = tmp_path / "audio.wav"
    src.write_bytes(b"same content")
    store = BlobStore(tmp_path / "blobs")

    hash1 = store.put_file(src)
    hash2 = store.put_file(src)

    assert hash1 == hash2
    assert store.get_path(hash1) is not None


def test_dedupes_identical_content_different_names(tmp_path: Path) -> None:
    payload = b"identical audio bytes"
    a = tmp_path / "a.wav"
    b = tmp_path / "b.wav"
    a.write_bytes(payload)
    b.write_bytes(payload)

    store = BlobStore(tmp_path / "blobs")
    hash_a = store.put_file(a)
    hash_b = store.put_file(b)

    assert hash_a == hash_b
