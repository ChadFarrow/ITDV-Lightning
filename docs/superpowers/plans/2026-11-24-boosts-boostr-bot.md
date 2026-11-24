# /boosts Boostr Bot Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/boosts` shows the Boostr Bot's Nostr notes for the Into The Doerfel-Verse podcast next to the site's own notes and TJ's Helipad webhook boosts, and an unauthenticated request can no longer wipe the Helipad store.

**Architecture:** A client-safe reader (`lib/boostr-note.ts`) turns a Boostr_Bot kind 1 note into fields; `lib/boost-dedupe.ts` takes over `deduplicateBoosts` from the page and adds the cross-source rule. The page fetches the bot's notes with a `#i` filter next to the site's notes and renders them as their own card type. `DELETE /api/helipad-boosts` gets the admin session check.

**Tech Stack:** Next.js 15.5.28, TypeScript (target es5), nostr-tools, `npx tsx` assertion scripts (no test framework).

**Spec:** `docs/superpowers/specs/2026-11-24-boosts-boostr-bot-design.md`

## Global Constraints

- Boostr_Bot pubkey: `adab4ccd313996520304a5b1ec6c4076bc271bc6a3236702321c5811009d0649`.
- ITDV podcast guid: `41aace28-8679-5ef1-9958-75cf76c2b5f0`; the `i` tag value is `podcast:guid:41aace28-8679-5ef1-9958-75cf76c2b5f0`.
- Note text layout is boostbox `->note-content` (`~/Vibe/boostbox/src/boostbox/boostagram.clj`, read-only): `⚡ Boost ⚡`, blank, optional message, `<sender> boosted <N> sats → <show>` or `Boosted <N> sats → <show>`, optional `📻 <episode>`, optional `🎧 Find it on <label>` / `▶️ Listen on <label>` plus URL line, blank, banner URL.
- `lib/` modules used by the page: no lookbehind or other post-ES5 regex syntax; no `for..of` over `Map`/`Set`.
- Only the bot's ITDV podcast notes show (Chad, 2026-11-24: the bot is only in that feed). On 2026-11-24 the bot had 318 notes; all 31 that name "→ Into The Doerfel-Verse" carry the `i` tag, and no other note carries it.
- Backfill (Chad, 2026-11-24): the page loads every ITDV note the bot has, not a recent window: no `since`, paged with `until` until a page comes back short.
- Duplicates are hidden, not flagged (Chad, 2026-11-24). Cross-source match: same total sats, same normalized message, `|Δt| ≤ 600` s, Helipad record not a stream (`action !== 2`). The bot card wins.
- localStorage keys become `boosts_cache_v2` and `boosts_cache_time_v2`.
- Subtitle copy: `Recent boosts from the ITDV app and the Into The Doerfel-Verse podcast, with replies from the Nostr network`.
- Do not run `npm run build` while `npm run dev` runs (CLAUDE.md).

## Review Focus

1. A Boostr_Bot note for another show arrives on the live subscription → it must not show. (Task 1: `parseBoostrNote` returns null without the ITDV `i` tag.)
2. A boost message that itself contains a line like `Bob boosted 5 sats → X` → that line stays in the message; the attribution is the last matching line. (Task 1 test.)
3. A note with no `amount` tag, or a non-numeric one → the sats come from the sentence. (Task 1 test.)
4. A browser with the old `boosts_cache` from the previous release → the bot cards still show at once. (Task 3 browser step seeds the old key.)
5. A Helipad stream (action 2) with the same sats and no message near a bot boost → both stay. (Task 2 test.)

---

### Task 1: Boostr note reader

**Files:**
- Create: `lib/boostr-note.ts`
- Create: `scripts/fixtures/boostr-itdv-notes.json` (copy of `/private/tmp/claude-501/-Users-chad-mini-Vibe-ITDV-Lightning/9e922a3a-9041-467c-88a1-8f16c30bf078/scratchpad/boostr-itdv-events.json`: 31 public signed events; if missing, re-query the relays with the Global Constraints filter)
- Create: `scripts/check-boostr-notes.ts` (same `check`/`equal`/`fail` helpers and header style as `scripts/check-boost-messages.ts`)
- Modify: `CLAUDE.md` (add `npx tsx scripts/check-boostr-notes.ts` to the command block under "Local development & verification")

