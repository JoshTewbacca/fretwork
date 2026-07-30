"""Tests for the ffmpeg output parsing.

The parsers take ffmpeg/ffprobe output as strings, so these run without ffmpeg
installed and without touching a real audio file. Sample text is copied from
actual ffmpeg output shapes.
"""

from __future__ import annotations

import pytest

from fretwork_ingest.audio import (
    AudioToolError,
    codec_extension,
    parse_duration_seconds,
    parse_lead_in_seconds,
)


class TestCodecExtension:
    def test_maps_the_supported_codecs(self) -> None:
        assert codec_extension("opus") == ".opus"
        assert codec_extension("aac") == ".m4a"

    def test_rejects_an_unknown_codec_by_name(self) -> None:
        with pytest.raises(AudioToolError, match="unknown audio codec"):
            codec_extension("flac")


class TestParseDuration:
    def test_reads_a_plain_duration(self) -> None:
        assert parse_duration_seconds("286.281000\n") == 286.281

    def test_rejects_na(self) -> None:
        assert parse_duration_seconds("N/A\n") is None

    def test_rejects_empty_output(self) -> None:
        assert parse_duration_seconds("") is None
        assert parse_duration_seconds("   \n") is None

    def test_rejects_a_non_positive_duration(self) -> None:
        # A zero-length read is a failed probe, not a zero-length song.
        assert parse_duration_seconds("0.000000") is None
        assert parse_duration_seconds("-1.5") is None


SILENCE_AT_START = """\
[silencedetect @ 000001f4] silence_start: 0
[silencedetect @ 000001f4] silence_end: 1.83267 | silence_duration: 1.83267
size=N/A time=00:04:46.28 bitrate=N/A speed=1.2e+03x
"""

SILENCE_ONLY_MID_SONG = """\
[silencedetect @ 000001f4] silence_start: 128.4
[silencedetect @ 000001f4] silence_end: 130.1 | silence_duration: 1.7
"""

SILENCE_AT_START_AND_MIDDLE = """\
[silencedetect @ 000001f4] silence_start: 0.001
[silencedetect @ 000001f4] silence_end: 2.5 | silence_duration: 2.499
[silencedetect @ 000001f4] silence_start: 128.4
[silencedetect @ 000001f4] silence_end: 130.1 | silence_duration: 1.7
"""

TINY_SILENCE_AT_START = """\
[silencedetect @ 000001f4] silence_start: 0
[silencedetect @ 000001f4] silence_end: 0.04 | silence_duration: 0.04
"""


class TestParseLeadIn:
    def test_finds_the_lead_in(self) -> None:
        assert parse_lead_in_seconds(SILENCE_AT_START) == 1.83267

    def test_ignores_silence_that_is_not_at_the_start(self) -> None:
        # A breakdown or an outro must not shift the whole alignment.
        assert parse_lead_in_seconds(SILENCE_ONLY_MID_SONG) == 0.0

    def test_takes_only_the_first_stretch(self) -> None:
        assert parse_lead_in_seconds(SILENCE_AT_START_AND_MIDDLE) == 2.5

    def test_ignores_a_blip(self) -> None:
        # Not worth an anchor, and encoders routinely produce a few ms.
        assert parse_lead_in_seconds(TINY_SILENCE_AT_START) == 0.0

    def test_handles_output_with_no_silence_at_all(self) -> None:
        assert parse_lead_in_seconds("size=N/A time=00:04:46.28\n") == 0.0

    def test_handles_a_start_with_no_matching_end(self) -> None:
        # Silence running to the end of the file logs no silence_end.
        assert parse_lead_in_seconds("[silencedetect] silence_start: 0\n") == 0.0
