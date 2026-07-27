# ADR-001: Bar-level spaced repetition model

Status: proposed. This is the §8 problem the brief calls the hardest; it gets the longest ADR.

## Why SM-2 cannot be used as-is

SM-2 assumes: discrete atomic items, binary-ish recall grading, mastery that is a point (you
know it or you don't), and forgetting as the only decay process. Musical passages violate all
four: difficulty is continuous, passages overlap and nest, **tempo is a second dimension of
mastery** (playing a lick cleanly at 60% is a different skill state than at 100%), and motor
skill consolidates and decays differently from declarative memory — it needs *frequent short
exposures early* (distributed practice + sleep consolidation) and tolerates *much longer
gaps once automatic*, with fast relearning after a lapse (savings effect).

## The unit: passages, not bars

Scheduling individual bars produces musically meaningless reviews (bar 37 out of context) and
an overlap explosion. The scheduled unit is a **Passage**: a contiguous bar range on one
track (`Passage` in the data model). Bars are the coordinate system; passages are the items.

Creation:
- **Explicit**: user selects bars → "mark trouble spot".
- **Implicit**: loop telemetry. A `loop_block` event stream where the same (or heavily
  overlapping) range accumulates ≥ 8 reps in one session, or appears in ≥ 3 sessions, creates
  a `status: 'candidate'` passage. Candidates are *suggested* in the UI, never silently
  scheduled — misfired automation in a practice tool destroys trust.

### Overlap and nesting rules

- **Merge on creation**: a new range overlapping an existing active passage with Jaccard
  ≥ 0.6 (on bar sets) extends that passage instead of creating a sibling.
- **Nesting allowed** when a short kernel (≤ 4 bars) sits inside a long parent (≥ 2× its
  length): kernel = the hard jump, parent = integration into context. Both schedule
  independently, with **result propagation downward and upward**:
  - a clean review of the *parent* at tempo T records an implicit `good` on the kernel at T
    (playing the whole solo cleanly proves the kernel);
  - a *failed* kernel review caps the parent's `reviewTempoPct` at the kernel's
    `masteredTempoPct` (no pretending the solo is fine at 100% while its hardest bar isn't).
  - Same-day dedup: if both are due, the session builder orders kernel first and the parent
    block satisfies both items' reviews.

## What a review is

A review is a **loop block**: the app sets `playbackRange` to the passage, sets tempo to
`reviewTempoPct`, counts repetitions, and the user marks each rep clean/not with one thumb
(two large buttons; marking is optional per rep — unmarked reps count as attempts only).
Block grade, derived, not asked as an SM-2 0–5 (self-grading fidelity while holding a guitar
is low; four buckets is the honest resolution):

| grade | derivation |
|---|---|
| `easy` | first 2 reps clean |
| `good` | ≥ 2 clean within 5 reps |
| `hard` | a clean rep eventually, but > 5 reps needed |
| `fail` | no clean rep in the block |

## State and transitions

Per passage: `phase`, `masteredTempoPct` (m), `reviewTempoPct`, `ease` (start 2.2, floor 1.3,
cap 2.8), `intervalDays`, `dueAt` (see `PassageReviewState`).

**Phase 1 — acquisition (m < 90%).** The skill is being built, not retained. Scheduling is
dense and intervals do NOT grow: due every 1–2 days (1 after `hard`/`fail`, 2 after
`good`/`easy`). Tempo, not interval, is the progress axis: after `good`/`easy` the next
`reviewTempoPct` steps up by the ramp step (default +4 points; ramp curve configurable —
linear, or smaller steps above 90% where most passages get hard). After `fail`, step down 8
points. `masteredTempoPct` = highest tempo of any clean block. Rationale: motor learning
research favours distributed short sessions with sleep between; a 2-week gap mid-acquisition
mostly wastes the prior work.

**Phase 2 — consolidation (90% ≤ m < 100%).** Intervals start growing gently: 2 → 4 days
fixed (no ease multiplication yet). Reviews run at 96–100%. Entered from acquisition when a
clean block lands at ≥ 90%.

**Phase 3 — maintenance (m ≥ 100%).** Now — and only now — it behaves like SM-2, because
retention is finally the thing being managed:
- `interval' = round(interval × ease)`, first maintenance interval 3 days, **cap 60 days**
  (physical skill needs occasional physical refresh; nothing in this system should vanish
  for a quarter).
- ease adjustments: `easy` +0.15, `good` +0, `hard` −0.15, `fail` −0.2.
- Review tempo: 100%; after two consecutive `easy` results the block runs at 110%
  (overspeed), which makes 100% feel comfortable and is the cheapest difficulty knob we have.

**Lapse (fail in consolidation/maintenance).** Not a reset — savings effect means relearning
is fast. m drops by 10 points (floor 60%), phase → consolidation, interval → 2 days,
ease −0.2. Two consecutive lapses drop the passage back to acquisition at m − 20.

**Retirement.** At interval ≥ 60 days with ease ≥ 2.5, the passage is offered for
`retired` status (still playable, no longer scheduled). Auto-retire never happens silently.

## Tempo ↔ interval interaction, summarized

Interval growth is **gated on full-tempo mastery**. Below 100%, tempo is the progress
variable and intervals stay short; at 100%, tempo freezes and interval becomes the progress
variable. This resolves the two-dimensional-mastery problem by never letting both dimensions
move at once, which keeps the model debuggable and the user's mental model simple: *first
get it up to speed with daily touches, then we space it out.*

## Rebuildability

`PassageReviewState` is a fold over the `review_result` / `loop_block` event stream
(`rebuiltFromEventId` allows incremental folding). Bugs in the scheduler are fixed by
changing the fold and rebuilding — practice history is never mutated.

## Session builder

Input: minutes M, optional song filter, weighting "overdue-first".
Greedy fill: (1) due passages sorted by `(now − dueAt)/intervalDays` descending, ~4 min per
block, kernel-before-parent; (2) remaining time to warm-up/playthrough of the session's
songs. Output is a plain ordered list the user can reorder or skip — the scheduler proposes,
the human disposes.
