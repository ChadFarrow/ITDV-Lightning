# Claude Code Instructions

## Project Overview
ITDV-Site is a Next.js web application that serves as a platform for showcasing music content from various artists, with a focus on The Doerfels and related artists.

## Key Technologies
- Next.js
- TypeScript
- Tailwind CSS
- Service Workers for PWA functionality
- RSS Feed parsing
- CDN integration (Bunny.net)
- BoostBox integration (tardbox.com) for boost metadata logging

## Important Directories
- `/app` - Next.js pages and routes
- `/components` - Reusable React components
- `/contexts` - React context providers (`AudioContext`, `VideoContext`, `LightningContext`, `BitcoinConnectContext`)
- `/hooks` - Shared hooks (`useBoostToNostr`, etc.)
- `/lib` - Core utilities and services
- `/public` - Static assets, including the three album cache JSONs
- `/data` - Feed config (`feeds.json`), pinned albums, pre-optimized images
- `/scripts` - Utility scripts for deployment and maintenance
- `middleware.ts` - Fail-closed auth gate for `/api/admin/*`

## Code Style Guidelines
1. Use TypeScript for type safety
2. Follow Next.js best practices for routing and data fetching
3. Use Tailwind CSS for styling
4. Implement proper error handling and loading states
5. Optimize for mobile-first design
6. Ensure PWA compatibility

## Common Tasks
1. Adding new artist content
2. Managing RSS feeds
3. Optimizing image and audio delivery
4. Maintaining service worker functionality
5. Managing CDN integration
6. BoostBox integration (boost/stream metadata posted to tardbox.com via `lib/boostbox-service.ts`)

## Architecture Notes

### Static cache files (treat as a set; never edit one alone)
Three JSON files in `public/` serve the album list and must stay consistent:
- `static-albums.json` — authoritative list. Read by `app/album/[id]/page.tsx` (SSR) and `app/api/albums-static-cached/route.ts` (homepage).
- `albums-static-cached.json` — secondary cache, written alongside `static-albums.json` by admin endpoints. Drift here is the bug source for duplicate-album incidents.
- `album-index.json` — slug → array-position lookup built from `static-albums.json`. Rebuild after any edit with `node scripts/build-album-index.js`.

Writers: `app/api/admin/manage-feeds/route.ts` (POST/PUT/DELETE), `scripts/regenerate-static-cache-direct.ts` (full rebuild from `data/feeds.json`), `scripts/reparse-affected.ts` (single- or multi-feed reparse with assertions), `scripts/backfill-album-dates.ts` (re-derives `originalRelease` from cached description text, no network).

### Admin route writes must be Vercel-aware
On Vercel the project filesystem is read-only, so any admin handler that mutates `data/*.json` or `public/*.json` must commit through GitHub — a raw `fs.writeFileSync` either throws `EROFS` or lands in per-instance tmpfs and silently disappears. Pattern (see `app/api/admin/manage-feeds/route.ts:11-107` and `app/api/admin/pinned-albums/route.ts`):
- Detect with `const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_URL);`
- On Vercel: `await commitFiles([{ path, content }, ...], '<msg>')` from `lib/github.ts` (auto-deploy ships the change).
- Locally: `fs.writeFileSync` directly.
- Return `{ success, error?, deployed? }` so the client can show a "redeploying…" toast on Vercel vs. instant-save locally.

The pinned-albums route used raw `fs.writeFileSync` and silently failed in prod for ~5 months before this was fixed. Don't add a third writer that bypasses the pattern.

### Per-album track filtering via `data/feeds.json`
A feed entry can include `"trackFilter": "<term>"`. The parser at `lib/rss-parser.ts` keeps tracks whose title contains that term (case-insensitive) plus any chapter tracks (`videoUrl + startTime + endTime`). Used for compilation feeds — Satellite Spotlight filtered to CityBeach, Autumn Rust filtered to The Doerfels. Configure at the data layer; do not add new title-string heuristics to the parser.

