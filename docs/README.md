# Fretwork — planning deliverables (pre-implementation review)

Produced per FABLE_PROMPT.md §10. Status: approved by the owner on 2026-07-27; M0 in progress.

1. [00-milestone-plan.md](00-milestone-plan.md) — milestones, acceptance criteria, cost estimates, proposed stack
2. [01-data-model.md](01-data-model.md) — full schema: PWA (IndexedDB) + desktop (SQLite) + LAN API surface
3. ADRs for the §8 design problems:
   - [ADR-001 bar-level spaced repetition](adr/ADR-001-bar-level-spaced-repetition.md)
   - [ADR-002 sync-point model & interpolation](adr/ADR-002-sync-point-model.md)
   - [ADR-003 offline/online state machine](adr/ADR-003-offline-state-machine.md)
   - [ADR-004 overall data model decisions](adr/ADR-004-data-model.md)
   - [ADR-005 where TabSource implementations live](adr/ADR-005-tabsource-placement.md)
4. [02-delegation-map.md](02-delegation-map.md) — what goes to Sonnet, with spec skeletons
5. [03-alphatab-notes.md](03-alphatab-notes.md) — alphaTab 1.8.4 API verified against live docs
