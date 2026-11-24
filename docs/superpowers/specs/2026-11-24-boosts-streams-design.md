# /boosts: a Streams tab from TJ's Helipad and Chad's BoostBot

Date: 2026-11-24. Status: waiting for Chad's approval.

## Why

Chad: "Want the ITDV site to also show streaming payments." `/boosts` (Doerfel-Pad) shows boosts only:
the site's own boost notes, the Boostr Bot notes for the ITDV podcast, and TJ's Helipad webhook
(store empty since about 2026-10-30). No source gives the site a stream payment today:

- The Boostr Bot (boostbox) reads streams from its wallet but never posts them: `BBN_ACTIONS`
  defaults to `boost`, on purpose. It is also only a 1% split, so most stream payments skip it.
- TJ's Helipad webhook can carry streams, but nothing sends them now.

## Who gets paid (checked 2026-11-24)

- **TJ's node `doerfels_start9` (`031ce2f1…`)** gets most of the money. The podcast's main split
  `sirtjthewrathful@getalby.com` (35–80% per episode) resolves to it (Alby Hub on that node), and the
  album splits are keysend to it. TJ's Helipad runs on that node.
- **Chad's node `ChadF33` (`032870511…`)** gets `ChadF` 10% of each current episode, `chadf@getalby.com`
  on the channel (10%) and the live item (5%), and Chad's share of 6 of the 50 albums. Chad's Helipad
  runs on his Start9. Its webhooks go to BoostBot (Helipad-to-Nostr-BoostBot, on the Ubuntu server,
  port 3333) and to candr.space.
- Ep 82 and Ep 83 have `valueTimeSplit`s with `remotePercentage` 90, so during songs each local
  recipient gets a tenth. Chad's 10% then becomes 1%, and small stream payments may not reach him.

## Decisions (Chad, 2026-11-24)