**Interfaces:**
- Produces:
  - `export const BOOSTR_BOT_PUBKEY: string`, `export const ITDV_PODCAST_I_TAG: string`
  - `export interface BoostrNote { sats: number; sender?: string; show?: string; message?: string; episode?: string; app?: string; listenUrl?: string; boostUrl?: string; senderNpub?: string }`
  - `export function parseBoostrNote(event: { pubkey: string; content: string; tags: string[][] }): BoostrNote | null`

- [ ] **Step 1: Write the failing checks** in `scripts/check-boostr-notes.ts`. Pick fixture events by `created_at`:
  - all 31 fixtures parse non-null, each with `sats > 0` and `show === 'Into The Doerfel-Verse'`;
  - 2026-11-24T13:43:01Z: `sats 3333`, `sender 'HeyCitizen'`, `episode 'Ep 83 - Jon Ross'`, `app 'Castamatic'`, `message 'Ah, finally a patrician valueverse musician who recognizes that Tony Banks is the GOAT!'`, `listenUrl 'https://castamatic.com/guid/41aace28-8679-5ef1-9958-75cf76c2b5f0'`, `boostUrl 'https://castamatic.com/boost/ECE103D8-BDED-44DD-B445-2073294A38C3'`, `senderNpub undefined`;
  - 2026-11-12T01:32:19Z (Matt Finlay): message equals the fixture's text from `🚨 BREAKING NEWS 🚨` through `🤣`, blank line included; `senderNpub 'npub12znrejs4k94kp5efhyhk9rzr9jxpy6ymgrlf6py4awpkkhed7cmshs6yg6'`; `listenUrl undefined`; `app 'BoostMeBuddy'`;
  - 2026-11-11T21:10:43Z (DuhLaurien): `episode undefined`, `sats 3333`;
  - synthetic (bot pubkey, ITDV `i` tag, no `amount` tag): content `⚡ Boost ⚡\n\nBoosted 100 sats → Into The Doerfel-Verse` → `sats 100`, `sender undefined`, `message undefined`;
  - synthetic: `amount` tag `'abc'` → sats from the sentence;
  - synthetic: message line `Bob boosted 5 sats → X` above the real sentence `Ann boosted 21 sats → Into The Doerfel-Verse` → `sender 'Ann'`, message contains the Bob line;
  - null for: another pubkey; no ITDV `i` tag; content with no attribution sentence.
- [ ] **Step 2: Run** `npx tsx scripts/check-boostr-notes.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `parseBoostrNote` in `lib/boostr-note.ts`.** Split lines; scan from the end for the last line matching `^(?:(.+) boosted|Boosted) (\d+) sats?(?: → (.+))?$`; message = lines after the header up to that line, trimmed, undefined if empty; episode = a `📻 ` line after it; the line after `🎧 Find it on ` / `▶️ Listen on ` is `listenUrl` when it starts with `https://`; `boostUrl` = first `r` tag; `app` = `app` tag item 1; `senderNpub` = `sender` tag item 1 when it starts with `npub1`; sats = `floor(amount tag / 1000)` when the tag is digits, else the sentence's N.
- [ ] **Step 4: Run** `npx tsx scripts/check-boostr-notes.ts`. Expected: `✅ … checks passed`.
- [ ] **Step 5: Commit** `lib/boostr-note.ts`, the fixture, the script, `CLAUDE.md`: `feat(boosts): read Boostr Bot notes`.

### Task 2: Dedupe module with the cross-source rule

**Files:**
- Create: `lib/boost-dedupe.ts`
- Modify: `app/boosts/page.tsx:286-334` (delete `normalizeString` use for dedupe and `deduplicateBoosts`; import from the lib; keep `normalizeString` if the render key still needs it, or import it)
- Test: `scripts/check-boostr-notes.ts` (add a section)

