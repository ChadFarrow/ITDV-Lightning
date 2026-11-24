# /boosts Streams tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Streams" tab on `/boosts` that sums each listener's ITDV streams and auto boosts per episode, fed by TJ's Helipad webhook and by Chad's BoostBot forwarding.

**Architecture:** `/api/helipad-webhook` learns two senders (token decides the source), keeps ITDV records only, normalizes each record at insert (kind, feed, listener, payment key) under an advisory lock, and answers 503 when the store fails. A new public `/api/streams` returns summary rows from SQL. The page gets two tabs. BoostBot (second repo) forwards stream and auto events to the webhook.

**Tech Stack:** Next.js 15.5.28 (pinned), TypeScript (target es5), `@vercel/postgres` 0.10 on Neon, Tailwind; check scripts run with `npx tsx`. BoostBot: Express + `node --test` via tsx.

**Spec:** `docs/superpowers/specs/2026-11-24-boosts-streams-design.md` (approved by Chad 2026-11-24). Read it first.

## Global Constraints

- Repo order (workspace rule 5): ITDV-Lightning tasks 1–5 are merged before BoostBot task 6 starts. Task 7 (vibe-kit) last.
- ITDV branch: `boosts-streams` (exists, pushed; holds the spec). Squash-merge with `gh pr merge <n> --squash --match-head-commit <sha>` after tests and checks (workspace rule 7).
- `tsconfig` targets es5: no `for..of` over `Map`/`Set` (use `.forEach`), no regex lookbehind. Lint must stay at zero warnings, including `react-hooks/exhaustive-deps`.
- Never run `npm run build` while `npm run dev` runs.
- Never write to the production database. `POSTGRES_URL` in Vercel is set for Preview too and its password is stale; tests use a local database only.
- No token value in a chat, a log line, a commit or a command line. Chrome for tests starts with `--mute-audio`, `--disable-features=MacAppCodeSignClone`, `--user-data-dir="${TMPDIR:-/tmp}/chrome-$CLAUDE_CODE_SESSION_ID"`.
- Names fixed by the spec: env `HELIPAD_AUTH_TOKEN` (source `tj-helipad`), env `BOOSTBOT_WEBHOOK_TOKEN` (source `boostbot`); kinds `stream` (action 1), `auto` (action 4), `boost` (everything else kept); payment window 120 s; live window 180 s; summary page size 50; tab poll 30 s.
- ITDV feeds = `ITDV_PODCAST_GUID` from `lib/boostr-note.ts` plus every `feedGuid` in `public/static-albums.json`.
- BoostBot on the Ubuntu server is never stopped, restarted, edited or deployed by an agent. Chad deploys.

## Review Focus

1. A boostagram with `ts: 0` and two real payments 60 s apart from one listener: two payments, not one (task 1 test `noTsTwoPayments`).
2. One album payment arriving as four TJ-node records (Ben, Kurt, Joey, DoerfelVerse_Node; different `custom_value`) plus Chad's split: one payment (task 1 test `albumSplitsOnePayment`, task 2 test `concurrentInsertsOneKey`).
3. A `tlv` that is not JSON, or is JSON without `guid`, and a `podcast` that matches no ITDV title: dropped, 200, nothing stored, nothing logged but the count (task 3 test).
4. Store down: the webhook answers 503 (so Helipad shows a failed delivery) and the Streams tab shows "Streams are unavailable", not "no streams" (task 3 and task 4).
5. Old rows with no `kind` (stored before this change) stay in the boost list and never reach the Streams tab (task 2 test `legacyRowIsBoost`).

---

### Task 1: Pure stream logic and its checks

**Files:**
- Create: `lib/stream-records.ts` (client-safe: no `fs`, no Node imports)
- Create: `scripts/check-streams.ts`
- Create: `scripts/fixtures/helipad-records.json` (Helipad-shaped records, hand-made from bLIP-10 fields; include one with `tlv` not JSON)

