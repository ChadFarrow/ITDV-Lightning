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

### Media proxies: one address guard, limits, media type (`lib/proxy-guard.ts`)
`/api/proxy-image`, `/api/proxy-audio` and `/api/proxy-video` fetch a caller-supplied URL and stream it
back **from our own origin**, so two things must hold for every one of them.

**The destination is a public address, on every hop.** The proxies use the feed parser's guard,
`lib/safe-fetch.ts`, so there is one list of refused addresses (see "Feed fetches" below for what it
refuses and its stated residual risk, DNS rebinding). `validateProxyTarget` takes HTTPS only on the way in
and runs that list on the URL as written. `fetchProxyTarget` then fetches through `safeFetch`: it resolves
the name, refuses if any address is private, and follows redirects by hand (at most 5), checking each hop
the same way. A redirect hop may be plain http, as for feeds. The list has no rule for IPv6 multicast
(`ff00::/8`), so `validateProxyTarget` refuses that literal itself; TCP cannot connect to multicast, so a
name that resolves to one fails at connect. Do not add an address rule to `proxy-guard.ts`: take it from
the recipe, so the parser gets it too. Never call a plain `fetch` in a proxy route, also not for a probe
or a page that the route reads (the SplitKit HTML, the HEAD probes): use `fetchProxyTarget`.

