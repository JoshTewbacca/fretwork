# ADR-005: Where TabSource implementations live

Status: proposed. Raised during M0/M1 implementation, 2026-07-27.

## Context

The brief (§5) specifies `TabSource` as a TypeScript interface, which reads as though the
PWA fetches tabs directly from Songsterr and the free archives. Two things checked during
implementation argue against a browser-side implementation:

1. **No CORS headers.** Responses from `songsterr.com` carry no `Access-Control-Allow-Origin`
   header, so a page on our own origin cannot read them. Caveat on the evidence: both probes
   returned 404 (see below), and a 404 does not always carry the CORS headers a 200 would.
   The check is suggestive rather than conclusive, but nothing observed supports
   browser-direct access.
2. **The documented endpoints have moved.** Both `\/a\/ra\/songs.json?pattern=` and
   `\/a\/ra\/songs?pattern=` return `ERR_NOT_FOUND`. The endpoint shapes in the brief are
   stale and have to be rediscovered before the adapter can be written. Probing stopped after
   two requests to honour the politeness guardrail in §5.

Independently of CORS, three requirements are server-shaped: polite rate limiting with
backoff, a durable response cache so a held tab is never re-requested, and `.gp`
reconstruction. All three are easier to do correctly in one place, off the phone.

## Decision

`TabSource` stays the contract, but implementations are split by location:

- **The Python desktop service owns remote sources.** Songsterr and the free archives are
  fetched, rate-limited, cached and reconstructed there. This is also what the architecture
  diagram in the brief §3 already shows (desktop step 1, "fetch tab from TabSource").
- **The PWA gets two implementations only**: `FileTabSource` (local file import, fully
  offline, already working in M0) and `DesktopTabSource`, which calls the desktop's LAN or
  Tailscale API and satisfies the same interface.

The player never sees the difference, which preserves the brief's swappability requirement.

## Consequences

- Searching for and adding new songs requires the desktop to be reachable. That is
  acceptable: acquiring a new tab is inherently an at-home, online activity, and ADR-003
  already guarantees that everything already in the library plays with the network off.
- No Vercel serverless proxy is introduced. That would have put third-party fetching on the
  hosting free tier and created a cloud dependency the brief rules out.
- Endpoint discovery becomes a desktop-side M1 task, not a PWA task, and can be redone
  without shipping a new PWA build when the upstream API moves again.
- File import stays the one path that works with no desktop at all, which makes it the safe
  fallback for the whole system.