**Interfaces:**
- Produces (all exported from `lib/stream-records.ts`):
  - `type StreamKind = 'stream' | 'auto' | 'boost'`
  - `type RecordSource = 'tj-helipad' | 'boostbot'`
  - `interface HelipadRecord` — the webhook payload fields of the route's `HelipadBoostPayload` plus `direction?: string`, `memo?: string | null`, `list_type?: number`.
  - `interface Boostagram { feedGuid?: string; remoteFeedGuid?: string; itemGuid?: string; episode?: string; podcast?: string; senderName?: string; appName?: string; valueMsatTotal?: number; ts?: number }` (`ts` 0 or negative → `undefined`)
  - `parseBoostagram(tlv: string | undefined | null): Boostagram | null` — reads bLIP-10 keys `guid`, `remote_feed_guid`, `episode_guid` (else `item_guid`), `episode`, `podcast`, `sender_name`, `app_name`, `value_msat_total`, `ts`; `null` for non-JSON.
  - `classifyRecord(r: HelipadRecord): StreamKind`
  - `interface ItdvFeedIndex { guids: Set<string>; titles: Map<string, string> }` (keys lower-cased, trimmed)
  - `buildItdvFeedIndex(albums: { feedGuid?: string; title?: string }[], podcastGuid: string, podcastTitle: string): ItdvFeedIndex`
  - `interface ItdvMatch { feedGuid: string | null; showTitle: string; viaShow: string | null }` — `viaShow` is the other show's title when only `remote_feed_guid` is ITDV.
  - `matchItdvFeed(r: HelipadRecord, b: Boostagram | null, index: ItdvFeedIndex): ItdvMatch | null`
  - `interface NormalizedRecord` = `HelipadRecord & { source: RecordSource; kind: StreamKind; feedGuid: string | null; itemKey: string; listener: string; showTitle: string; itemTitle: string; viaShow: string | null; recipient: string; playbackTs: number | null; identity: string; time: number }`
    - `listener`: sender name, `'Anonymous'` when empty; `itemKey`: item guid, else lower-cased episode title; `recipient`: `custom_key:custom_value` for received, `payment_info.pubkey:payment_info.custom_value` for sent (`direction === 'outgoing'` or `payment_info` present); `time`: Helipad `time` (seconds), else now.
  - `normalizeRecord(r: HelipadRecord, source: RecordSource, index: ItdvFeedIndex, nowSeconds: number): NormalizedRecord | null` (`null` = not ITDV)
  - `paymentIdentity(n: NormalizedRecord): string` — joins feedGuid ?? showTitle, itemKey, listener (lower-cased), app (lower-cased), valueMsatTotal, playbackTs ?? '' with `|`.
  - `interface PaymentCandidate { paymentKey: string; source: RecordSource; recipient: string; time: number }`
  - `assignPaymentKey(n: NormalizedRecord, candidates: PaymentCandidate[], newKey: () => string): string`
  - `interface StreamSummaryRow { listener: string; itemTitle: string; showTitle: string; viaShow: string | null; totalSats: number; streams: number; autos: number; apps: string[]; firstTime: number; lastTime: number; live: boolean }`
  - `PAYMENT_WINDOW_SECONDS = 120`, `LIVE_WINDOW_SECONDS = 180`

- [ ] **Step 1: Write `scripts/check-streams.ts`** in the style of `scripts/check-boostr-notes.ts` (`check`/`equal`/`fail`, prints the count, exit 1 on a failure). Checks, each named in its message:
  - `classify`: action 1 → `stream`; 4 → `auto`; 2 → `boost`; 5 → `boost`; undefined → `boost`.
  - `parseTs0`: `parseBoostagram('{"ts":0}')?.ts === undefined`; non-JSON → `null`.
  - `itdvByGuid`: record with tlv `guid` = ITDV podcast guid → match, `viaShow` null.
  - `itdvByRemote`: tlv `guid` = other show, `remote_feed_guid` = an album guid from the fixture → match, `showTitle` = album title, `viaShow` = the other show's `podcast`.
  - `itdvByTitle`: no tlv guid, `podcast` = `'into the doerfel-verse '` → match.
  - `notItdv`: other guid, other title → `normalizeRecord` returns `null`; non-JSON tlv with other title → `null`.
  - `albumSplitsOnePayment`: five records (four `tj-helipad` with `custom_value` 4, 3, 13, and none; one `boostbot`), same identity, times within 90 s, fed one by one through `assignPaymentKey` with the growing candidate list → one key.
  - `crossBucket`: two records of one payment at `time` 12:56:58 and 12:57:07 → one key.
  - `noTsTwoPayments`: same listener, same amount, `ts` 0, same `source` and `recipient`, 60 s apart → two keys.
  - `outsideWindow`: same identity, 121 s apart → two keys.
  - `listenerDefault`: empty `sender` → `'Anonymous'`.

