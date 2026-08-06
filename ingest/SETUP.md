# Fretwork ingest service -- setup

Desktop-side scanner, fuzzy matcher, blob store, and LAN/tailnet HTTP API for
Fretwork (see `docs/00-milestone-plan.md` Milestone 1 and
`docs/01-data-model.md` for the design this implements).

## 1. Create the virtualenv

Windows 10, PowerShell. Do not invoke bare `python` -- on this machine it
resolves to the Microsoft Store stub and fails. Use the `py` launcher to
create the venv, then always call the venv's own interpreter by full path
afterwards.

```powershell
cd A:\Songsterr\ingest
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip install -e .
```

The last step installs this package (`fretwork_ingest`) in editable mode so
`python -m fretwork_ingest.cli` and the `fretwork-ingest` console script both
work without further path setup.

Do **not** add `torch`, `demucs`, `madmom`, or `librosa` to this venv yet --
those are Milestone 3 (stem separation) and are multi-GB downloads; nothing
in Milestone 1 needs them.

## 2. Configure

Defaults live in `src/fretwork_ingest/config.py` and are intentionally
generic (no machine-specific paths committed to source control). To point
the scanner at your real media folder, create `ingest/config.local.json`
(gitignored) next to this file:

```json
{
  "media_root": "D:\\Music",
  "host": "0.0.0.0",
  "port": 8765
}
```

`data_dir` defaults to the `ingest/` folder itself, so the database lands at
`ingest/fretwork.db` and blobs at `ingest/blobs/` -- both already covered by
the repo's `.gitignore` rules, matching the "no ingest database, no audio in
the repo" hard rule from the milestone plan.

## 3. Initialize the database

```powershell
A:\Songsterr\ingest\.venv\Scripts\python.exe -m fretwork_ingest.cli init-db
```

Safe to re-run; schema creation is idempotent.

## 4. Scan your media folder

```powershell
A:\Songsterr\ingest\.venv\Scripts\python.exe -m fretwork_ingest.cli scan --root "D:\Music"
```

Prints a summary (scanned / tagged ok / missing tags / DRM-skipped /
errors) and lists any DRM-protected files found (`.m4p`, or FairPlay-tagged
`.m4a`) -- these are recorded so you know they exist, but are never
processed further; this service does not implement or attempt DRM
circumvention.

Omit `--root` to use `media_root` from `config.local.json`.

## 5. Run the API

```powershell
A:\Songsterr\ingest\.venv\Scripts\python.exe -m fretwork_ingest.cli serve --host 0.0.0.0 --port 8765
```

There is no authentication in v1 (see the comment at the top of
`src/fretwork_ingest/api.py`). This is deliberate: the service is meant to
bind only to your LAN and Tailscale tailnet interfaces, never the public
internet.

## 6. The library manager window

Where bought tab files go in. Drop a `.gp`/`.gpx`/`.gp5`/`.gp4`/`.gp3` or
MusicXML file on it, confirm what was read out of the file, and it becomes a
catalogue row the phone syncs (see `docs/04-library-manager.md` and
`docs/adr/ADR-006-library-ownership-and-sync.md`).

```powershell
A:\Songsterr\ingest\.venv\Scripts\python.exe -m fretwork_ingest.cli manager
```

This starts the API on a background thread and opens a window on it, so there
is one process to start and one to stop. It binds to `127.0.0.1` regardless of
`config.local.json` — a window on this machine has no reason to be reachable
from the network. Use `serve` when the phone needs to reach it.

The same page is served at `http://<host>:<port>/` by `serve`, so it also
works from a browser, including from the phone over the tailnet.

**Files are parsed by alphaTab, not by Python.** That gives one parser for the
whole project and means anything the drop zone accepts is by construction
something the player can open — a corrupt file is refused at the desk rather
than on the phone later. alphaTab's browser bundle is 1.1 MB of third-party
build output, so it is copied out of `app/node_modules` into the gitignored
`ingest/static/vendor/` on startup instead of being committed. If `app/`'s
dependencies are not installed, run:

```powershell
cd A:\Songsterr\app; npm install
```

Without it the manager still works, but you type the title, artist and tempo
in yourself instead of having them filled from the file. The window says so
when that is the case.

`pywebview` provides the window and is in `requirements.txt`. If it is not
installed the command explains how to install it and suggests `serve` plus a
browser as the alternative, rather than failing.

## 7. Status report

```powershell
A:\Songsterr\ingest\.venv\Scripts\python.exe -m fretwork_ingest.cli report
```

Prints counts from the current database: source_audio rows (and how many
are DRM-protected), matches by status, jobs, bundles.

## 8. Running the tests

```powershell
A:\Songsterr\ingest\.venv\Scripts\python.exe -m pytest tests -q
```

## 9. Tailscale (away-from-home access)

Milestone 1 also covers getting the phone to reach this service when you're
not on the home LAN. This part is interactive and has to be done by you
(Josh) directly -- signing into a Tailscale account isn't something an
agent can do on your behalf.

1. **Install Tailscale on the Windows desktop.** Download from
   https://tailscale.com/download/windows, install, and sign in
   (`tailscale up` from an elevated PowerShell, or via the tray app). Use
   whichever identity provider you want as the tailnet owner (Google,
   Microsoft, GitHub, or a Tailscale account) -- just make sure it's the
   same account you use on the phone in the next step.
2. **Install Tailscale on the iPhone.** Get it from the App Store, open it,
   and sign in with the **same account** used on the desktop so both
   devices land in the same tailnet.
3. **Find the desktop's tailnet address.** After both devices are signed
   in, run:
   ```powershell
   tailscale status
   ```
   or open the Tailscale admin console (https://login.tailscale.com/admin/machines)
   and note the desktop machine's tailnet IP (`100.x.y.z`) or its MagicDNS
   name (e.g. `desktop-name.tailnet-name.ts.net`). Either works as a host to
   reach `serve`'s port on.
4. **Bind the API to both interfaces.** `serve --host 0.0.0.0` (the
   default in `config.local.json` shown above) listens on every local
   interface, which covers the LAN address and the Tailscale interface at
   once -- no separate bind needed per network.
5. **Record both URLs in the PWA settings screen** (per
   `docs/00-milestone-plan.md` M1 and `docs/adr/ADR-003-offline-state-machine.md`):
   - LAN URL, e.g. `http://192.168.1.50:8765` -- used when the phone is on
     the home Wi-Fi (probed first, per ADR-003).
   - Tailscale URL, e.g. `http://100.x.y.z:8765` or
     `http://desktop-name.tailnet-name.ts.net:8765` -- used when away from
     home.

Windows Firewall may prompt to allow the Python process on private
networks the first time `serve` runs; allow it for Private networks (avoid
allowing Public, since the LAN interface should stay private-network-only).
