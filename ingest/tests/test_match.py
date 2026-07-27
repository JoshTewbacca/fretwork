"""Tests for fretwork_ingest.match: normalize, score_match, classify."""

from fretwork_ingest.match import (
    AUTO_THRESHOLD,
    VARIANT_MISMATCH_CAP,
    classify,
    normalize,
    recording_variants,
    score_match,
)


class TestNormalize:
    def test_remaster_suffix(self) -> None:
        assert normalize("Come Together (Remastered 2011)") == "come together"

    def test_live_suffix(self) -> None:
        assert normalize("Wish You Were Here [Live]") == "wish you were here"

    def test_deluxe_edition(self) -> None:
        assert normalize("Purple Rain (Deluxe Edition)") == "purple rain"

    def test_featuring_dot(self) -> None:
        assert normalize("Umbrella feat. Jay-Z") == "umbrella"

    def test_ft_no_dot(self) -> None:
        assert normalize("Stan ft Dido") == "stan"

    def test_featuring_full_word(self) -> None:
        assert normalize("No Church In The Wild featuring Frank Ocean") == (
            "no church in the wild"
        )

    def test_punctuation_apostrophe(self) -> None:
        assert normalize("Don't Stop Believin'") == "dont stop believin"

    def test_case_insensitivity(self) -> None:
        assert normalize("STAIRWAY TO HEAVEN") == normalize("stairway to heaven")

    def test_accents(self) -> None:
        assert normalize("Enter Sandman – Mötley") == "enter sandman motley"

    def test_collapses_whitespace(self) -> None:
        assert normalize("Hey   Jude   ") == "hey jude"

    def test_empty_string(self) -> None:
        assert normalize("") == ""

    def test_combined_qualifiers(self) -> None:
        result = normalize("Bohemian Rhapsody (Remastered 2011) [Live] feat. Someone")
        assert result == "bohemian rhapsody"


class TestScoreMatch:
    def test_correct_pair_scores_above_wrong_pair(self) -> None:
        correct = score_match(
            tab_artist="Metallica",
            tab_title="Enter Sandman",
            audio_artist="Metallica",
            audio_title="Enter Sandman (Remastered)",
        )
        wrong = score_match(
            tab_artist="Metallica",
            tab_title="Enter Sandman",
            audio_artist="Megadeth",
            audio_title="Symphony of Destruction",
        )
        assert correct > wrong

    def test_correct_pair_clears_auto_threshold(self) -> None:
        score = score_match(
            tab_artist="Nirvana",
            tab_title="Smells Like Teen Spirit",
            audio_artist="Nirvana",
            audio_title="Smells Like Teen Spirit",
        )
        assert score >= AUTO_THRESHOLD
        assert classify(score) == "auto"

    def test_wrong_pair_fails_auto_threshold(self) -> None:
        score = score_match(
            tab_artist="Nirvana",
            tab_title="Smells Like Teen Spirit",
            audio_artist="Coldplay",
            audio_title="Yellow",
        )
        assert score < AUTO_THRESHOLD
        assert classify(score) == "pending-review"

    def test_missing_artist_scores_on_title_alone(self) -> None:
        score = score_match(
            tab_artist="Radiohead",
            tab_title="Karma Police",
            audio_artist=None,
            audio_title="Karma Police",
        )
        assert score == 1.0
        assert classify(score) == "auto"

    def test_close_but_not_exact_title_is_review(self) -> None:
        score = score_match(
            tab_artist="Oasis",
            tab_title="Wonderwall",
            audio_artist="Oasis",
            audio_title="Some completely different song title here",
        )
        assert classify(score) == "pending-review"


class TestClassify:
    def test_boundary_is_auto(self) -> None:
        assert classify(AUTO_THRESHOLD) == "auto"

    def test_just_below_boundary_is_pending(self) -> None:
        assert classify(AUTO_THRESHOLD - 0.01) == "pending-review"


class TestRecordingVariantGuard:
    """A live/acoustic take is a different recording from the studio one.

    Normalization still strips the qualifier so the candidate is found, but
    a disagreement must never auto-accept: the timing and structure differ
    from what the tab describes, so a human confirms the pairing.
    """

    def test_studio_tab_vs_live_audio_is_not_auto(self) -> None:
        score = score_match(
            tab_artist="Led Zeppelin",
            tab_title="Stairway to Heaven",
            audio_artist="Led Zeppelin",
            audio_title="Stairway To Heaven - Live",
        )
        assert score <= VARIANT_MISMATCH_CAP
        assert classify(score) == "pending-review"

    def test_live_tab_vs_live_audio_still_auto(self) -> None:
        score = score_match(
            tab_artist="Led Zeppelin",
            tab_title="Stairway to Heaven (Live)",
            audio_artist="Led Zeppelin",
            audio_title="Stairway To Heaven - Live",
        )
        assert classify(score) == "auto"

    def test_acoustic_mismatch_is_not_auto(self) -> None:
        score = score_match(
            tab_artist="Nirvana",
            tab_title="About a Girl",
            audio_artist="Nirvana",
            audio_title="About a Girl (Acoustic)",
        )
        assert classify(score) == "pending-review"

    def test_remaster_is_not_treated_as_a_variant(self) -> None:
        score = score_match(
            tab_artist="Metallica",
            tab_title="Master of Puppets",
            audio_artist="Metallica",
            audio_title="Master of Puppets (Remastered 2017)",
        )
        assert classify(score) == "auto"

    def test_variants_detected_from_raw_title(self) -> None:
        assert recording_variants("Song Name [Live]") == frozenset({"live"})
        assert recording_variants("Song Name") == frozenset()
        assert recording_variants(None) == frozenset()