- [ ] **Step 2: Run it and see it fail**
  Run: `npx tsx scripts/check-streams.ts` — Expected: fails to import `lib/stream-records`.

- [ ] **Step 3: Implement `lib/stream-records.ts`** to the interfaces above. `assignPaymentKey`: among candidates with `|time − n.time| ≤ 120`, take the payment keys whose records do not already include `(n.source, n.recipient)`; return the one with the nearest time, else `newKey()`.

- [ ] **Step 4: Run it and see it pass**
  Run: `npx tsx scripts/check-streams.ts` — Expected: `✅ … checks passed`, exit 0. Also `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** `lib/stream-records.ts`, the script, the fixture: `Add stream record logic for the /boosts Streams tab`.

### Task 2: Store — schema, locked insert, boost and summary reads

**Files:**
- Modify: `lib/helipad-storage.ts`
- Create: `scripts/check-streams-store.ts` (runs only when `STREAMS_TEST_DB=1`; refuses to run when `POSTGRES_URL` does not point to `localtest.me` or `localhost`)
- Create: `scripts/local-db.md` (how to start and stop the local database; no secrets)

**Interfaces:**
- Consumes: task 1 types and functions.
- Produces:
  - `class StoreUnavailableError extends Error`
  - `addHelipadRecord(n: NormalizedRecord): Promise<{ stored: true; paymentKey: string; updated: boolean }>` — replaces `addHelipadBoost` (its only caller is the webhook); throws `StoreUnavailableError` on any DB error.
  - `getHelipadBoosts(limit: number): Promise<StoredHelipadBoost[]>` — boosts only (`kind = 'boost' OR kind IS NULL`), newest first; each row also carries `source` and `paymentKey`; throws `StoreUnavailableError`.
  - `getStreamSummary(opts: { limit: number; offset: number; nowSeconds: number }): Promise<StreamSummaryRow[]>`; throws `StoreUnavailableError`.
  - `getHelipadBoostsCount()` unchanged in name; throws instead of returning 0.

- [ ] **Step 1: Start a local database** and write the steps to `scripts/local-db.md`. Postgres: `docker load -i /Volumes/NAS/reference/downloads/docker/images/postgres_16.tar` into Colima (`colima start --cpu 4 --memory 4`), or use the Ubuntu sandbox's Docker (`--memory 1g --cpus 1`, ports 4000–4099). `@vercel/postgres` talks to Neon over WebSocket, so add a local Neon proxy (for example `ghcr.io/timowilhelm/local-neon-http-proxy`; after the first download, `docker save` it to `/Volumes/NAS/reference/downloads/docker/images/` and add a README line). Known traps, verify each: `sql` refuses a non-pooled string, so use a host with `-pooler` that resolves to 127.0.0.1 (e.g. `ep-local-pooler.localtest.me`); set `neonConfig.wsProxy`, `useSecureWebSocket = false`, `pipelineTLS = false`, `pipelineConnect = false` only when `process.env.LOCAL_NEON_PROXY` is set (check that `@vercel/postgres` re-exports `neonConfig`; else import it from `@neondatabase/serverless`, which it depends on). Put that guard in `lib/helipad-storage.ts`, nowhere else.

- [ ] **Step 2: Write `scripts/check-streams-store.ts`** against the local DB (drops and re-creates `helipad_boosts` first). Checks:
  - `migrate`: an old-schema table (the current `CREATE TABLE`) gains the new columns; a row inserted before stays readable.
  - `legacyRowIsBoost`: that old row (no `kind`) is returned by `getHelipadBoosts` and absent from `getStreamSummary`.
  - `indexCollision`: `tj-helipad` index 512 and `boostbot` index 512, same `value_msat` → two rows.
  - `sameSourceIndexUpdates`: the same `(source, index)` twice → one row, `updated: true`.
  - `concurrentInsertsOneKey`: the five records of task 1's `albumSplitsOnePayment` inserted with `Promise.all` → one distinct `payment_key`.
  - `summary`: three listeners' fixtures → rows with `totalSats` summed once per payment (`value_msat_total / 1000`, floored), `streams`/`autos` counts, sorted by `lastTime` desc, `live` true only within 180 s of `nowSeconds`, `apps` distinct.
  - `boostsOnly`: 60 stream rows and 3 boosts → `getHelipadBoosts(50)` returns the 3 boosts.
  - `unavailable`: with `POSTGRES_URL` pointing at a closed port, each read and `addHelipadRecord` rejects with `StoreUnavailableError`.

- [ ] **Step 3: Run it and see it fail** — `STREAMS_TEST_DB=1 POSTGRES_URL=<local> LOCAL_NEON_PROXY=<host:port> npx tsx scripts/check-streams-store.ts`. Expected: missing exports.

- [ ] **Step 4: Implement.** Migration: `ALTER TABLE helipad_boosts ADD COLUMN IF NOT EXISTS` for `source TEXT`, `payment_key TEXT`, `kind TEXT`, `identity TEXT`, `feed_guid TEXT`, `item_key TEXT`, `listener TEXT`, `show_title TEXT`, `item_title TEXT`, `via_show TEXT`, `recipient TEXT`, `playback_ts INTEGER`; indexes on `payment_key`, `(identity, boost_time)`, `(kind, timestamp DESC)`, `(source, boost_index)`. Insert in one transaction on a client from `db.connect()`: `SELECT pg_advisory_xact_lock(hashtext(identity))`, duplicate check on `(source, boost_index)`, candidate query `WHERE identity = $1 AND abs(boost_time - $2) <= 120`, `assignPaymentKey` with `crypto.randomUUID()`, then insert. Stream and auto rows store `tlv` as NULL; boost rows keep it. Summary in SQL: `DISTINCT ON (payment_key)` over `kind IN ('stream','auto')`, then `GROUP BY listener, item_key, item_title, show_title, via_show`, `ORDER BY max(boost_time) DESC`, `LIMIT/OFFSET`.

- [ ] **Step 5: Run it and see it pass.** Also re-run `npx tsx scripts/check-streams.ts` and `npx tsc --noEmit`.

- [ ] **Step 6: Commit**: `Store: normalized Helipad records, one key per payment, boosts-only reads`.

### Task 3: Webhook, boosts API and Streams API

**Files:**
- Modify: `app/api/helipad-webhook/route.ts` (rewrite the POST handler body; remove the never-run Nostr posting branch and the `getBoostToNostrService` import)
- Modify: `app/api/helipad-boosts/route.ts` (503 on `StoreUnavailableError`; drop the `debug` field; clamp `limit` to 1–100)
- Create: `app/api/streams/route.ts` (GET; `limit` clamped 1–100, default 50; `offset` ≥ 0; `dynamic = 'force-dynamic'`)
- Create: `lib/itdv-feeds.ts` (server-only: builds the `ItdvFeedIndex` once from `public/static-albums.json` via `fs`, podcast title `Into The Doerfel-Verse`)
- Modify: `scripts/security-smoke.sh` (new checks)
- Create: `scripts/check-webhook.ts` (calls the route's exported `POST` with `NextRequest`s against the local DB; same guard as task 2)

**Interfaces:**
- Consumes: tasks 1–2.
- Produces: `GET /api/streams` → `200 { success: true, rows: StreamSummaryRow[] }` or `503 { success: false, error: 'store unavailable' }`. `POST /api/helipad-webhook` → 401 `{ error: 'Unauthorized' }` | 200 `{ success: true, stored: false, reason: 'not itdv' }` | 200 `{ success: true, stored: true, kind, paymentKey }` | 503 `{ success: false, error: 'store unavailable' }` | 400 for bad JSON or missing `value_msat`.

- [ ] **Step 1: Write `scripts/check-webhook.ts`.** Checks: TJ token → stored with `source` `tj-helipad`; BoostBot token → `boostbot`; wrong token → 401; both env vars unset → 401 for any token; `Bearer` prefix optional, as today; a token of another length → 401 without throwing; non-ITDV → 200 `stored: false` and no row; bad JSON → 400; store down (closed port) → 503; the route logs no line containing the request body (capture `console.log`/`console.error` and assert no `sender` value appears).
- [ ] **Step 2: Run it, see it fail.**
- [ ] **Step 3: Implement.** Token compare: export a length-tolerant constant-time compare from `lib/admin-auth.ts` (it has a private `constantTimeEquals`; export it, do not copy it). One log line per request: `helipad-webhook source=<s> action=<n> result=<stored|dropped|401|503>`.
- [ ] **Step 4: Add to `scripts/security-smoke.sh`**: POST `/api/helipad-webhook` without a token → 401; with `Authorization: Bearer wrong` → 401; `GET /api/streams?limit=100000` → 200 or 503, never 500; `GET /api/helipad-boosts` has no `debug` key.
- [ ] **Step 5: Run everything:** `npx tsx scripts/check-webhook.ts`, the task 1–2 checks, `npx tsc --noEmit`. Then `npm run build` (zero warnings) and, with `next start` on the local DB and `ADMIN_PASSWORD` set, `./scripts/security-smoke.sh` — every check passes (count it from the output).
- [ ] **Step 6: Commit**: `Webhook: two senders, ITDV records only, 503 when the store fails; add /api/streams`.

### Task 4: Page — tabs and Streams list

**Files:**
- Create: `components/StreamsTab.tsx` (fetches `/api/streams`, polls 30 s only while mounted, renders rows)
- Modify: `app/boosts/page.tsx` (tab bar; mount `StreamsTab`; Helipad grouping key; no stream cards)

**Interfaces:**
- Consumes: `GET /api/streams` (task 3), `StreamSummaryRow` type (task 1).
- Produces: localStorage key `boosts_tab_v1` (`'boosts' | 'streams'`), read and written in try/catch.

- [ ] **Step 1: Implement the tab bar** under the stats grid: `⚡ Boosts` and `🌊 Streams`, buttons with `aria-pressed`, each at least 24×24 CSS px. The Boosts tab renders today's content unchanged.
- [ ] **Step 2: Implement `StreamsTab`.** Row layout (spec §4), exact copy: line 1 `<listener> · <itemTitle>`; line 2 `<showTitle>` plus ` · in <viaShow>` when set; line 3 `<totalSats.toLocaleString()> sats · <streams> streams · <autos> auto · <apps joined with ", "> · <relative time>` (omit a zero count part), and a `live` badge when `row.live`. States: loading; empty → `No streams yet`; 503 → `Streams are unavailable right now`. Reuse the page's `formatTimestamp` (move it to `lib/` only if both need it).
- [ ] **Step 3: Boost list.** `fetchHelipadBoosts` groups by `boost.paymentKey` when present, else `${boost.source}-index-${boost.index}`, then the old fallback. Delete the `🌊 Stream` badge path (`isStreamAction`) from the card: streams never reach the list now. Keep `isHelipadStream` in `lib/boost-dedupe.ts` (used by `sameBoost`). Bump the cache key `boosts_cache_v2` → `boosts_cache_v3`. The subtitle stays as it is.
- [ ] **Step 4: Browser test** (headless Chrome over CDP, `npm run dev` on the local DB seeded by a small script that POSTs fixture records to the webhook with a local test token): Boosts tab shows the seeded boosts and no stream card; Streams tab shows the summary rows in order, with totals equal to `scripts/check-streams-store.ts`'s expected values; a `live` row; reload keeps the open tab; stop the DB → Streams tab shows the unavailable text. Desktop 1280×800 and phone 390×844 via `Emulation.setDeviceMetricsOverride` with `mobile: true`; `scrollWidth ≤ clientWidth`; tab buttons ≥ 24×24. Quit Chrome with `Browser.close`, delete its profile.
- [ ] **Step 5: Lint/build** — `npx next lint` zero warnings, `npm run build` (dev stopped first).
- [ ] **Step 6: Commit**: `/boosts: Streams tab with one row per listener and episode`.

### Task 5: CLAUDE.md, PR, merge

**Files:**
- Modify: `CLAUDE.md` — in "/boosts sources": the Streams tab, the two tokens and sources, ITDV-only filter, payment key rule (and why: splits on one node, 86 s spread), 503 behaviour, `scripts/check-streams.ts` and `check-streams-store.ts` / `check-webhook.ts` in "Local development & verification", `scripts/local-db.md`. In "Known outstanding issues": the stale `POSTGRES_URL` password (until Chad fixes it) and that `POSTGRES_URL` covers Preview too.
- Modify: spec status line → `Status: approved 2026-11-24; built in PR #<n>`.

