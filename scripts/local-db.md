# A local database for the store checks and the browser test

Never point a test at the production database. `POSTGRES_URL` in Vercel is also set for Preview
and Development, so a preview build or `vercel env pull` reaches the live store.

`@vercel/postgres` runs on Neon's serverless driver, which talks to Postgres over a WebSocket.
Locally, a plain Postgres plus a small relay (`scripts/local-neon-ws-proxy.mjs`) stands in for Neon.
The driver uses the relay only when `LOCAL_NEON_PROXY` is set (`lib/helipad-storage.ts`), and it
accepts a non-pooled connection string only when the host is exactly `localhost`.

## Start (Homebrew Postgres, no Docker)

```bash
DATA="${TMPDIR:-/tmp}/itdv-pg-$$"   # any empty folder outside the repo
/opt/homebrew/opt/postgresql@17/bin/initdb -D "$DATA" -U postgres --auth=trust >/dev/null
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D "$DATA" -o "-p 54329 -k '' -c listen_addresses=127.0.0.1" -l "$DATA/log" start
/opt/homebrew/opt/postgresql@17/bin/createdb -h 127.0.0.1 -p 54329 -U postgres itdv
node scripts/local-neon-ws-proxy.mjs 54330 54329 &

export POSTGRES_URL=postgres://postgres:local@localhost:54329/itdv
export LOCAL_NEON_PROXY=127.0.0.1:54330
```

Then:

```bash
STREAMS_TEST_DB=1 npx tsx scripts/check-streams-store.ts
STREAMS_TEST_DB=1 npx tsx scripts/check-webhook.ts
```

`-k ''` turns off the Unix socket (macOS limits its path to 103 bytes, and a temporary folder
path is often longer). `trust` auth and `127.0.0.1` only: the database holds test rows and is reachable from this Mac only.
Docker works as well (`postgres:16`, a copy is on the NAS in
`/Volumes/NAS/reference/downloads/docker/images/postgres_16.tar`); the relay stays the same.

## Stop

```bash
kill %1                      # the relay
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D "$DATA" stop
rm -rf "$DATA"
```
