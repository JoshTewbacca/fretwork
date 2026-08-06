"""Command-line entry points for the ingest service.

Usage (from the ingest/ directory, using the venv interpreter directly):

    .venv\\Scripts\\python.exe -m fretwork_ingest.cli init-db
    .venv\\Scripts\\python.exe -m fretwork_ingest.cli scan --root "D:\\Music"
    .venv\\Scripts\\python.exe -m fretwork_ingest.cli serve --host 0.0.0.0 --port 8765
    .venv\\Scripts\\python.exe -m fretwork_ingest.cli manager
    .venv\\Scripts\\python.exe -m fretwork_ingest.cli report
    .venv\\Scripts\\python.exe -m fretwork_ingest.cli bundle --song-id <id> \\
        --fingerprint <sha>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__, db
from .api import create_app
from .audio import AudioToolError
from .blobstore import BlobStore
from .bundle import build_full_mix_bundle
from .config import Config
from .manager_assets import ensure_alphatab
from .manager_window import run_manager_window
from .scan import scan_media


def _cmd_init_db(args: argparse.Namespace) -> int:
    cfg = Config.load()
    cfg.ensure_dirs()
    db.init_db(cfg.db_path)
    print(f"database ready at {cfg.db_path}")
    return 0


def _cmd_scan(args: argparse.Namespace) -> int:
    cfg = Config.load()
    cfg.ensure_dirs()
    db.init_db(cfg.db_path)

    root = Path(args.root) if args.root else cfg.media_root
    if not root.exists():
        print(f"media root does not exist: {root}", file=sys.stderr)
        return 1

    conn = db.get_connection(cfg.db_path)
    try:
        report = scan_media(root, conn)
    finally:
        conn.close()

    print(f"scanned root: {root}")
    print(f"  scanned:      {report.scanned_count}")
    print(f"  tagged ok:    {report.tagged_ok_count}")
    print(f"  missing tags: {report.missing_tags_count}")
    print(f"  drm skipped:  {report.drm_skipped_count}")
    print(f"  errors:       {report.error_count}")

    if report.drm_skipped:
        print("\nDRM-protected files (never processed further):")
        for path in report.drm_skipped:
            print(f"  {path}")

    if report.errors:
        print("\nerrors:")
        for line in report.errors:
            print(f"  {line}")

    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    cfg = Config.load()
    if args.host:
        cfg.host = args.host
    if args.port:
        cfg.port = args.port

    print(ensure_alphatab().message)
    app = create_app(cfg)
    print(f"serving on {cfg.host}:{cfg.port} (no auth -- LAN/tailnet only, see api.py)")
    print(f"manager UI at http://{cfg.host}:{cfg.port}/")
    uvicorn.run(app, host=cfg.host, port=cfg.port)
    return 0


def _cmd_manager(args: argparse.Namespace) -> int:
    cfg = Config.load()
    if args.port:
        cfg.port = args.port
    return run_manager_window(cfg)


def _cmd_report(args: argparse.Namespace) -> int:
    cfg = Config.load()
    cfg.ensure_dirs()
    db.init_db(cfg.db_path)

    conn = db.get_connection(cfg.db_path)
    try:
        source_rows = db.list_source_audio(conn)
        drm_count = sum(1 for r in source_rows if r["drm_protected"])
        auto = db.list_matches_by_status(conn, "auto")
        pending = db.list_matches_by_status(conn, "pending-review")
        confirmed = db.list_matches_by_status(conn, "confirmed")
        rejected = db.list_matches_by_status(conn, "rejected")
        jobs = db.list_jobs(conn)
        bundles = db.list_bundles(conn)
    finally:
        conn.close()

    print(f"fretwork ingest report (version {__version__})")
    print(f"database: {cfg.db_path}")
    print(f"source_audio: {len(source_rows)} files ({drm_count} drm-protected)")
    print(
        "matches: "
        f"{len(auto)} auto, {len(pending)} pending-review, "
        f"{len(confirmed)} confirmed, {len(rejected)} rejected"
    )
    print(f"jobs: {len(jobs)}")
    print(f"bundles: {len(bundles)}")
    return 0


def _cmd_bundle(args: argparse.Namespace) -> int:
    """Encode a matched recording into a playable bundle for one song."""
    cfg = Config.load()
    cfg.ensure_dirs()
    db.init_db(cfg.db_path)
    conn = db.get_connection(cfg.db_path)
    try:
        source = db.get_source_audio(conn, args.fingerprint)
        if source is None:
            print(
                f"no scanned audio with fingerprint {args.fingerprint}; run scan first",
                file=sys.stderr,
            )
            return 1
        if source["drm_protected"]:
            print("that file is DRM protected and cannot be decoded", file=sys.stderr)
            return 1

        try:
            built = build_full_mix_bundle(
                conn,
                BlobStore(cfg.blob_dir),
                song_id=args.song_id,
                fingerprint=args.fingerprint,
                source_path=Path(source["path"]),
                work_dir=cfg.data_dir / "work",
                codec=cfg.audio_codec,
                bitrate_kbps=cfg.audio_bitrate_kbps,
            )
        except (AudioToolError, FileNotFoundError) as exc:
            print(str(exc), file=sys.stderr)
            return 1
    finally:
        conn.close()

    seconds = built.duration_ms / 1000
    lead_in = built.sync_map["points"][0]["audioMs"]
    print(f"bundle {built.bundle_id}")
    print(f"  song      {built.song_id}")
    print(f"  backing   {built.backing_hash}")
    print(f"  duration  {seconds:.1f}s")
    print(f"  lead-in   {lead_in} ms")
    print(f"  sync      {built.sync_map['status']} (start aligned, tempo unverified)")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="fretwork_ingest", description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    scan_parser = subparsers.add_parser("scan", help="scan a media folder into source_audio")
    scan_parser.add_argument(
        "--root", type=str, default=None, help="folder to scan (defaults to config media_root)"
    )
    scan_parser.set_defaults(func=_cmd_scan)

    serve_parser = subparsers.add_parser("serve", help="run the HTTP API")
    serve_parser.add_argument("--host", type=str, default=None)
    serve_parser.add_argument("--port", type=int, default=None)
    serve_parser.set_defaults(func=_cmd_serve)

    manager_parser = subparsers.add_parser(
        "manager", help="open the library manager window (drop tab files in)"
    )
    manager_parser.add_argument("--port", type=int, default=None)
    manager_parser.set_defaults(func=_cmd_manager)

    report_parser = subparsers.add_parser("report", help="print a summary of the ingest database")
    report_parser.set_defaults(func=_cmd_report)

    init_db_parser = subparsers.add_parser("init-db", help="create the database schema if absent")
    init_db_parser.set_defaults(func=_cmd_init_db)

    bundle_parser = subparsers.add_parser(
        "bundle", help="encode a matched recording into a playable audio bundle"
    )
    bundle_parser.add_argument(
        "--song-id", type=str, required=True, help="the PWA song id to attach the bundle to"
    )
    bundle_parser.add_argument(
        "--fingerprint", type=str, required=True, help="fingerprint of the scanned source audio"
    )
    bundle_parser.set_defaults(func=_cmd_bundle)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
