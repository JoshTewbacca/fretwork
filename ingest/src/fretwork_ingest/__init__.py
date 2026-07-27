"""Fretwork desktop ingest service.

Scans a local media folder for audio files, fuzzy-matches them against the
songs already in the PWA library, stores content-addressed blobs, and serves
a small LAN/tailnet HTTP API that the phone polls for updates.
"""

__version__ = "0.1.0"