### Private feeds (`isPrivate: true`)
Feeds not indexed on Podcast Index get `"originalUrl": "PRIVATE_FEED_URL"` redacted into committed JSON. The real URL only lives in local working copies and the production env. To re-parse such a feed locally, use `scripts/reparse-them.ts` or follow the `redactInCache` pattern in `scripts/reparse-affected.ts` to keep the redacted URL in the cache files while still calling the public source URL for parsing.

### Shared album-index utilities (`lib/album-index.ts`)
`createSlug(title)` and `buildAlbumIndex(albums)` are the single source of truth for slug generation and the lookup index. Import from here rather than reimplementing inline. `scripts/build-album-index.js` keeps a parallel JS copy for plain-`node` invocation — keep both in lockstep.

### Display year comes from the description, not the pubDate (`lib/album-date.ts`)
An album's `releaseDate` is the feed's RSS pubDate — when the v4v feed went up, often years after the
music was made (`Them` has a 2026 pubDate for a 2019 record). `extractAlbumDate(description)` mines the
stated recorded/released date out of the description text and the parser stores it as `originalRelease`;
`getDisplayYear(album)` prefers it and falls back to the pubDate year. Use `getDisplayYear` at every
year-display site — do not reintroduce inline `new Date(album.releaseDate).getFullYear()`.

