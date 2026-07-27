"""Content-addressed blob store.

Files are stored under ``<data_dir>/blobs/<first2>/<hash>`` keyed by the
streaming SHA-256 of their bytes, matching the "blobs are content-addressed"
design rule in docs/01-data-model.md. Dedup and integrity checking fall out
of the addressing scheme for free.
"""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import Optional

_CHUNK_SIZE = 1024 * 1024  # 1 MiB


def sha256_file(path: Path) -> str:
    """Stream a file through SHA-256 in chunks; never loads it whole."""
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(_CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


class BlobStore:
    """Content-addressed store rooted at a configurable directory."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _blob_path(self, file_hash: str) -> Path:
        return self.root / file_hash[:2] / file_hash

    def put_file(self, path: Path) -> str:
        """Copy path's bytes into the store, return the content hash.

        Idempotent: re-putting a file already present is a cheap no-op after
        the hash is computed.
        """
        file_hash = sha256_file(path)
        dest = self._blob_path(file_hash)
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, dest)
        return file_hash

    def get_path(self, file_hash: str) -> Optional[Path]:
        """Return the on-disk path for a hash, or None if absent."""
        candidate = self._blob_path(file_hash)
        return candidate if candidate.is_file() else None

    def has(self, file_hash: str) -> bool:
        return self.get_path(file_hash) is not None