**Time and size limits** (`MEDIA_LIMITS`). One `AbortSignal.timeout` covers the connection, the redirects
and the whole body: 15 s for an image, 30 s for a GIF, audio and video, which are the values the routes
had before (they already ended a streamed body in production, so a shorter one cuts playback). The body
is counted as it streams through `capStream` and stops at 64 MB for an image, 200 MB for audio and video,
per response (a Range response counts its own part); a declared `Content-Length` over the limit is
refused with 502 before any body is read. On 2026-11-25 the largest proxied GIF was 41.7 MB
(Autumn Rust) and the largest track 21.3 MB. An HLS playlist is read whole to rewrite it, so it gets
8 MB (a long video's playlist is large: the 2.5-hour CityBeach set has 1.53 MB playlists); a SplitKit page
2 MB. Upstream requests ask for `Accept-Encoding: identity`: media is compressed already,
and a decoded body would not match the forwarded `Content-Length`. A refusal answers 403 "Destination not
allowed", a timeout 504, anything else 502, each with a fixed text. The guard's own messages name the
host and are for logs only; never put one in a response.

**The media type is checked on the final response.** Passing the upstream `Content-Type` through
unchecked turned `/api/proxy-image?url=…/evil.html` into script execution on this domain, and the final
response can come from a redirect. Every route calls `isAllowedMediaType` after the fetch and
sends `nosniff`; the image route applies `hardeningHeadersFor` — SVG is an `image/*` type that can carry
script, so it gets a sandbox CSP. `application/octet-stream` is permitted for audio and video only,
because podcast hosts commonly serve MP3s that way.

**HLS playlists: every link goes back through the video route** (`lib/hls-rewrite.ts`). The route reads a
playlist whole and rewrites each link to a root-relative `/api/proxy-video?url=<absolute URL>`. The rule is
the format's own (RFC 8216 4.1), not a list of file names: every non-blank line that does not start with
`#` is a URI, and so is every `URI="…"` attribute of a tag (`EXT-X-MAP`, `EXT-X-KEY`, `EXT-X-MEDIA`,
`EXT-X-I-FRAME-STREAM-INF` …). Each link resolves against the URL of the final response, after any
redirect; only `http(s)` links are rewritten (`data:` and `skd:` keys stay). Until 2026-11-25 the route
matched names (`.m3u8`, `.ts`, `segment_N.ts`), so Cloudflare Stream's `../../<id>/video/<n>/seg_N.mp4?p=…`
lines stayed relative, resolved against this site, and no Cloudflare video played (production too). The
rewrite decides nothing about safety: each rewritten link is a new request to the route, so the host
allow-list, the guard, the media-type check and the limits apply to it as to the first. Root-relative
links keep the cached body (`public, max-age=3600`) free of the request's Host. The largest rewritten
playlist on 2026-11-25 was 1.83 MB: the audio rendition of the 2.5-hour CityBeach video, 1.53 MB upstream
(every rendition of the three videos measured).
`npx tsx scripts/check-hls-rewrite.ts` asserts the rewrite on synthetic copies of the real shapes.

`npx tsx scripts/check-media-proxy.ts` drives the three route handlers against a local server: 42
private address forms, a name that resolves to 127.0.0.1, redirects to private addresses and a redirect
loop, an endless and a falsely declared body, a server that never answers and one that drips, HTML behind
an allowed video host, the SplitKit page and probes, the real-use shapes (Range 206 with its headers,
a public redirect, an upstream 304), and the HLS chain a player walks (master, media playlist, init
segment, `../../` segment, key, audio rendition, a redirected playlist), with playlist links that the route
must refuse once followed (private address, foreign host, plain http, HTML). The timeout cases take about 30 s; `CHECK_SKIP_SLOW=1` skips them.
On 2026-11-25 each rule of the guard, of `safe-fetch.ts` and of the route wiring was removed once (52
removals), and a check failed every time. One needs `check-feed-fetch.ts`: the recipe's scheme check,
which the proxy's own HTTPS rule covers.

`scripts/security-smoke.sh` asserts the proxy refusals and the real media, including an op3.dev track
through its redirect and a Cloudflare Stream playlist down to its first segment (53 checks with the Helipad
webhook ones). Run it against a dev server after touching auth, the proxies, or `/api/optimized-images`,
and against `next start` after a change to a proxy
(the 206 framing only shows on a running build, see "Next is pinned").

### Feed fetches go through `lib/feed-fetch.ts` (server only)
Every URL the parser fetches is untrusted: an admin types the feed URL, a podroll or remoteItem walk
follows whatever another feed names, and a public feed can name any chapters URL. Until 2026-11-24
`lib/rss-parser.ts` called a plain `fetch(feedUrl)` with no time limit, no size limit and no address
check, so a feed (or its chapters file) at `http://169.254.169.254/` or `localhost` was fetched from
the server. Now every feed read (`parseAlbumFeed`, `parsePublisherFeedInfo`, `parsePublisherFeed`)
and both chapters reads go through `fetchUntrustedText`/`fetchUntrustedJson`:

- `lib/safe-fetch.ts` refuses private, loopback, link-local, metadata and other special-use addresses
  in the spellings its header lists, on every redirect hop, and after DNS. Residual
  risk, stated in its header: DNS rebinding. Plain `http:` stays allowed, as real feeds need it.
- One `AbortSignal.timeout` (10 s) covers connection, redirects and body; `lib/capped-body.ts` stops
  reading past 8 MB for a feed and 1 MB for a chapters file.
- `RSSParser.fetchFeedXml` maps a refused address or an oversized body to a non-retryable AppError, so
  `withRetry` makes one attempt. A 4xx other than 429 is not retried either (it was before). A timeout,
  a 429 and a 5xx still retry, so a feed that hangs costs about 33 s (3 × 10 s plus 1 s and 2 s waits).
  `parseAlbumFeed` returns `null` on any failure, as before.

`safe-fetch.ts` and `capped-body.ts` are the PC20-Nostr recipe `safe-feed-fetch` (boostmebitch
`815c551f`, MIT), **byte-identical** — do not edit them here; take a fix from the recipe.
`safe-fetch.ts` imports `node:dns/promises`, so `lib/rss-parser.ts` is server only: keep client files
to `import type` from it (they are today). The old browser branch proxied through
`/api/fetch-rss`, a route that never existed in this repo; it was removed, not repointed, because the
browser never parses feeds and an XML read proxy from this origin is what `proxy-guard` refuses.

`/api/podcastindex` was deleted on 2026-11-24. It passed a caller's `endpoint` query straight into a
Podcast Index URL signed with the server key (anyone could call any PI endpoint on the key's quota),
nothing in the repo called it, and its fallback was the missing `/api/fetch-rss`. Podcast Index is now
read only by `lib/podcast-index.ts` (`podcasts/byfeedurl`, from the authenticated add-feed route).

Channel-level tags come from the channel's own children: `firstChildElement` in `lib/rss-parser.ts`.
`channel.getElementsByTagName` searches inside every `<item>` too, so a channel with no
`<podcast:value>` took its first item's split as the album split (and an item's `<podcast:guid>` could
become the feed GUID). On 2026-11-24 none of the 53 albums in `data/feeds.json` relied on that: old and
new parser gave identical album and track splits for all of them. Other channel lookups in the parser
(funding, podroll, chapters, title, image) still search deep.

`npx tsx scripts/check-feed-fetch.ts` asserts all of this: the recipe's address list and redirect
cases, the time and size limits against a real local server (a hanging server, a dripping body, a
64 MB chunked body, a lying `Content-Length`), the parser refusing loopback, `localhost`, `[::1]`,
`::ffff:127.0.0.1`, 10/8 and 169.254.169.254 with no request made and no retry, a redirect to
loopback, a private chapters URL, and the channel scoping. It uses a temporary `RSSCache` folder:
`data/rss-cache/` keeps parsed feeds for 30 minutes, so a test that writes there reads its own old
results on the next run.

### One User-Agent for every server request (`lib/user-agent.js`)
Every request that server code or a script sends to another host says
`ITDV-Lightning/<package.json version> (+https://itdv.podtards.com)` (Chad, 2026-11-27): the app's own
name, the version from `package.json` (today the odd `1.2a587df`, unchanged since the first commit) and the
live site. No e-mail, no browser imitation. Until then the proxies sent names copied from other apps
(`Mozilla/5.0 (compatible; PodtardsImageProxy/1.0)`, `DoerfelVerse/1.0 (Video Proxy)`, `OGImageProxy`,
`RSS-Parser`, `HPM-StaticBuilder`, and `re.podtards.com` to Podcast Index), and `lib/github.ts`,
`admin/extract-colors`, `health`, the `/publisher/[name]` page and the relay WebSocket sent Node's bare `node`. Every host they reach
answered the same status and type to the old and the new name (probed 2026-11-27, PR body).

- `fetchProxyTarget` sets it on every proxy request, redirect hops and the SplitKit HEAD probes included.
  The routes do not set their own.
- `lib/relay-publish.ts` passes it as undici's WebSocket `headers` option (Node only; a browser would throw).
- The file is CommonJS so the Next build, the `tsx` checks and the plain-`node` scripts all load it. It reads
  `package.json`, so keep it out of client code. Node's native TS mode (`check-relay-publish.mjs`) needs
  the explicit `./user-agent.js` import.
- Browser fetches keep the browser's own header; code cannot set it there.
- `/api/proxy-video` keeps `Origin`/`Referer: https://re.podtards.com` on the Cloudflare Stream fetch. Those are not
  User-Agent strings and were left as they were.

`npx tsx scripts/check-user-agent.ts` asserts the form, the version and the link, and fails on any other
`'User-Agent': '…'` literal in `app/`, `lib/`, `scripts/`, `hooks/`, `utils/` and `middleware.ts`.
`check-media-proxy.ts`, `check-feed-fetch.ts` and `check-relay-publish.mjs` assert the header that the
local upstream receives.

### Next is pinned to 15.5.28 on purpose (`package.json`)
Next 15.5.29 (its fix for GHSA-pc58-hwjq-p385) strips `content-length`, `content-encoding` and
`transfer-encoding` from **every** route-handler response. `/api/proxy-audio` then answered a Range
request with a chunked 206 and no `Content-Length`, where production on 15.4.8 sent one (measured
2026-11-23). Typecheck, lint and build stay green; only a running build shows it, so the last two checks
of `security-smoke.sh` assert the 206's `Content-Length` and `Content-Range`. 15.5.28 already has the
critical and high Next fixes. The three moderates it leaves open do not apply here: two are for
self-hosted Next (this site runs on Vercel), and one is for Edge-runtime route handlers that set
cookies (there are none). Move past 15.5.28 only to a version on which `security-smoke.sh` passes
against `next start`.

`overrides.next.postcss` lifts the `postcss` that Next 15 pins (8.4.31) to the patched 8.5 line. The
compiled CSS was byte-identical with and without it. Drop the override when Next itself ships
postcss ≥ 8.5.23 (Next 16 does).

### Secrets and the `NEXT_PUBLIC_` prefix
Next inlines every `NEXT_PUBLIC_*` value into the client bundle at build time. A private key with that
prefix is published to every visitor. The site's Nostr key was `NEXT_PUBLIC_SITE_NOSTR_NSEC` for this
reason; signing now happens in `/api/nostr/publish` using server-only `SITE_NOSTR_NSEC`, and the client
only ever sees the npub. `NEXT_PUBLIC_BOOSTBOX_API_KEY` is client-side by BoostBox's own design and is
the documented exception. Before adding any `NEXT_PUBLIC_` var, ask whether you would publish its value.

### Site boost notes: `/api/nostr/publish` must wait for the relays
When `NEXT_PUBLIC_SITE_NOSTR_NPUB` is set, `hooks/useBoostToNostr.ts` posts every boost note through
`/api/nostr/publish` and has **no fallback** — if the route fails, no note is posted, and the browser
only logs "Failed to create boost note". Two faults stacked here and no site note reached a relay from
2026-08-04 to 2026-10-30, while the Helipad bot's own copy of each boost hid the gap:

- `SITE_NOSTR_NSEC` was never added on Vercel when signing moved server-side, so the route answered 503.
  It is set for Production only (Sensitive), so preview deployments cannot post as the site — on purpose.
- The route called `postBoost`, which starts the relay publish without `await`. A Vercel function stops
  once it has answered, so the note was signed, reported as a success, and never sent. The route now
  signs with `BoostToNostrService.signBoost` and awaits `publishToRelays` (`lib/relay-publish.ts`),
  which waits for each relay's `OK` (5 s) and reports success only when one accepted. Never use
  `postBoost`'s background publish on the server.

`lib/relay-publish.ts` deliberately does not use nostr-tools' relay code: since 2.25.2 its `onerror`
calls `ws.close()`, and Node's built-in WebSocket fires `error` again at once for a socket that never
connected, so one dead relay recursed into a stack overflow (reproduced on Node 22.16). It removes its
handlers before closing. Its checks: `node --experimental-strip-types scripts/check-relay-publish.mjs`.

The route rebuilds the track from the request field by field (`cleanString`/`cleanLine`), so a field
that is not on that list never reaches `createBoostContent`. When signing moved server-side on
2026-08-04 the list left out `senderName`: every site note lost its "Sent by:" line, and auto boosts lost
the "Auto Boost" sender that hides the "From:" line. Fixed on 2026-11-16. A new field that the note text
reads must be added to the route too.

**Auto boosts post no Nostr note** (Chad's decision, 2026-11-16). `triggerAutoBoost` in
`contexts/AudioContext.tsx` pays the splits and posts to BoostBox, and does not call the route. The route
also answers 403 to the request that older bundles sent (sender "Auto Boost" and a comment that starts
"Auto boost for"), because an open tab keeps its old code until it reloads. Remove that check once no old
bundle can be open.

**The note uses the shared boost note format** since 2026-11-17: `pc20-boost-notes.md` on
ChadFarrow/PC20-Nostr `main` (PR #51). `lib/boost-note.ts` writes it and reads it back:

```
⚡ Boost ⚡

<message>

<sender> boosted <N> sats to <track> by <artist> from <album> via ITDV App

<link>
```

- `<sender>` and `ITDV App` are the strings the payment carried (`senderNameOf`/`appNameOf` in
  `lib/boostagram.ts`), defaults included: an unnamed track boost says "Anonymous", an album boost
  "Super Fan". The route always signs "via ITDV App", whatever app the caller names.
- An album boost says "to <album> by <artist>" with no "from". Its metadata sets `boostsAlbum`, so the
  note leaves out the `podcast:item:guid` of track 1 that the album boost's boostagram still sends.
- Placeholders ("Unknown Artist", "Unknown Album", "Shuffle All") are not printed as names.
- Tags add `["amount", <msats>]` and `["t", "boostagram"]`. There is no `sender` tag: the site does not
  know the listener's key.

`parseBoostFromEvent` in `app/boosts/page.tsx` reads notes back for the /boosts page. A note that starts
`⚡ Boost ⚡` goes to `parseBoostNote`; any other note goes to the old reader, which must stay, because a
kind 1 cannot be edited and every old layout is still on the relays. Change the writer and the reader in
the same commit. The old writer put its own quotes around a feed title that already carried a pair
(`⚡ 25 sats • "CityBeach - "Hey, You're Up!"" by …`), so the old reader takes such a title from the first
line, up to the last quote before " by ", and passes it through `noteTitle` (fixed 2026-11-17; 11 notes). The sentence is plain text, so `parseBoostNote` splits it by rule: "via" from the end,
the last " by ", then the first " from " after it ("Porkchops Fried by HeyCitizen" is a real track). Its
limits are in its comment. The card prints the title in its own quotes, so it goes through `noteTitle`,
which also keeps the LNURL comment from doubling a feed's quotes (`""Nate's got it""`).

**To check production without posting**, POST `{"amount":0,"track":{"title":"probe"}}` to the route:
503 "Site Nostr identity is not configured" means the key is missing, 400 "Invalid amount" means it was
found. To confirm a real boost, ask the relays for its event id. Do not rely on the Vercel runtime logs
for this route: `next.config.js` sets `compiler.removeConsole` for production, so every `console.*` call is
deleted from the build and logs nothing on Vercel (found 2026-11-24). A server line that must reach the
logs uses `serverLog`/`serverError` from `lib/server-log.ts`, which write to the process streams; the
Helipad webhook and its store do.

Each ITDV boost produces **two** notes: one from the site key here, and one from Helipad-to-Nostr-BoostBot
(its own key, "📱 via ITDV App"), which posts whatever the Helipad node receives. An auto boost gets no site
note (above), and since 2026-11-16 it sends action `auto`, not `boost`. BoostBot's default send rules post
`boost` only, so by default an auto boost gets no Nostr note at all. Helipad still lists auto boosts with
the boosts (clock icon).

### Boost payment records (`lib/boostagram.ts`)
The manual boost (`components/BitcoinConnect.tsx`) and the auto boost (`utils/payment-utils.ts`) build
their keysend records here: bLIP-10 JSON in TLV 7629169, the message in 7629171, Sphinx in 133773310.
They kept two copies until 2026-11-16, and the copies drifted. The file header records each field choice
and the reason; read it before you add, rename or drop a field. In short:

- `podcast` is the feed title, which for an ITDV album is the album. `guid` is the feed GUID.
- `remote_feed_guid`/`remote_item_guid` stay on purpose: Helipad names the song from them, and BoostBot
  builds its lnbeats link from `remote_feed_guid`. There is no `feedID`: the old numbers were wrong.
- `value_msat` is the one split's amount; `value_msat_total` is the whole boost.
- An auto boost is action `auto`, in the TLV and in BoostBox (`postToBoostBox(..., 'auto')`).
- WebLN `keysend({ customRecords })` takes **text** values; the wallet encodes them. NWC `pay_keysend`
  takes hex, through `toHexTlvRecords`. The auto boost once put hex into WebLN, so receivers got hex text.
- A Lightning-address split is paid through LNURL-pay. `buildLnurlComment` adds the sender and the
  message, and `lib/lnurl-service.ts` cuts the comment to the LUD-12 `commentAllowed` length.

`npx tsx scripts/check-boost-messages.ts` asserts the records, the LNURL comment, the note text and the
publish route (with fake relays and a throwaway key). Run it after you touch any of these files.

### /boosts sources (`app/boosts/page.tsx`)
The page (Doerfel-Pad) merges three sources. They are read in the browser.

- **The site's own boost notes** (`NEXT_PUBLIC_SITE_NOSTR_NPUB`, the 200 newest): album boosts from this app.
- **Boostr Bot notes** (since 2026-11-24). Boostr_Bot (`adab4ccd…0649`, Chad's BoostBox Nostr bot) is a 1%
  split (`boostr@getalby.com`) in the Into The Doerfel-Verse podcast feed and posts each boostagram it
  receives as a kind 1. The page reads only notes with `["i","podcast:guid:41aace28-8679-5ef1-9958-75cf76c2b5f0"]`
  (Chad: the bot is in no other ITDV feed), all of them, paged with `until`
  (`BoostToNostrService.fetchAllUserBoosts`). The live subscription takes all of the bot's notes, and
  `parseBoostrNote` drops the other shows. `lib/boostr-note.ts` reads the text; its layout is boostbox's
  `->note-content` (ChadFarrow/boostbox `src/boostbox/boostagram.clj`), so change the two together. The
  split is only on the livestream item and Ep 74 and later (2026-09-16 on), so older episodes' boosts never
  reach the bot.
- **Helipad records** (`/api/helipad-webhook` into Postgres; boosts read by `/api/helipad-boosts`, streams by
  `/api/streams`). Two senders, told apart by their token (Bearer prefix optional):
  - TJ's Helipad (`HELIPAD_AUTH_TOKEN`, source `tj-helipad`): every payment TJ's node receives, albums
    included. TJ entered the URL in his Helipad. Helipad sends only new records; old ones come back only
    from a Helipad CSV export.
  - Helipad-to-Nostr-BoostBot (`BOOSTBOT_WEBHOOK_TOKEN`, source `boostbot`): the streams and auto boosts of
    Chad's Helipad (the ChadF split), forwarded unchanged by its `forwardUrl`/`forwardToken` settings.

  An unset token matches nothing, so with neither set every POST gets 401. Only records for an ITDV feed are
  stored (`lib/itdv-feeds.ts`: the podcast GUID or an album `feedGuid` from `public/static-albums.json`, as
  the boostagram's `guid` or `remote_feed_guid`, else the exact title); any other show answers 200
  `stored:false`, so the sender does not retry. The route writes one log line per request
  (`helipad-webhook source=… action=… result=…`) and never the body: it carries listener names and messages.
  A store failure also logs its reason (`helipad-store <op> failed: …`, through `describeError`: the WebSocket
  path fails with an ErrorEvent, not an Error). Both use `lib/server-log.ts`, because production strips
  `console.*` (see "To check production without posting").
  A store failure answers 503 on all three routes, so the page can tell "no rows" from "store down".

**The Streams tab** (since 2026-11-24, `components/StreamsTab.tsx`) shows one row per listener and episode,
built from Helipad action 1 (stream) and 4 (auto) records; every other action goes to the boost list. One
listener payment arrives as several records: one per split on TJ's node, one on Chad's node, and one per
sent split when Chad is the listener. They arrive up to about 90 s apart (BoostBot measured 86 s, and a
minute bucket once split one boost in two). So `lib/stream-records.ts` gives each record a payment key. A
record joins the oldest payment with the same identity (feed, item, listener, app, `value_msat_total`) that
has a record within 120 s, unless that payment already has a record from the same source and recipient
(`custom_key:custom_value`, or the sent split's destination) or a record with another playback `ts` (when
both carry one; 0 counts as missing); then it starts a new payment. The oldest, not the nearest: a split
that arrives ~90 s late would otherwise join the next minute's payment and count one too many. `ts` is
not in the identity because a Lightning-address record has none: Helipad stores that payment's
`x-rss-payment` JSON as `tlv`, which names the feed `feed_guid` and the item `item_guid` (helipad
`src/metadata.rs`), while the keysend splits of the same payment carry `guid`, `episode_guid` and `ts`. `lib/helipad-storage.ts` inserts in one transaction under `pg_advisory_xact_lock(hashtext(identity))`,
so splits that arrive together share one key, and the summary counts each payment once
(`DISTINCT ON (payment_key)`). A resent record is matched by source, Helipad index, and sent or received:
Helipad numbers its sent and received records in two tables. Stream and auto rows keep no raw `tlv`. Rows
stored before 2026-11-24 have no `kind`: those with action 2 or 5 count as boosts, and old stream (1) and
auto (4) rows show nowhere (no payment key, and a stream is never a boost card). The open tab is kept in localStorage
`boosts_tab_v1`.

A Helipad record that is the same boost as a Boostr card is hidden (Chad: "check for duplicates and hide
them"): same total sats, same message, at most 600 s apart, and not a stream (`sameBoost` in
`lib/boost-dedupe.ts`). Helipad's `action` is a number: 1 stream, 2 boost, 4 auto (helipad
`dbif/src/boosts.rs`); `isHelipadStream` is the one copy (it read 2 as a stream until 2026-11-24). Helipad
cards group by payment key, so the splits of one boost show as one card. A Boostr card's "Listen" link is the bot's app link only: the note's
`r` tag is a link the payer chose, so it is never rendered. The localStorage cache is `boosts_cache_v3` (v3: stream cards left the list); bump it again when the card fields change.
`npx tsx scripts/check-boostr-notes.ts` covers the reader, the dedupe and the backfill paging.

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

### Hook dependency arrays — the repo keeps zero `exhaustive-deps` warnings
`npm run build` runs lint and this repo currently reports **no** `react-hooks/exhaustive-deps`
warnings. Keep it that way, and fix the cause rather than adding a blanket disable — several of the
eight warnings cleared in August 2026 were reporting genuine stale-closure bugs, not style issues.

**A callback that outlives the render that created it must read state through a ref.**
`app/boosts/page.tsx` reads `boosts` inside the Nostr subscription's `onBoost`. That effect has no
dependencies deliberately — listing `boosts` would tear down and rebuild the subscription on every
incoming boost — so a direct read was pinned to the first render's empty array and the Helipad
duplicate check silently never matched. It now mirrors state into `boostsRef`, kept in sync by a
small effect. Anything scheduled with `setTimeout`, `requestIdleCallback`, or a relay subscription
needs the same treatment.

A warning here is also worth reading as a question about whether the code should exist at all. The
same class of bug in `AlbumDetailClient`'s deferred loaders turned out to be unreachable: they
populated `relatedAlbums`/`podrollAlbums`, which were read only by a `getCombinedRelatedAlbums` that
nothing called. Chasing the closure bug first, and only then checking who consumed the output, meant
fixing ~240 lines that were then deleted outright. Check the consumer before the mechanism.

**Declare a callback before whatever names it in a dependency array.** Dependency arrays evaluate at
render time, so naming a `const` declared further down throws a TDZ `ReferenceError` — this is why
`loadAlbumsData` sits above `loadCriticalAlbums` in `app/page.tsx` and why `PublisherDetailClient`'s
mount effect sits below its loaders. Moving them back to "read better" will break at runtime, not at
build.

**Timer handles are refs, not state** (`components/CDNImage.tsx`). Holding one in `useState`
re-renders on every set/clear and makes it a reactive value, which is what forced the disables that
used to live on those effects.

**One disable is legitimate and stays**: the bootstrap effect in `app/page.tsx`. `loadCriticalAlbums`
depends on `albums.length`, so listing it would re-run the initial load the moment it sets albums —
a refetch loop. It carries an explicit comment saying so; anything similar should too.

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
npx next lint                                 # should report zero warnings — keep it there
ADMIN_PASSWORD=<same> ./scripts/security-smoke.sh   # 53 checks, needs dev (or next start) running
npx tsx scripts/backfill-album-dates.ts       # asserts the date extractor still agrees
npx tsx scripts/check-boost-messages.ts       # boost records, LNURL comment, note text, publish route
npx tsx scripts/check-boostr-notes.ts         # /boosts: Boostr Bot note reader, card dedupe
npx tsx scripts/check-streams.ts              # Streams tab: record kind, ITDV filter, payment keys
npx tsx scripts/check-feed-fetch.ts           # feed fetch: private-address guard, time/size limits, channel scoping
npx tsx scripts/check-media-proxy.ts          # media proxies: address guard, redirects, time/size limits, media type, HLS chain
npx tsx scripts/check-hls-rewrite.ts          # HLS playlist rewrite: every link form, keys, CRLF, exact query round trip
npx tsx scripts/check-user-agent.ts           # the one User-Agent: form, version, link; no other UA literal
node --experimental-strip-types scripts/check-relay-publish.mjs   # relay publish: OKs, timeouts, the upgrade's User-Agent
node scripts/e2e-media-proxy.mjs <base-url>   # browser: proxied art, the big GIF, two tracks, 3 Cloudflare videos play (needs internet)
STREAMS_TEST_DB=1 npx tsx scripts/check-streams-store.ts   # Helipad store, on a LOCAL database
STREAMS_TEST_DB=1 npx tsx scripts/check-webhook.ts         # webhook tokens, filter, 503s, log lines (local DB)
node scripts/e2e-boosts-streams.mjs <base-url> # browser test of both tabs (local DB + dev; see its header)
```

The store checks, the webhook check and the browser test delete rows, so they need the local database in
`scripts/local-db.md` (Homebrew Postgres plus `scripts/local-neon-ws-proxy.mjs`, which stands in for Neon's
WebSocket and HTTP proxy). They refuse any host but `localhost`. Never point a test at Vercel's
`POSTGRES_URL`: it is set for Preview and Development too. `@vercel/postgres`'s `sql` always goes through
Neon's HTTP API and `db.connect()` through its WebSocket, so the relay serves both; and a dynamic `import()`
of the store in a script loads the driver's ESM copy beside the CJS one, so the local proxy setting is lost
(use static imports). For the Boosts tab in local dev, set `NEXT_PUBLIC_SITE_NOSTR_NPUB` (any npub): without
it the page stops at "Site Nostr account not configured" before the Helipad cards render.

`security-smoke.sh` takes the base URL as its first argument (default `http://localhost:3000`).
After a Next upgrade, run it against `npm run build && next start`, not only dev (see "Next is pinned").

`backfill-album-dates.ts` rewrites the `indexedAt` timestamp in `public/album-index.json` on every run.
When that is its only change, revert the file rather than commit it.

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

- **The production database password is stale** (found 2026-11-24). Every query from Vercel failed with
  `password authentication failed for user 'neondb_owner'`: the hand-added `POSTGRES_URL` no longer matches
  the Neon database. Until 2026-11-24 the webhook still answered success with `stored:false`, so TJ's Helipad
  saw no error while nothing was kept, and `/api/albums` fails the same way. Chad fixes it from the Neon
  console (Production only, Sensitive). Until then `/boosts` shows no Helipad cards and the Streams tab says
  "Streams are unavailable right now". `POSTGRES_URL` is also set for Preview and Development, so a preview
  build or `vercel env pull` reaches the live store.

- **The old site Nostr key is compromised; rotation is deferred by choice.** `NEXT_PUBLIC_SITE_NOSTR_NSEC`
  was set in Vercel, so that private key shipped in every client bundle built while the code
  referenced it, and a Nostr identity cannot be revoked. Accepted risk: it is a bot account, and the
  exposure is impersonation only — it grants no admin access and no access to Lightning funds, which
  go through NWC/Bitcoin Connect and separate keys.

  Nothing is currently leaking: since signing moved server-side the client no longer reads that
  variable, so Next stopped inlining it. Verified against production — 14 chunks across `/`,
  `/boosts` and `/album/them` contain no `nsec` literal and no `NEXT_PUBLIC_SITE_NOSTR_*` reference.
  Git history is clean too.

  The stale `NEXT_PUBLIC_SITE_NOSTR_NSEC` var was **deleted from Vercel on 2026-10-30**, so the key
  cannot be re-inlined even if future code references that name again. The same key now lives in
  server-only `SITE_NOSTR_NSEC`. Full rotation (new pair, `SITE_NOSTR_NSEC` +
  `NEXT_PUBLIC_SITE_NOSTR_NPUB`, plus a migration note from the old key announcing the new npub) is
  only needed if the identity starts mattering.
- **`/api/albums` takes ~47 seconds.** It re-parses every RSS feed on a cache miss. It works in
  production (measured: 200, 1.5MB, 46.7s) but returns 500 locally, where Postgres is not
  provisioned. It only matters as the second fallback behind `/api/albums-static-cached` — there is
  a third, reading `public/static-albums.json` directly — so the site never depends on it. Nothing
  else calls it since the dead album-page loaders were removed. Treat it, `lib/db.ts` and
  `/api/admin/ensure-feed` as a candidate for deletion if Postgres is not coming back; do not wire
  new callers to it in the meantime.
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
- **Boost gaps left open on 2026-11-16** (the boost metadata fix, see Architecture Notes):
  - An album boost's boostagram (TLV and BoostBox) still sends track 1's item GUID, which Helipad uses
    to name the boost. Its note no longer does (2026-11-17).
  - The home page and Now Playing boosts pay node splits only, so Lightning-address splits get nothing
    from them. The album page's track boost pays both.
  - The NWC fallback loop in `BitcoinConnect.tsx` ignores `fixedAmount`, so it skips the 2-sat
    "ITDV Site Metadata" payment.
  - `lib/nwc-service.ts` `payKeysend` reads an amount of 1,000,000 or more as msats.
  - Each split's boostagram gets its own `uuid`, so a receiver cannot group the splits of one boost.
  - /boosts shows "Auto boost for" as the message of the auto-boost notes posted before 2026-11-16 (the
    parser removes the title).
  - /boosts merges site and Helipad cards with the same title, artist and message (`deduplicateBoosts`,
    `lib/boost-dedupe.ts`) and ignores the sender, so two listeners who boost one track with the same
    message (or none) show as one card. Boostr Bot cards are exempt: they are keyed by event id.
