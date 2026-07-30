"""Runtime configuration for the ingest service.

Defaults are Windows-friendly but deliberately generic (no machine-specific
absolute paths committed to source control). Local overrides -- including any
real media folder path -- belong in ``config.local.json`` next to this
package's project root, which is gitignored.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, fields
from pathlib import Path

CONFIG_FILENAME = "config.local.json"


def _ingest_root() -> Path:
    """Return the ingest/ project root (parent of src/fretwork_ingest/.. )."""
    return Path(__file__).resolve().parents[2]


def _default_media_root() -> Path:
    # A reasonable, non-machine-specific guess. Override via config.local.json.
    return Path.home() / "Music"


def _default_data_dir() -> Path:
    # docs/01-data-model.md specifies the db path as ingest/fretwork.db
    # directly (not a subfolder) -- this also matters for the repo's root
    # .gitignore, whose `ingest/*.db` pattern only matches files directly
    # under ingest/, not a nested data/ directory.
    return _ingest_root()


@dataclass
class Config:
    """Ingest service configuration.

    media_root: folder the scanner walks for audio files.
    data_dir: where fretwork.db and the blob store live.
    host: interface the API binds to (LAN/tailnet only -- see api.py).
    port: API port.
    demucs_segment_size: seconds per Demucs processing segment. Stored now so
        the schema and config surface are stable; not consumed until
        stem separation is added.
    audio_codec: "opus" (default, better per bit) or "aac". Opus rides in an Ogg
        container that older iOS Safari cannot play; if a bundle refuses to play
        on the phone, set this to "aac" and rebuild rather than editing code.
    audio_bitrate_kbps: encode rate for bundle audio.
    """

    media_root: Path = field(default_factory=_default_media_root)
    data_dir: Path = field(default_factory=_default_data_dir)
    host: str = "127.0.0.1"
    port: int = 8765
    demucs_segment_size: int = 7
    audio_codec: str = "opus"
    audio_bitrate_kbps: int = 96

    @property
    def db_path(self) -> Path:
        return self.data_dir / "fretwork.db"

    @property
    def blob_dir(self) -> Path:
        return self.data_dir / "blobs"

    @classmethod
    def load(cls, config_path: Path | None = None) -> "Config":
        """Build a Config, applying overrides from config.local.json if present.

        config_path defaults to <ingest-root>/config.local.json. Unknown keys
        in the JSON file are ignored; path-typed fields are coerced to Path.
        """
        cfg = cls()
        if config_path is None:
            config_path = _ingest_root() / CONFIG_FILENAME
        if not config_path.exists():
            return cfg

        with config_path.open("r", encoding="utf-8") as fh:
            overrides = json.load(fh)

        path_fields = {"media_root", "data_dir"}
        valid_names = {f.name for f in fields(cls)}
        for key, value in overrides.items():
            if key not in valid_names:
                continue
            if key in path_fields and value is not None:
                value = Path(value)
            setattr(cfg, key, value)
        return cfg

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.blob_dir.mkdir(parents=True, exist_ok=True)