The extractor is context-aware on purpose: it skips sentences about births, deaths and weddings, and
strips `YYYY-YYYY` lifespans, because real descriptions contain those (`Autumn`'s "born Jan 12, 2024",
`Unsound Existence`'s "Miles Fonda 1988-2023"). Its expected output for all 9 matching albums is asserted
in `scripts/backfill-album-dates.ts`, which is the repo's stand-in for a unit test here — run it after
touching the extractor. The stored `kind` ('recorded' vs 'released') is lower-confidence than `year` and
is deliberately not displayed.

Keep this module free of lookbehind and other post-ES5 regex syntax: `tsconfig` targets es5, regex syntax
can't be down-levelled, and this module is imported by client components on the homepage.

**Correcting a wrong year** — add `"originalReleaseYear"` to the feed's entry in `data/feeds.json`, never
by editing `public/static-albums.json`, which any cache rebuild overwrites:
- `"originalReleaseYear": 1998` forces that year;
- `"originalReleaseYear": null` suppresses a bad auto-detected date and falls back to the pubDate year;
- key absent leaves the extractor in charge.

`resolveOriginalRelease(extracted, overrideYear)` applies it, and every writer that merges feed metadata
onto an album calls it: `scripts/regenerate-static-cache-direct.ts`, `scripts/backfill-album-dates.ts`,
`scripts/reparse-affected.ts`, `scripts/reparse-them.ts`, `app/api/admin/manage-feeds/route.ts` (via
`prepareAlbumFilesForAdd`), and the live-parse fallback in `app/api/album/[id]/route.ts`. These writers
replace the whole cache entry, so a writer that skips the call silently drops the curated year — add it
to any new writer. Scripts read the overrides via `loadOriginalReleaseOverrides()` in
`scripts/feed-overrides.ts`; it uses `fs`, which is why it lives there and not in the client-safe
`lib/album-date.ts`.

Singles are the coverage gap: 25 of the 50 entries are single-track and **none** state a date in the
description, so they all show the feed year. Fixing those needs the override above or another data source.

### Admin API is guarded in middleware, not per-route (`middleware.ts`)
`middleware.ts` requires a valid session for every `/api/admin/*` path except `simple-auth`, so a new
admin route is protected the moment it exists. This exists because eight of sixteen admin routes once
shipped with no check at all — including a `DELETE FROM feeds` and a handler that wrote request text
into `app/page.tsx`. Handlers still call `isAuthenticatedRequest` themselves; that redundancy is
deliberate, so deleting the middleware degrades to the old per-route behaviour rather than opening
everything. Never add a route under `/api/admin` that is meant to be public — put it elsewhere.

`lib/admin-auth.ts` is Web Crypto, not `node:crypto`, specifically so middleware (Edge) and route
handlers (Node) share one implementation. Its functions are async as a result. Two things there are
load-bearing: comparisons use a length-tolerant constant-time helper, because `crypto.timingSafeEqual`
throws a `RangeError` on unequal lengths and one side is always attacker-supplied; and `verifyPassword`
compares HMACs rather than raw strings so password length doesn't leak through timing.

### Media proxies must validate the upstream media type (`lib/proxy-guard.ts`)
`/api/proxy-image`, `/api/proxy-audio` and `/api/proxy-video` fetch a caller-supplied URL and stream it
back **from our own origin**. Passing the upstream `Content-Type` through unchecked turned
`/api/proxy-image?url=…/evil.html` into script execution on this domain. Every proxy route must call
`validateProxyTarget` (HTTPS only; rejects loopback, RFC1918, link-local and metadata addresses) and
`isAllowedMediaType` before streaming, and apply `hardeningHeadersFor` — SVG is an `image/*` type that
can carry script, so it gets a sandbox CSP. `application/octet-stream` is permitted for audio only,
because podcast hosts commonly serve MP3s that way.

`scripts/security-smoke.sh` asserts all of the above (32 checks). Run it against a dev server after
touching auth, the proxies, or `/api/optimized-images`.

### Secrets and the `NEXT_PUBLIC_` prefix
Next inlines every `NEXT_PUBLIC_*` value into the client bundle at build time. A private key with that
prefix is published to every visitor. The site's Nostr key was `NEXT_PUBLIC_SITE_NOSTR_NSEC` for this
reason; signing now happens in `/api/nostr/publish` using server-only `SITE_NOSTR_NSEC`, and the client
only ever sees the npub. `NEXT_PUBLIC_BOOSTBOX_API_KEY` is client-side by BoostBox's own design and is
the documented exception. Before adding any `NEXT_PUBLIC_` var, ask whether you would publish its value.

### Context callbacks must be memoized (`contexts/AudioContext.tsx`)
`AudioContext` publishes `currentTime` on every `timeupdate`, so its value object is rebuilt several
times a second during playback and every `useAudio()` consumer re-renders. That is fine as long as the
functions it exposes keep a stable identity — consumers pass them straight into `React.memo`'d children
(`AlbumCard` takes `onPlay`), and an unstable one silently defeats memoization across the whole grid.
When this was measured, the 49 album cards re-rendered 2254 times in six seconds; with
`playAlbum`/`playAlbumAndOpenNowPlaying` wrapped in `useCallback` (and the matching handlers in
`app/page.tsx`), the same window produces 4. Anything added to the context value needs the same
treatment. These callbacks read only refs and setState — never state — which is what makes their empty
dependency lists correct; keep it that way or they will capture stale values.

### Video player and shuffle
- `contexts/VideoContext.tsx` owns video play state, separate from `AudioContext`. The global now-playing bar (`components/GlobalNowPlayingBar.tsx`) reads from whichever has a current item.
- `components/VideoPlayer.tsx` accepts `externalIsPlaying` to sync the DOM `<video>` element with `VideoContext.isPlaying` (so the bottom-bar play/pause actually drives the video).
- A track is "video" if it has `videoUrl`. A "chapter" track has `videoUrl + startTime + endTime` and represents a segment of a longer video.
- Global shuffle (`app/page.tsx:289-293`) skips video-only tracks (`!track.url`); hybrid audio+video tracks are shuffled and play as audio.

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md

## Local development & verification

There is no test framework in this repo. Verification is: typecheck, build, the security smoke
script, and driving the running app. Assertions baked into the maintenance scripts stand in for unit
tests (`scripts/backfill-album-dates.ts`, `scripts/reparse-affected.ts`).

```bash
npm install                                   # node_modules is not always present
ADMIN_PASSWORD=<anything> npm run dev         # without it every admin route 401s (fails closed)
npx tsc --noEmit                              # fastest correctness check
npm run build                                 # also runs lint; the only full type gate
ADMIN_PASSWORD=<same> ./scripts/security-smoke.sh   # 32 checks, needs dev running
npx tsx scripts/backfill-album-dates.ts       # asserts the date extractor still agrees
```

**Do not run `npm run build` while `npm run dev` is running.** The build rewrites `.next`, and the
live dev server then fails every request with `Cannot find module './vendor-chunks/*.js'` or serves
`main-app.js` as `text/html`. It looks like a code bug and is not one. Stop dev first, or accept that
you must restart it afterwards.

`tsconfig` targets **es5**, which bites in two ways that compile fine in an editor and fail the build:
iterating a `Map`/`Set` with `for..of` needs `downlevelIteration` (use `.forEach`), and post-ES5 regex
syntax such as lookbehind cannot be down-levelled at all.

## Testing Guidelines
1. Test on both desktop and mobile devices
2. Verify PWA functionality
3. Check CDN integration
4. Validate RSS feed parsing
5. Test audio playback across different scenarios
6. After touching auth, the media proxies, or `/api/optimized-images`, run `scripts/security-smoke.sh`

## Performance Requirements
1. Fast initial page load
2. Optimized image loading
3. Efficient audio streaming
4. Smooth transitions between pages
5. Reliable offline functionality

## Security Considerations
1. Secure API endpoints
2. Safe CDN usage
3. Protected admin routes — enforced in `middleware.ts`, see Architecture Notes
4. Proper environment variable handling — never `NEXT_PUBLIC_` a secret
5. Regular security audits — `scripts/security-smoke.sh` covers the known regressions
6. BoostBox API key is client-side (`NEXT_PUBLIC_` prefix) by design — BoostBox expects this

Any route that takes a path segment or a URL from the caller is the risky shape here, and both have
already bitten this repo: `/api/optimized-images/[filename]` served `.env.local` and `/etc/hosts` via
`..%2F` (Next hands the segment over already percent-decoded, so `path.join` alone is not a defence),
and the media proxies served attacker HTML from this origin. Validate the input and re-check the
resolved result — do not trust that a framework decoded it safely.

## Known outstanding issues

Findings from the August 2026 audit that are understood but not yet fixed. Each needs a decision or
an environment change rather than just code, so don't treat them as fresh discoveries.

- **The old site Nostr key must be rotated.** If `NEXT_PUBLIC_SITE_NOSTR_NSEC` was ever set in Vercel,
  that private key shipped in the client bundle and is compromised — a Nostr identity cannot be
  rotated without abandoning it. Generate a new pair, set `SITE_NOSTR_NSEC` and
  `NEXT_PUBLIC_SITE_NOSTR_NPUB`, and delete the old variable.
- **`/api/albums` returns 500.** It needs Postgres via `lib/db.ts`, which is not provisioned. It only
  matters as the second fallback behind `/api/albums-static-cached` (there is a third: reading the
  static JSON from `public/` directly), so the site works. If Postgres is not coming back, that whole
  DB path — `lib/db.ts`, `/api/albums`, `/api/admin/ensure-feed` — is dead code worth deleting.
- **Rate limits are per-instance.** Both `/api/admin/simple-auth` and `/api/nostr/publish` count
  attempts in a module-level `Map`, so a distributed caller gets the limit *per serverless instance*.
  They raise the cost of guessing; they are not a hard stop. A durable limit needs Vercel KV or similar.
- **No Content-Security-Policy.** Deliberately not added blind — a real CSP has to be iterated against
  a preview deploy or it will break Bitcoin Connect and the relay websockets.
- **`data/optimized-images` is ~143MB of committed GIFs**, and `.git` is ~199MB. Every clone and CI
  checkout pays for it. Moving these to Bunny would be a real win but requires rewriting history.
- **Three admin routes were deleted** as unreferenced and dangerous: `add-to-hardcoded` (wrote caller
  text into `app/page.tsx`, and already broken — it targeted a `feedUrlMappings` array that no longer
  exists), `clear-feeds` (`DELETE FROM feeds`, no caller), and `migrate-feeds` (a 503 stub). Don't
  restore them. `admin/feeds/[id]` and `admin/feeds/[id]/refresh` are also 503 stubs, still called by
  `components/AdminPanel.tsx`, so its remove/refresh buttons do nothing — either implement or remove.