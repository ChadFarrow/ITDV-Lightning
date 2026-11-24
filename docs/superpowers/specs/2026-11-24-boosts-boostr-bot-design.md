# /boosts: read Boostr Bot notes next to TJ's Helipad webhook

Date: 2026-11-24. Status: waiting for Chad's approval.

## Why

`/boosts` (Doerfel-Pad) got its boost list from a webhook that TJ entered in the Helipad on his
node. That webhook stores into Postgres through `/api/helipad-webhook`. On 2026-11-24 the store
holds 0 boosts, so the page shows only the site's own "ITDV App" notes, newest 2026-10-30.

The Into The Doerfel-Verse podcast feed
(`https://www.doerfelverse.com/feeds/intothedoerfelverse.xml`, guid
`41aace28-8679-5ef1-9958-75cf76c2b5f0`) has Chad's Boostr Bot in its splits
(`boostr@getalby.com`, 1%). The bot posts each boostagram it receives as a public kind 1 note.
On 2026-11-24 the relays held 31 such notes for ITDV (2026-09 to 2026-11-24). The page shows none.

## Decision (Chad, 2026-11-24: option 3)

Show both sources. Add the Boostr Bot notes now. Keep the Helipad webhook read, so that TJ's
boosts come back when his webhook works again. A boost that both sources carry shows once.

## Approaches considered

1. Boostr Bot only: works today with no step for TJ; loses album boosts from other apps.
2. TJ's webhook only: gets every boost his node receives; depends on TJ and his node.
3. Both (picked): Boostr now, the webhook when TJ fixes it, with a cross-source dedupe.

## Design

**Source.** Boostr_Bot pubkey `adab4ccd313996520304a5b1ec6c4076bc271bc6a3236702321c5811009d0649`.
Filter `{kinds:[1], authors:[bot], '#i':['podcast:guid:41aace28-8679-5ef1-9958-75cf76c2b5f0']}`,
on the relays `BoostToNostrService` already uses (they include relay.fountain.fm and
chadf.nostr1.com, which held all 31 notes; primal held 14). The live subscription gets the same
filter. The `#i` filter keeps the bot's notes for other shows off the page: only the ITDV podcast
notes show (Chad, 2026-11-24). The page loads every such note the bot has (backfill, Chad
2026-11-24): no `since`, paged with `until`. On 2026-11-24 the bot had 318 notes, 31 of them ITDV,
and every one of the 31 carries the `i` tag.

**Reader.** A new `lib/boostr-note.ts`, client-safe and ES5-regex-safe like `lib/boost-note.ts`.
`parseBoostFromEvent` sends a note from the bot's pubkey to it before the `⚡ Boost ⚡` prefix check,
because the bot's notes start with the same line but use a different sentence
(`<sender> boosted <N> sats → <show>`, from `->note-content` in boostbox
`src/boostbox/boostagram.clj`). It reads:

- amount: the `amount` tag (msat); the text's sats if the tag is missing;
- app: the `app` tag;
- sender name, show: the last line that matches the attribution sentence ("Boosted N sats" when
  there is no sender);
- message: the lines between the header and that sentence (a message can have blank lines);
- episode: the `📻 ` line after the sentence;
- links: the app link after `🎧 Find it on` / `▶️ Listen on`; the `r` tag; the `sender` tag (npub)
  for the Profile link.

**Card.** Title is the episode (or the show when there is no episode), the line under it is the
show. "Sent by" is the sender. A badge names the app. Nostr replies load as for other Nostr cards.

**Dedupe.** `deduplicateBoosts` keys on title + artist + message, so two podcast boosts on one
episode with the same message (or none) merge today. Bot cards key on the event id. Across
sources, a Helipad record and a bot note are the same boost when the total sats and the
normalized message match and the times are within 10 minutes; the page keeps the bot card
(it has replies and links).

**Helipad.** The page keeps reading `/api/helipad-boosts` and its 30-second poll. The webhook
requires `HELIPAD_AUTH_TOKEN` (an invalid POST gets 401), so TJ's Helipad must send that token.

**Security fix in the same PR.** `DELETE /api/helipad-boosts` clears the whole store with no auth
check. No code calls it. It gets the admin session check, and `scripts/security-smoke.sh` gets a
check that an unauthenticated DELETE is refused.

**Text.** The subtitle stops naming Helipad as the only source. The localStorage cache key gets a
new version, so an old cache does not hide the new cards.

## Limits (tell Chad)

- The Boostr split is only on the livestream item and Ep 74 to Ep 83 (from 2026-09-16). Boosts to
  older episodes do not reach the bot, so they show only through TJ's webhook.
- The bot gets 1%. A boost under 100 sats pays it under 1 sat, and an app can skip such a split.

## Tests

- `scripts/check-boostr-notes.ts`: the reader against real bot notes saved as fixtures
  (sender/no sender, message with blank lines, no episode, app link or none), and the
  cross-source dedupe against Helipad-shaped records.
- `npx tsc --noEmit`, `npm run build` (lint), `scripts/security-smoke.sh` on `next start`.
- Headless Chrome on the dev server: the bot cards show, newest first, with sats, sender,
  message, episode; desktop and phone width (CDP device emulation).
- Not testable here: a live webhook boost from TJ's Helipad (the store is empty).

## Not in scope

Deleting the webhook route or its database; changing the bot; the old notes' format.