**Interfaces:**
- Produces:
  - `export interface DedupeInput { id: string; platform?: string; amount?: string; trackTitle?: string; trackArtist?: string; userMessage?: string; timestamp: number; action?: number }`
  - `export function normalizeString(s: string | undefined | null): string` (moved as is)
  - `export function sameBoost(helipad: DedupeInput, boostr: DedupeInput): boolean`
  - `export function deduplicateBoosts<T extends DedupeInput>(boosts: T[]): T[]`

- [ ] **Step 1: Write the failing checks:**
  - two `platform 'boostr'` cards, same title/artist/message, ids `a`,`b` → both kept;
  - same boostr id twice → one;
  - helipad `{amount '3333', userMessage 'Hi', timestamp t}` + boostr `{amount '3333', userMessage ' hi ', timestamp t+120}` → only the boostr card;
  - same with `t+700` → both;
  - helipad amount `'3332'` → both;
  - helipad `action 2`, no message, same amount, `t+10`, boostr no message → both;
  - two `platform 'nostr'` cards, same title/artist/message, amounts `'50'` and `'100'` → one, amount `'100'` (old rule kept);
  - a non-boostr card with empty title, artist and message → dropped (old rule kept).
- [ ] **Step 2: Run** the script. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** in `lib/boost-dedupe.ts`: boostr cards unique by id; drop each `platform 'helipad'` card for which `sameBoost` holds against any boostr card; the rest go through the old content-key rule unchanged. `sameBoost` compares `parseFloat(amount)`, `normalizeString(userMessage)`, `Math.abs(Δtimestamp) <= 600`, `helipad.action !== 2`.
- [ ] **Step 4: Point the page at the lib** and remove the local copies.
- [ ] **Step 5: Run** the script and `npx tsc --noEmit`. Expected: checks pass; tsc clean.
- [ ] **Step 6: Commit:** `refactor(boosts): move dedupe to lib and match Helipad to Boostr cards`.

### Task 3: Fetch, subscribe and render bot cards

**Files:**
- Modify: `lib/boost-to-nostr-service.ts` (`fetchUserBoosts`, around line 755)
- Modify: `app/boosts/page.tsx` (`ParsedBoost` interface, `parseBoostFromEvent` ~49, `loadBoosts` ~735-1010, live subscription ~1013-1110, subtitle, card ~1400-1530)
- Modify: `CLAUDE.md` (new Architecture Notes section "/boosts sources")

**Interfaces:**
- Consumes: `parseBoostrNote`, `BOOSTR_BOT_PUBKEY`, `ITDV_PODCAST_I_TAG` (Task 1); `deduplicateBoosts` (Task 2).
- Produces: `fetchAllUserBoosts(pubkey: string, iTags: string[], pageSize = 500, maxPages = 20): Promise<Event[]>` (filter `{kinds:[1], authors:[pubkey], '#i': iTags, limit: pageSize, until?}`; next `until` = oldest `created_at` − 1; stop when a page has fewer than `pageSize` events or after `maxPages`; dedupe by id; newest first); `ParsedBoost.senderNpub?: string`; `platform 'boostr'`.

