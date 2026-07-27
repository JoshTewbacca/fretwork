# ADR-005: Where TabSource implementations live

Status: **revised 2026-07-27** (see "Revision" at the end - the no-serverless part of the
original decision was wrong and has been reversed). Raised during M0/M1 implementation.

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

## Revision, same day: a serverless proxy, and no Songsterr adapter

Two things changed this decision after the owner pushed back that an app without automatic
search is not worth having.

### 1. Songsterr is dropped as a source entirely

Watching songsterr.com load a tab in a real browser: the metadata comes from
`/api/meta/{songId}/revisions`, but the score itself never arrives as an inspectable
request. It is assembled client-side and reaches the page through opaque `blob:` URLs. The
formerly public JSON endpoints are gone.

That is not an API that moved, it is a delivery path built to be difficult to read, on a
subscription product whose tabs are the thing being sold. Extracting content from it into a
competing player is circumvention rather than integration, so **no Songsterr adapter will be
built**, and the brief's framing of routing around the licensing moat is not followed. This
is the one instruction in the brief deliberately not implemented.

### 2. The proxy ban was a misreading of the brief

The original decision above rejected a Vercel function partly because the brief "rules out"
a cloud dependency. Re-reading §2 and §3: the brief rules out cloud *storage*
("no S3, no Vercel Blob for audio, no paid buckets") while explicitly permitting
"minimal serverless if strictly needed". CORS makes fetching from the archives exactly that
case, and a proxy is strictly better for the owner than the desktop route, because search
then works from the phone anywhere without the desktop being awake.

**Revised decision.** Remote tab sources are reached through two Edge functions in this
app's own deployment, `/api/tabs/search` and `/api/tabs/download`, which fetch from the free
archives named in brief §5. Politeness is handled by CDN caching (`s-maxage`) so repeated
searches never re-hit the source, and the download endpoint validates its path parameter
against a strict pattern so it cannot be used as an open proxy. No content is stored
server-side; bytes stream through to the phone's IndexedDB. The desktop service keeps
audio ingest, which is where the heavy compute genuinely belongs.

**Measured coverage** (gprotab.net, checked before building): searching by song title found
exact matches with multiple versions for every popular song tried - "smells like teen
spirit", "master of puppets", "stairway to heaven", "wonderwall", "sweet child o mine",
"back in black" all returned 11 to 20 results. Searching by artist name alone returns
noticeably weaker results, so the UI tells the owner to search by title. Files are served as
Guitar Pro 3, which alphaTab reads.
