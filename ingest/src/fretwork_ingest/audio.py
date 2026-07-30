"""ffmpeg/ffprobe wrappers for building playable audio out of source files.

Deliberately shells out to the ffmpeg CLI rather than taking a Python audio
dependency: ffmpeg is already a stated prerequisite (docs/00-milestone-plan.md)
and this keeps the first half of Milestone 3 free of torch, librosa and the
2.5 GB of CUDA wheels that stem separation will need.

Everything that parses ffmpeg output is a module-level function taking the
output as a string, so the parsing is unit tested without running ffmpeg.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

# Opus at this rate is transparent enough for practice backing and keeps a
# four-minute song around 3 MB, which matters on a phone storage budget.
DEFAULT_BITRATE_KBPS = 96

# Opus is the better codec per bit and is what the plan specifies, but it rides
# in an Ogg container and iOS Safari only learned to play those relatively
# recently. AAC is the universally safe fallback: if a bundle will not play on
# the phone, switch `audio_codec` in config.local.json and rebuild rather than
# changing code.
CODECS: dict[str, tuple[str, str]] = {
    # name: (ffmpeg encoder, file extension)
    "opus": ("libopus", ".opus"),
    "aac": ("aac", ".m4a"),
}
DEFAULT_CODEC = "opus"


def codec_extension(codec: str) -> str:
    try:
        return CODECS[codec][1]
    except KeyError:
        raise AudioToolError(
            f"unknown audio codec {codec!r}; choose one of {', '.join(sorted(CODECS))}"
        ) from None

# Anything below this counts as silence when looking for the lead-in. Real
# recordings have a noise floor, so an absolute-zero test finds nothing.
SILENCE_THRESHOLD_DB = -40

# Ignore blips: a lead-in worth correcting for is at least this long.
MIN_SILENCE_SECONDS = 0.15


class AudioToolError(RuntimeError):
    """Raised when ffmpeg or ffprobe is missing or fails, or a codec is unknown."""


@dataclass(frozen=True)
class EncodedAudio:
    path: Path
    duration_ms: int
    bitrate_kbps: int
    """Milliseconds of silence before the music starts, 0 if it starts clean."""
    lead_in_ms: int


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            capture_output=True,
            text=True,
            check=False,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError as exc:
        raise AudioToolError(
            f"{args[0]} is not on PATH. Install ffmpeg and reopen the shell."
        ) from exc


def parse_duration_seconds(ffprobe_stdout: str) -> float | None:
    """Read the duration ffprobe prints with -of default=nokey=1."""
    text = ffprobe_stdout.strip()
    if not text:
        return None
    try:
        value = float(text.splitlines()[0])
    except ValueError:
        return None
    # ffprobe reports "N/A" as a parse failure above; a non-positive duration is
    # equally unusable and should not be mistaken for a zero-length song.
    return value if value > 0 else None


_SILENCE_START = re.compile(r"silence_start:\s*(-?[\d.]+)")
_SILENCE_END = re.compile(r"silence_end:\s*([\d.]+)")


def parse_lead_in_seconds(silencedetect_stderr: str) -> float:
    """Length of the silence at the very start of the file, or 0.0.

    silencedetect logs every silent stretch. Only one interests us: a stretch
    that begins at (or a hair after) zero, because that is the lead-in the
    first sync anchor has to account for. Silence later in the song is a
    breakdown or an outro and must not shift the whole alignment.
    """
    starts = [float(m.group(1)) for m in _SILENCE_START.finditer(silencedetect_stderr)]
    ends = [float(m.group(1)) for m in _SILENCE_END.finditer(silencedetect_stderr)]
    if not starts or not ends:
        return 0.0
    # Tolerate a tiny offset: encoders often report the first start at ~0.001.
    if starts[0] > 0.05:
        return 0.0
    lead_in = ends[0]
    return lead_in if lead_in >= MIN_SILENCE_SECONDS else 0.0


def probe_duration_ms(source: Path, ffprobe: str = "ffprobe") -> int:
    result = _run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(source),
        ]
    )
    seconds = parse_duration_seconds(result.stdout)
    if seconds is None:
        raise AudioToolError(f"could not read a duration from {source.name}")
    return int(round(seconds * 1000))


def detect_lead_in_ms(source: Path, ffmpeg: str = "ffmpeg") -> int:
    """Milliseconds before the music starts.

    Used as the audio-side position of the first sync anchor, which is what
    stops the cursor running ahead of a recording that opens with silence or a
    count-in. Cheap enough to be worth doing without a beat tracker.
    """
    result = _run(
        [
            ffmpeg,
            "-hide_banner",
            "-nostats",
            "-i",
            str(source),
            "-af",
            f"silencedetect=noise={SILENCE_THRESHOLD_DB}dB:d={MIN_SILENCE_SECONDS}",
            "-f",
            "null",
            "-",
        ]
    )
    # silencedetect writes to stderr; a non-zero exit here is not fatal for the
    # pipeline, it just means we assume no lead-in.
    return int(round(parse_lead_in_seconds(result.stderr) * 1000))


def encode(
    source: Path,
    destination: Path,
    bitrate_kbps: int = DEFAULT_BITRATE_KBPS,
    codec: str = DEFAULT_CODEC,
    ffmpeg: str = "ffmpeg",
    ffprobe: str = "ffprobe",
) -> EncodedAudio:
    """Transcode any source file to a compressed, metadata-stripped audio file."""
    if codec not in CODECS:
        raise AudioToolError(
            f"unknown audio codec {codec!r}; choose one of {', '.join(sorted(CODECS))}"
        )
    encoder = CODECS[codec][0]
    destination.parent.mkdir(parents=True, exist_ok=True)
    codec_args = (
        ["-vbr", "on", "-application", "audio"] if encoder == "libopus" else ["-movflags", "+faststart"]
    )
    result = _run(
        [
            ffmpeg,
            "-hide_banner",
            "-nostats",
            "-y",
            "-i",
            str(source),
            "-vn",
            # Strip tags: artwork in particular can be megabytes, and none of it
            # is read on the phone.
            "-map_metadata",
            "-1",
            "-c:a",
            encoder,
            "-b:a",
            f"{bitrate_kbps}k",
            *codec_args,
            str(destination),
        ]
    )
    if result.returncode != 0 or not destination.exists():
        raise AudioToolError(
            f"ffmpeg failed to encode {source.name}: {result.stderr.strip()[-400:]}"
        )
    return EncodedAudio(
        path=destination,
        # Measure the output, not the input: the encoder is what decides the
        # length the phone will actually play, and sync is against that.
        duration_ms=probe_duration_ms(destination, ffprobe=ffprobe),
        bitrate_kbps=bitrate_kbps,
        lead_in_ms=detect_lead_in_ms(source, ffmpeg=ffmpeg),
    )
