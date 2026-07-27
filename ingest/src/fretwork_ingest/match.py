"""Fuzzy matching of local audio files to library tabs.

The library is small and hand-curated (per docs/00-milestone-plan.md M1
scope), so the matcher favours precision over recall: only strong matches
are auto-accepted, everything else waits for a human in the PWA review
queue. Never silently best-guess (see docs/01-data-model.md matches table
comment).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Optional

from rapidfuzz import fuzz

AUTO_THRESHOLD = 0.90

_BRACKETED_PAREN_RE = re.compile(r"\([^()]*\)")
_BRACKETED_SQUARE_RE = re.compile(r"\[[^\[\]]*\]")
_FEATURING_RE = re.compile(r"\b(feat\.?|ft\.?|featuring)\b.*$", re.IGNORECASE)
_PUNCTUATION_RE = re.compile(r"[^\w\s]", re.UNICODE)
_WHITESPACE_RE = re.compile(r"\s+")

# Qualifiers that mark a materially different *recording*, not just a
# different release of the same one. Normalization deliberately strips these
# so the candidate is still found, but a tab and an audio file that disagree
# about one of them must not be auto-accepted: a live or acoustic take has
# different timing and structure from the studio version the tab describes,
# and pairing them silently produces a play-along that will never line up.
# Beat tracking fails on exactly this material too (docs/adr/ADR-002).
_VARIANT_RE = re.compile(
    r"\b(live|acoustic|unplugged|demo|remix|instrumental|karaoke|"
    r"radio edit|single version|reprise|cover)\b",
    re.IGNORECASE,
)

# Highest score a recording-variant disagreement may reach. Below
# AUTO_THRESHOLD by construction, so these always reach the review queue.
VARIANT_MISMATCH_CAP = 0.85


def recording_variants(s: Optional[str]) -> frozenset[str]:
    """Recording-variant qualifiers present in a raw (un-normalized) title."""
    if not s:
        return frozenset()
    return frozenset(m.group(0).lower() for m in _VARIANT_RE.finditer(s))


def _strip_accents(s: str) -> str:
    decomposed = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def normalize(s: str) -> str:
    """Normalize a title/artist string for fuzzy comparison.

    Steps: strip accents, lowercase, drop bracketed/parenthesised qualifiers
    (e.g. "(remastered 2011)", "[live]", "(deluxe edition)"), drop a
    trailing "feat./ft./featuring X" clause, remove punctuation, collapse
    whitespace.
    """
    if not s:
        return ""

    result = _strip_accents(s)
    result = result.lower()
    result = _BRACKETED_PAREN_RE.sub(" ", result)
    result = _BRACKETED_SQUARE_RE.sub(" ", result)
    result = _FEATURING_RE.sub("", result)
    result = _PUNCTUATION_RE.sub("", result)
    result = _WHITESPACE_RE.sub(" ", result).strip()
    return result


def score_match(
    tab_artist: str,
    tab_title: str,
    audio_artist: Optional[str],
    audio_title: Optional[str],
) -> float:
    """Score a candidate tab against a scanned audio file, in 0..1.

    Uses rapidfuzz token_set_ratio over normalized strings, weighting title
    higher than artist (title 0.65, artist 0.35). If the audio file has no
    artist tag, score on title alone -- an artist mismatch against a missing
    tag should not be able to drag the score down.

    When the two titles disagree about a recording variant (one says "live"
    or "acoustic" and the other does not), the score is capped below the
    auto-accept threshold so a human confirms the pairing.
    """
    norm_tab_title = normalize(tab_title)
    norm_audio_title = normalize(audio_title or "")
    title_score = fuzz.token_set_ratio(norm_tab_title, norm_audio_title) / 100.0

    if not audio_artist or not audio_artist.strip():
        score = title_score
    else:
        norm_tab_artist = normalize(tab_artist)
        norm_audio_artist = normalize(audio_artist)
        artist_score = (
            fuzz.token_set_ratio(norm_tab_artist, norm_audio_artist) / 100.0
        )
        score = title_score * 0.65 + artist_score * 0.35

    if recording_variants(tab_title) != recording_variants(audio_title):
        score = min(score, VARIANT_MISMATCH_CAP)

    return score


def classify(score: float) -> str:
    """Map a score to a match status: 'auto' at or above the threshold.

    The threshold is deliberately high (0.90) and one-sided: nothing below
    it is ever auto-accepted, only ever routed to pending-review.
    """
    return "auto" if score >= AUTO_THRESHOLD else "pending-review"