- [ ] **Step 1:** Update both files; commit `Document the Streams tab`.
- [ ] **Step 2:** Rerun all checks of tasks 1–4 and `security-smoke.sh` on `next start`. Push.
- [ ] **Step 3:** `gh pr create` (base `main`). Body: what it does; what was verified in the browser; gaps with reasons (no real Helipad or BoostBot delivery: needs Chad's steps; production DB password stale); Chad's steps 0–4 from the spec. End with the attribution lines.
- [ ] **Step 4:** `gh pr checks <n> --watch`, then `gh pr merge <n> --squash --match-head-commit <headRefOid>`. Delete the local branch after `gh pr view` shows `MERGED` (rule 13). Stop Colima or the sandbox containers; delete the local DB volume.

### Task 6: BoostBot forwards streams and auto boosts (repo Helipad-to-Nostr-BoostBot)

**Files:**
- Create: `lib/forward.ts`, `lib/forward.test.ts`
- Modify: `lib/config.ts` (`forwardUrl: string`, `forwardToken: string`, env names `FORWARD_URL`, `FORWARD_TOKEN`), `lib/settings-api.ts` (secret list and `redactConfig`: `forwardTokenConfigured`), `public/index.html` + `public/settings.js` (two fields, the token as a password field cleared after save, as `webhookToken`), `helipad-webhook.ts` (call the forwarder; short log line for stream/auto events), `CLAUDE.md`, `README.md` (settings table).

**Interfaces:**
- Produces: `shouldForward(event: { action?: number; _source?: string }): boolean` (true for action 1 or 4 with `_source === 'helipad'`); `forwardEvent(event: object, cfg: { forwardUrl: string; forwardToken: string }, fetchImpl?: typeof fetch): Promise<number | null>` (POST JSON, `Authorization: Bearer`, 5 s `AbortSignal.timeout`, returns the status or `null`, never throws). The `_source` key is removed from the forwarded body.

- [ ] **Step 1:** Read the repo `CLAUDE.md`; `git fetch`; branch `forward-streams` from `origin/main`.
- [ ] **Step 2:** Write `lib/forward.test.ts`: stream and auto forwarded; boost (2) and invoice (5) not; an NWC-sourced event not; empty `forwardUrl` → no call; body equals the Helipad event without `_source`; header carries the token; a rejecting fetch and a 5 s hang both resolve `null`; the token never appears in a logged line.
- [ ] **Step 3:** Run `npm test`, see the new tests fail. Implement. Call `forwardEvent` without `await` after `announceHelipadPayment`, so a slow target never delays the answer to Helipad. Run `npm test` — all pass. Typecheck as the repo does.
- [ ] **Step 4:** Commit, push, PR, checks, merge (rule 7). The StartOS package is unchanged.

### Task 7: Chad's steps and the secrets map (repo vibe-kit, then the report)

- [ ] **Step 1:** In vibe-kit `secrets-map.json`, add `itdv-boostbot-webhook-token` (kind `manual`, source "Chad"; copies: Vercel `itdv-lightning-fixed` Production `BOOSTBOT_WEBHOOK_TOKEN`, BoostBot `config.json` `forwardToken` on the Ubuntu server) and `itdv-postgres-url` (source: the Neon console; copy: Vercel Production `POSTGRES_URL`). Render, `--check`, PR, merge, `auto-update.mjs`.
- [ ] **Step 2:** Give Chad, in the final report, the steps from spec §6 with exact commands, values never shown:
  - token: `openssl rand -hex 32 | tr -d '\n' | vercel env add BOOSTBOT_WEBHOOK_TOKEN production --sensitive` run where the project is linked; the same value into the Keychain and into the BoostBot settings page (`secrets-map.mjs --store itdv-boostbot-webhook-token`, then `security find-generic-password -a shared -s shared/itdv-boostbot-webhook-token -w | tr -d '\n' | pbcopy`). Order these so one value goes to all three places; check the exact flags of `vercel env add` in the installed CLI first.
  - deploy BoostBot: `ssh boostbot 'cd ~/Helipad-to-Nostr-BoostBot && git pull && npm install && sudo systemctl restart helipad-bot'` (from BoostBot `CLAUDE.md`), then `forwardUrl` = `https://itdv.podtards.com/api/helipad-webhook` and the token in its settings page.
  - his Helipad trigger: tick Stream and Auto; turn on metadata fetching.
  - TJ: only after the database works and no TJ boost arrives.
- [ ] **Step 3:** Add one To do line per Chad step to `~/Vibe/project-notes/notes/todo/ITDV-Lightning.md` (rule 11; group word `setup`), pull, push.
