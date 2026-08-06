"""Getting alphaTab into the manager window without committing it.

The manager parses dropped tab files with alphaTab rather than a Python
parser (docs/04-library-manager.md): PyGuitarPro does not read the GP6/7+
container formats, and a second parser would have to be kept in step with the
one the player already uses. Parsing client-side means one parser for the
project, and anything the drop zone accepts is by construction something the
player can open.

That needs alphaTab's browser bundle next to the manager page. It is a 1.1 MB
third-party build artifact, and this repo is public and holds source only, so
it is copied out of the PWA's node_modules at serve time into a gitignored
vendor directory rather than committed.

If it cannot be found the manager still works -- the drop zone falls back to
the file extension for the format and an empty form for the metadata. Losing
auto-fill is an inconvenience; refusing to start over a missing convenience
would not be.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path

ALPHATAB_BUNDLE = "alphaTab.min.js"

# Where npm puts it, relative to the repo root.
_SOURCE_RELATIVE = Path("app/node_modules/@coderline/alphatab/dist") / ALPHATAB_BUNDLE


def static_dir() -> Path:
    """The manager's static assets, shipped in the package."""
    return Path(__file__).resolve().parent.parent.parent / "static"


def vendor_dir() -> Path:
    return static_dir() / "vendor"


def _repo_root() -> Path:
    # ingest/src/fretwork_ingest/ -> ingest/ -> repo root
    return Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class VendorResult:
    available: bool
    message: str


def ensure_alphatab(repo_root: Path | None = None) -> VendorResult:
    """Copy alphaTab's browser bundle into static/vendor/ if it is not there.

    Returns whether the manager will have it, and a line worth printing.
    Never raises: a missing bundle degrades the manager, it does not break it.
    """
    destination = vendor_dir() / ALPHATAB_BUNDLE
    if destination.is_file():
        return VendorResult(True, f"alphaTab bundle present at {destination}")

    source = (repo_root or _repo_root()) / _SOURCE_RELATIVE
    if not source.is_file():
        return VendorResult(
            False,
            f"alphaTab bundle not found at {source} -- the manager will still "
            "accept files but cannot read the title, artist or tempo out of "
            "them. Run 'npm install' in app/ to fix.",
        )

    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    except OSError as exc:
        return VendorResult(False, f"could not copy the alphaTab bundle: {exc}")

    return VendorResult(True, f"copied the alphaTab bundle to {destination}")


def alphatab_available() -> bool:
    return (vendor_dir() / ALPHATAB_BUNDLE).is_file()