- [ ] **Step 1: Service.** Add `fetchAllUserBoosts` next to `fetchUserBoosts`; leave `fetchUserBoosts` as is.
- [ ] **Step 2: Parser.** In `parseBoostFromEvent`, before `parseBoostNote`: when `event.pubkey === BOOSTR_BOT_PUBKEY`, return the mapped `parseBoostrNote` result or null (never fall through). Map: `trackTitle = noteTitle(episode ?? show)`, `trackArtist = show`, `trackAlbum = sender`, `userMessage = message`, `amount = String(sats)`, `url = listenUrl ?? boostUrl`, `app`, `senderNpub`, `platform 'boostr'`, `isFromApp false`, `isFromHelipad false`.
- [ ] **Step 3: Load.** Fetch the site notes and `fetchAllUserBoosts(BOOSTR_BOT_PUBKEY, [ITDV_PODCAST_I_TAG])` in parallel, each with its own 10 s timeout and its own fallback to `[]`, then concat. Set `isFromApp = true` only when `platform !== 'boostr'` (load and live paths). Rename the cache keys to `boosts_cache_v2` / `boosts_cache_time_v2`.
- [ ] **Step 4: Live.** Subscribe with `authors: [sitePubkey, BOOSTR_BOT_PUBKEY]`; the reader drops other shows.
- [ ] **Step 5: Card.** For `platform 'boostr'`: the show line without "by"; Profile link to `https://primal.net/p/${senderNpub}` only when set; badges `📻 Boostr Bot` and `📱 {app}` when set; React key `boost.id`. Replace the subtitle with the Global Constraints copy.
- [ ] **Step 6: Static checks.** `npx tsc --noEmit`, `npx next lint` (zero warnings), both check scripts. Expected: clean.
- [ ] **Step 7: Browser test** (`ADMIN_PASSWORD=x npm run dev`, headless Chrome with `--mute-audio`, profile in `$TMPDIR/chrome-$CLAUDE_CODE_SESSION_ID`, `Browser.close` after): seed `localStorage.boosts_cache` with `[]` and a fresh `boosts_cache_time` first; then load `/boosts` and assert: a card with `3333 sats`, `Ep 83 - Jon Ross`, `Sent by: HeyCitizen`, the `📻 Boostr Bot` and `📱 Castamatic` badges; the newest card is the newest bot note; every fixture event id has a card (backfill; the oldest is from 2026-09); the site's `📱 ITDV App` cards still show; the Matt Finlay message keeps its line breaks; no card for another show. Repeat at 390×844 with CDP `mobile: true`: `scrollWidth === clientWidth`.
- [ ] **Step 8: CLAUDE.md.** Section "/boosts sources": the three sources; the bot pubkey and `#i` filter; the reader and its source of truth in boostbox; the cross-source rule; Boostr split only on the livestream and Ep 74-83; TJ's Helipad must send `HELIPAD_AUTH_TOKEN` (a POST without it gets 401).
- [ ] **Step 9: Commit:** `feat(boosts): show Boostr Bot notes for the ITDV podcast`.

### Task 4: Lock DELETE /api/helipad-boosts

**Files:**
- Modify: `app/api/helipad-boosts/route.ts` (`DELETE`)
- Modify: `scripts/security-smoke.sh` (one check)
- Modify: `CLAUDE.md` (the smoke check count, 34 → 35, in both places)

**Interfaces:**
- Consumes: `isAuthenticatedRequest(request)` from `lib/admin-auth.ts`.

- [ ] **Step 1: Add the failing check** after the admin DELETE check: `check 401 "unauthenticated DELETE /api/helipad-boosts" -X DELETE "$BASE/api/helipad-boosts"`, with a comment that the script must never send an authenticated DELETE there (it wipes the store). Run it only against a local server with no `POSTGRES_URL`.
- [ ] **Step 2: Run** `ADMIN_PASSWORD=x ./scripts/security-smoke.sh` against dev. Expected: that check FAILS (500 locally, as Postgres is absent).
- [ ] **Step 3: Implement:** `DELETE(request: NextRequest)` returns `401 { error: 'Unauthorized' }` unless `await isAuthenticatedRequest(request)`.
- [ ] **Step 4: Run** the smoke script against `npm run build && next start` (stop dev first). Expected: all 35 pass.
- [ ] **Step 5: Commit:** `fix(security): require admin session to clear Helipad boosts`.

### Task 5: Ship

- [ ] **Step 1:** `npm run build` (dev stopped). Expected: success, no `exhaustive-deps` warnings.
- [ ] **Step 2:** Push the branch, open the PR. The body lists what the browser test verified and the gap: no live Helipad webhook boost (store empty; needs TJ).
- [ ] **Step 3:** Run the browser test of Task 3 again on the Vercel preview URL, if the preview is reachable; `gh pr checks <n> --watch`.
- [ ] **Step 4:** Merge with `gh pr merge <n> --squash --match-head-commit <sha>`; delete the branch (rule 13); report repo, PR, SHA.