1. **Source:** Helipad and BoostBot. No NWC connection, no new wallet secret ("just use helipad and
   boostbot").
2. **Transport:** BoostBot sends each stream to the site's existing webhook (`/api/helipad-webhook`).
   It posts no Nostr note for streams. TJ's Helipad sends to the same webhook directly.
3. **Page:** a "Streams" tab on `/boosts`. One row per listener and episode: total sats, number of
   payments, app, last time. The boost list stays as it is.

## Approaches considered

- **Source.** (a) Helipad webhooks only (TJ's and Chad's); (b) a read-only NWC connection to a
  wallet, polled by the site; (c) both. Chad picked (c), then dropped NWC after he heard that it
  needs a wallet secret in Vercel, new polling code, and read access to the whole wallet. Helipad and
  BoostBot already run.
- **How Chad's streams reach the site.** (a) BoostBot forwards each stream to the site webhook
  (picked); (b) BoostBot posts one Nostr note per listening session and the site reads the notes;
  (c) the Boostr Bot posts streams and auto boosts (`BBN_ACTIONS`). (b) makes public notes and a
  second path into the tab; (c) misses most streams (1% split) and posts about once a minute per
  listener.
- **Page.** (a) a Streams tab with summary rows (picked); (b) the same rows mixed into the boost
  list; (c) one card per payment.

## Goals

- The Streams tab shows each listener's streaming on each ITDV episode or album track, from every
  app that pays TJ's node or Chad's node.
- One listener payment counts once, though up to three records of it arrive (TJ's split, Chad's
  split, and Chad's own sent record when Chad is the listener).
- The boost list does not change, and streams never push boosts out of it.

## Non-goals

- NWC. A Lightning-address (`rss::payment`) stream shows only if Helipad records it (see Limits).
- Posting streams to Nostr, from any bot.
- Changing the Boostr Bot (boostbox) or Helipad itself.
- Deploying BoostBot on the Ubuntu server. That is Chad's step (below).

## Anti-goals

- A stream must never appear as a boost card, and a boost must never disappear from the boost list
  because streams arrived.
- No token in a chat, a log line or a commit.
- No record of another show's listener is stored or logged by the site.

## Design

### 1. Site webhook (`app/api/helipad-webhook/route.ts`)

- **Two senders, two tokens.** TJ's Helipad keeps `HELIPAD_AUTH_TOKEN`. BoostBot gets a new
  server-only `BOOSTBOT_WEBHOOK_TOKEN`. The token that matches sets the record's `source`
  (`tj-helipad` or `boostbot`). Compare both with the length-tolerant constant-time helper the admin
  auth uses. A request that matches neither gets 401. Today the route accepts any request when
  `HELIPAD_AUTH_TOKEN` is unset; from now on a source whose token is unset is closed.
- **ITDV only.** The route keeps a record only when it is for an ITDV feed: the podcast guid
  `41aace28-8679-5ef1-9958-75cf76c2b5f0` or a `feedGuid` in `public/static-albums.json` (all 50
  albums have one). Read the feed guids from the boostagram in `tlv`: `guid` (the feed the listener
  plays) and `remote_feed_guid` (a song inside it, through `valueTimeSplit`). The record is ITDV when
  either one is an ITDV feed, so a Doerfels song played inside another show counts, and the row says
  "in <that show>". When `tlv` has no guid, fall back to an exact, case-insensitive match of
  `podcast` with an ITDV feed title. A non-ITDV record gets 200 `{ stored: false }`, is not stored,
  and is not logged beyond a count. This applies to boosts too: TJ's and Chad's nodes get payments
  for other shows.
- **Logging.** Stop logging the raw body and the raw payload. Log one line per request: source,
  action, kept or dropped.
- **Classification** (one helper, used by the route, the store and the page):
  - stream: `action` 1, or `action` 5 with a memo/message that starts `rss::payment::stream`;
  - auto: `action` 4 (v4vmusic sends one per song; Chad: "some apps might be calling them auto
    boosts");
  - boost: everything else that is kept.
  Streams and auto boosts go to the Streams tab. Boosts go to the boost list, as today.

### 2. Store (`lib/helipad-storage.ts`)

- Add columns `source TEXT` and `payment_key TEXT`, with an index on `payment_key` and one on
  `(action, timestamp)`. `CREATE TABLE IF NOT EXISTS` does not add columns, so use
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.
- **Fix the duplicate check.** Today a record is "the same" when `boost_index` and `value_msat`
  match. Helipad's `index` is local to each node, and stream amounts repeat (for example 1000 msat),
  so TJ's record 512 would overwrite Chad's record 512. The check becomes `(source, boost_index)`.
- **`payment_key`** identifies one listener payment across nodes. Build it from the boostagram: feed
  guid, item guid (or episode title), sender name, app name, `value_msat_total`, and the playback
  position `ts`. When the boostagram has no `ts`, add the minute of `time`. Records with the same
  key are one payment.
- `getHelipadBoosts` (the boost list) returns boosts only, so 50 boosts stay 50 boosts.
- A new query returns the stream summary rows (below).

### 3. Summary API (`app/api/streams/route.ts`, public, read-only)

One row per listener and episode, over distinct `payment_key`s:

- listener: the sender name (`Anonymous` when empty);
- episode: the episode or track title, and the show or album title;
- total sats: the sum of `value_msat_total` / 1000, once per payment (not the split each node got);
- payments: the number of distinct payment keys; streams and auto boosts counted apart;
- apps: the distinct app names;
- first time and last time.

Newest last time first, 50 rows per page. It needs no auth: it shows what the boost list already
shows (sender names that listeners set in their apps). Its `limit` is clamped.

### 4. Page (`app/boosts/page.tsx`)

- Two tabs at the top: `⚡ Boosts` (today's list, unchanged) and `🌊 Streams`.
- A Streams row:
  ```
  ChadF · Ep 83 - Jon Ross
  Into The Doerfel-Verse
  1,200 sats · 12 streams · 2 auto · Castamatic · 2 h ago
  ```
  A row whose last payment is under 3 minutes old shows `live`.
- The Streams tab polls `/api/streams` every 30 s while it is open, like the Helipad poll.
- Helipad stream records stop showing as `🌊 Stream` cards in the boost list.
- Remember the open tab per viewer (localStorage, wrapped in try/catch).

### 5. BoostBot (repo Helipad-to-Nostr-BoostBot, after the ITDV PR merges)

- New settings `forwardUrl` and `forwardToken` (dashboard settings form and `config.json`; the token
  is redacted like `webhookToken`). Empty `forwardUrl` = off, so the change is safe to deploy first.
- In `POST /helipad-webhook`, after the existing processing: when forwarding is on and the event is
  a stream (`action` 1, or `action` 5 with an `rss::payment::stream` memo) or an auto boost
  (`action` 4), POST the Helipad event unchanged to `forwardUrl` with
  `Authorization: Bearer <forwardToken>`. Fire and forget, 5 s timeout, never block or fail the
  Helipad request, log the status code only.
- Events from BoostBot's own NWC client are not forwarded: they carry no stream that Helipad does not
  also send.
- Nostr posting does not change. The default send rules already skip streams.
- Logging: today the handler logs the full event of each webhook. With streams that is a line about
  every minute per listener on the Ubuntu server. Log a stream or auto event as one short line.

### 6. Chad's steps (no agent does these)

1. Make a token and store it in Vercel `itdv-lightning-fixed`, Production, Sensitive, as
   `BOOSTBOT_WEBHOOK_TOKEN`. The plan gives one piped command, so the value never shows.
2. After the BoostBot PR merges: deploy BoostBot on the Ubuntu server (exact commands in the plan),
   then set `forwardUrl` = `https://itdv.podtards.com/api/helipad-webhook` and the token in the
   BoostBot settings page.
3. In Chad's Helipad, on the trigger that sends to BoostBot, tick Stream, Auto and Invoice.
4. TJ: add the webhook again in his Helipad: URL `https://itdv.podtards.com/api/helipad-webhook`,
   the `HELIPAD_AUTH_TOKEN` value as the auth token, Boost, Stream, Auto and Invoice ticked. Chad gives
   TJ the token by a private channel.
5. Add the new token to `vibe-kit/secrets-map.json` (Vercel and BoostBot copies).

## Limits (tell Chad)

- Until TJ adds his webhook again, the tab shows only payments that reach Chad's node: Chad's 10% of
  episodes and 6 albums. During songs in Ep 82/83 Chad's share is 1%, and payments under 1 sat skip it.
- A Lightning-address payment (`rss::payment`, for example Castamatic) shows only if the Helipad
  records it. That needs getalby.com to put the comment into the node's invoice memo; the code does
  not prove it. If Helipad shows such a payment as "Lightning Invoice", it works.
- The site cannot tell two listeners apart when they use the same name, app and amount at the same
  playback position. That is rare.

## Tests

- `scripts/check-streams.ts` (tsx, like the other check scripts): the classifier; the ITDV feed
  filter (guid, title fallback, non-ITDV dropped); `payment_key` (TJ split + Chad split + Chad sent
  record = one payment; two minutes = two payments; no `ts`); the summary rows (totals once per
  payment, stream and auto counts, apps, live).
- The webhook route: both tokens, wrong token, unset token, non-ITDV dropped, the `(source, index)`
  duplicate check.
- BoostBot: `npm test` with new tests for the forward rule (stream, auto, invoice stream forwarded;
  boost and NWC events not; forwarding off; a failing target does not fail the webhook).
- `npx tsc --noEmit`, `npm run build` (zero lint warnings), `scripts/security-smoke.sh` on
  `next start`, plus a check that the webhook answers 401 to a missing or wrong token.
- Headless Chrome against a local build with a local database seeded with Helipad-shaped records
  (never the production database): both tabs, the summary rows, the boost list without stream cards,
  desktop and phone width (CDP device emulation).
- Not testable here: a real stream through TJ's Helipad or Chad's Helipad and BoostBot. Chad checks
  the tab after his steps.

## Left to the builder

- How to run a local Postgres that `@vercel/postgres` can reach for the browser test.
- The exact SQL of the summary query and the page's styling, matched to the existing cards.
