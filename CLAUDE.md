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
- `/lib` - Core utilities and services
- `/public` - Static assets
- `/scripts` - Utility scripts for deployment and maintenance

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

Writers: `app/api/admin/manage-feeds/route.ts` (POST/PUT/DELETE), `scripts/regenerate-static-cache-direct.ts` (full rebuild from `data/feeds.json`), `scripts/reparse-affected.ts` (single- or multi-feed reparse with assertions).

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

### Video player and shuffle
- `contexts/VideoContext.tsx` owns video play state, separate from `AudioContext`. The global now-playing bar (`components/GlobalNowPlayingBar.tsx`) reads from whichever has a current item.
- `components/VideoPlayer.tsx` accepts `externalIsPlaying` to sync the DOM `<video>` element with `VideoContext.isPlaying` (so the bottom-bar play/pause actually drives the video).
- A track is "video" if it has `videoUrl`. A "chapter" track has `videoUrl + startTime + endTime` and represents a segment of a longer video.
- Global shuffle (`app/page.tsx:289-293`) skips video-only tracks (`!track.url`); hybrid audio+video tracks are shuffled and play as audio.

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md

## Testing Guidelines
1. Test on both desktop and mobile devices
2. Verify PWA functionality
3. Check CDN integration
4. Validate RSS feed parsing
5. Test audio playback across different scenarios

## Performance Requirements
1. Fast initial page load
2. Optimized image loading
3. Efficient audio streaming
4. Smooth transitions between pages
5. Reliable offline functionality

## Security Considerations
1. Secure API endpoints
2. Safe CDN usage
3. Protected admin routes
4. Proper environment variable handling
5. Regular security audits
6. BoostBox API key is client-side (`NEXT_PUBLIC_` prefix) by design — BoostBox expects this