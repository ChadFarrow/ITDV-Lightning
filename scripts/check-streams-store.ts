// Assertions for the Helipad store behind /boosts and its Streams tab, against a LOCAL database.
//
//   STREAMS_TEST_DB=1 npx tsx scripts/check-streams-store.ts
//
// Needs POSTGRES_URL on localhost and LOCAL_NEON_PROXY (see scripts/local-db.md). It drops and
// re-creates the helipad_boosts table, so it refuses any other host: never the production store.
// It covers lib/helipad-storage.ts: the migration of an old table, the (source, index) duplicate
// check, one payment key per listener payment under concurrent inserts, boosts-only reads, the
// summary rows, and StoreUnavailableError when the database cannot be reached.

import { spawnSync } from 'node:child_process';
import { sql } from '@vercel/postgres';
import { ITDV_PODCAST_GUID } from '../lib/boostr-note';
// Static imports only: a dynamic import() loads the driver's ESM build next to the store's CJS one,
// and the two copies do not share the local proxy config.
import * as store from '../lib/helipad-storage';
import { buildItdvFeedIndex, normalizeRecord, type HelipadRecord, type NormalizedRecord, type RecordSource } from '../lib/stream-records';

let checks = 0;
function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}
function check(condition: unknown, message: string) {
  checks++;
  if (!condition) fail(message);
}
function equal(actual: unknown, expected: unknown, message: string) {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${message}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`);
  }
}

function assertLocal() {
  if (process.env.STREAMS_TEST_DB !== '1') fail('set STREAMS_TEST_DB=1 to run this script (see scripts/local-db.md)');
  let host = '';
  try {
    host = new URL((process.env.POSTGRES_URL || '').replace(/^postgres(ql)?:/, 'http:')).hostname;
  } catch {
    host = '';
  }
  if (host !== 'localhost' && !/\.localtest\.me$/.test(host)) fail('POSTGRES_URL must point to localhost: this script drops tables');
  if (!process.env.LOCAL_NEON_PROXY) fail('set LOCAL_NEON_PROXY (see scripts/local-db.md)');
}

const ALBUM_GUID = 'b2a87a4c-86f0-5194-9eb3-dcba42ce0695';
const index = buildItdvFeedIndex([{ feedGuid: ALBUM_GUID, title: 'Disco Swag - The Album' }], ITDV_PODCAST_GUID, 'Into The Doerfel-Verse');
const T0 = 1793364000;
let nextIndex = 1000;

function record(o: {
  source: RecordSource; sender: string; app: string; guid: string; item: string; episode: string; podcast: string;
  total: number; ts: number; time: number; action?: number; customValue?: string | null; index?: number; value?: number;
  sentTo?: string;
}): NormalizedRecord {
  const r: HelipadRecord = {
    index: o.index ?? nextIndex++, time: o.time, value_msat: o.value ?? Math.floor(o.total / 10), value_msat_total: o.total,
    action: o.action ?? 1, sender: o.sender, app: o.app, message: '', podcast: o.podcast, episode: o.episode,
    tlv: JSON.stringify({ action: 'stream', guid: o.guid, episode_guid: o.item, podcast: o.podcast, episode: o.episode,
      sender_name: o.sender, app_name: o.app, value_msat_total: o.total, ts: o.ts }),
    custom_key: o.customValue == null ? null : '696969', custom_value: o.customValue ?? null,
    ...(o.sentTo ? { direction: 'outgoing', payment_info: { pubkey: o.sentTo, custom_key: null, custom_value: null } } : {}),
  };
  const n = normalizeRecord(r, o.source, index, T0);
  if (!n) fail('fixture record is not ITDV');
  return n;
}

const ep83 = { guid: ITDV_PODCAST_GUID, item: 'ep83', episode: 'Ep 83 - Jon Ross', podcast: 'Into The Doerfel-Verse' };
const ep82 = { guid: ITDV_PODCAST_GUID, item: 'ep82', episode: 'Ep 82 - DOERFELMON', podcast: 'Into The Doerfel-Verse' };
const disco = { guid: ALBUM_GUID, item: 'disco-1', episode: 'Disco Swag', podcast: 'Disco Swag - The Album' };

async function unavailableMode() {
  const expectUnavailable = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
      fail(`unavailable: ${label} resolved`);
    } catch (error) {
      check(error instanceof store.StoreUnavailableError, `unavailable: ${label} throws StoreUnavailableError (got ${String(error)})`);
    }
  };
  await expectUnavailable('getHelipadBoosts', () => store.getHelipadBoosts(10));
  await expectUnavailable('getStreamSummary', () => store.getStreamSummary({ limit: 10, offset: 0, nowSeconds: T0 }));
  await expectUnavailable('getHelipadBoostsCount', () => store.getHelipadBoostsCount());
  await expectUnavailable('addHelipadRecord', () => store.addHelipadRecord(record({ source: 'boostbot', sender: 'A', app: 'X', ...ep83, total: 1000, ts: 1, time: T0 })));
  console.log(`✅ ${checks} unavailable checks passed`);
  process.exit(0);
}

async function main() {
  if (process.argv.includes('--unavailable')) return unavailableMode();
  assertLocal();
  // The store creates and migrates its table only on first use, so the old table goes in first.
  // migrate: start from the table as it was before this change, with one row in it.
  await sql`DROP TABLE IF EXISTS helipad_boosts`;
  await sql`
    CREATE TABLE helipad_boosts (
      id SERIAL PRIMARY KEY, boost_index INTEGER, boost_uuid VARCHAR(255), value_msat BIGINT, value_msat_total BIGINT,
      action INTEGER, sender TEXT, app TEXT, message TEXT, podcast TEXT, episode TEXT, boost_time BIGINT,
      remote_podcast TEXT, remote_episode TEXT, tlv TEXT, reply_sent BOOLEAN, custom_key TEXT, custom_value TEXT,
      payment_info JSONB, platform VARCHAR(20) NOT NULL DEFAULT 'helipad', timestamp BIGINT NOT NULL,
      stored_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), nostr_event_id TEXT, nevent TEXT, nostr_error TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW())`;
  await sql`INSERT INTO helipad_boosts (boost_index, value_msat, value_msat_total, action, sender, app, message, podcast, episode, boost_time, timestamp)
            VALUES (7, 50000, 50000, 2, 'OldTimer', 'Fountain', 'old boost', 'Into The Doerfel-Verse', 'Ep 70', ${T0 - 90000}, ${(T0 - 90000) * 1000})`;

  const columns = async () => (await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'helipad_boosts'`).rows.map(r => r.column_name as string);
  const count = async () => Number((await sql`SELECT count(*)::int AS n FROM helipad_boosts`).rows[0].n);

  // Each insert of this run goes through the store, which migrates on first use.
  await store.addHelipadRecord(record({ source: 'tj-helipad', sender: 'Warmup', app: 'Fountain', ...ep82, total: 2000, ts: 5, time: T0 - 99999 }));
  const cols = await columns();
  ['source', 'payment_key', 'kind', 'identity', 'feed_guid', 'item_key', 'listener', 'show_title', 'item_title', 'via_show', 'recipient', 'playback_ts']
    .forEach(c => check(cols.includes(c), `migrate: column ${c} exists`));

  // legacyRowIsBoost
  {
    const boosts = await store.getHelipadBoosts(50);
    check(boosts.some(b => b.sender === 'OldTimer'), 'legacyRowIsBoost: the old row is in the boost list');
    const rows = await store.getStreamSummary({ limit: 50, offset: 0, nowSeconds: T0 });
    check(!rows.some(r => r.listener === 'OldTimer'), 'legacyRowIsBoost: the old row is not a stream');
  }
  await sql`DELETE FROM helipad_boosts`;

  // indexCollision and sameSourceIndexUpdates
  {
    const a = await store.addHelipadRecord(record({ source: 'tj-helipad', index: 512, value: 1000, sender: 'A', app: 'X', ...ep83, total: 10000, ts: 9, time: T0 }));
    const b = await store.addHelipadRecord(record({ source: 'boostbot', index: 512, value: 1000, sender: 'A', app: 'X', ...ep83, total: 10000, ts: 9, time: T0 + 1 }));
    equal(await count(), 2, 'indexCollision: index 512 from two sources is two rows');
    equal(a.updated || b.updated, false, 'indexCollision: neither insert is an update');
    const again = await store.addHelipadRecord(record({ source: 'tj-helipad', index: 512, value: 1000, sender: 'A', app: 'X', ...ep83, total: 10000, ts: 9, time: T0 }));
    equal(again.updated, true, 'sameSourceIndexUpdates: the same source and index again is an update');
    equal(again.paymentKey, a.paymentKey, 'sameSourceIndexUpdates: the update keeps the payment key');
    equal(await count(), 2, 'sameSourceIndexUpdates: still two rows');

    // Helipad keeps received and sent records in two tables, so one index can be both.
    await store.addHelipadRecord(record({ source: 'boostbot', index: 513, value: 1000, sender: 'ChadF', app: 'X', ...ep83, total: 10000, ts: 11, time: T0 }));
    const sent = await store.addHelipadRecord(record({ source: 'boostbot', index: 513, value: 1000, sender: 'ChadF', app: 'X', ...ep83, total: 10000, ts: 11, time: T0, sentTo: '02ab' }));
    equal(sent.updated, false, 'sentAndReceivedSameIndex: a sent record does not overwrite a received one');
    equal(await count(), 4, 'sentAndReceivedSameIndex: both rows are kept');
  }
  await sql`DELETE FROM helipad_boosts`;

  // takenOutsideWindow: a payment that already has this source and recipient, even from a record
  // outside the window, does not take that record again.
  {
    const a = await store.addHelipadRecord(record({ source: 'tj-helipad', customValue: '1', sender: 'Gus', app: 'Fountain', ...ep83, total: 3000, ts: 0, time: T0 }));
    const b = await store.addHelipadRecord(record({ source: 'boostbot', sender: 'Gus', app: 'Fountain', ...ep83, total: 3000, ts: 0, time: T0 + 100 }));
    const c = await store.addHelipadRecord(record({ source: 'tj-helipad', customValue: '1', sender: 'Gus', app: 'Fountain', ...ep83, total: 3000, ts: 0, time: T0 + 200 }));
    equal(a.paymentKey, b.paymentKey, 'takenOutsideWindow: the late split joins its payment');
    check(c.paymentKey !== a.paymentKey, 'takenOutsideWindow: the next stream is a new payment');
  }
  await sql`DELETE FROM helipad_boosts`;

  // concurrentInsertsOneKey: one album payment, four TJ splits and Chad's split, all at once.
  {
    const splits = [
      record({ source: 'tj-helipad', customValue: '4', sender: 'Bob', app: 'Fountain', ...disco, total: 20000, ts: 300, time: T0 }),
      record({ source: 'tj-helipad', customValue: '3', sender: 'Bob', app: 'Fountain', ...disco, total: 20000, ts: 300, time: T0 + 2 }),
      record({ source: 'boostbot', customValue: null, sender: 'Bob', app: 'Fountain', ...disco, total: 20000, ts: 300, time: T0 + 40 }),
      record({ source: 'tj-helipad', customValue: '13', sender: 'Bob', app: 'Fountain', ...disco, total: 20000, ts: 300, time: T0 + 70 }),
      record({ source: 'tj-helipad', customValue: null, sender: 'Bob', app: 'Fountain', ...disco, total: 20000, ts: 300, time: T0 + 90 }),
    ];
    const results = await Promise.all(splits.map(s => store.addHelipadRecord(s)));
    equal(new Set(results.map(r => r.paymentKey)).size, 1, 'concurrentInsertsOneKey: five concurrent split records share one key');
    const keys = (await sql`SELECT DISTINCT payment_key FROM helipad_boosts`).rows;
    equal(keys.length, 1, 'concurrentInsertsOneKey: one payment_key stored');
    const tlvs = (await sql`SELECT tlv FROM helipad_boosts WHERE tlv IS NOT NULL`).rows;
    equal(tlvs.length, 0, 'retention: stream rows keep no raw tlv');
  }
  await sql`DELETE FROM helipad_boosts`;

  // summary
  {
    const add = (n: NormalizedRecord) => store.addHelipadRecord(n);
    // Alice: three streams on Ep 83 (each split to TJ and to Chad) and one auto boost.
    const aliceTs = [60, 120, 180];
    for (let i = 0; i < aliceTs.length; i++) {
      const ts = aliceTs[i];
      await add(record({ source: 'tj-helipad', customValue: '1', sender: 'Alice', app: 'Fountain', ...ep83, total: 100000, ts, time: T0 + i * 60 }));
      await add(record({ source: 'boostbot', customValue: null, sender: 'Alice', app: 'Fountain', ...ep83, total: 100000, ts, time: T0 + i * 60 + 3 }));
    }
    await add(record({ source: 'tj-helipad', customValue: '1', sender: 'Alice', app: 'v4vmusic', ...ep83, total: 21000, ts: 200, time: T0 + 150, action: 4 }));
    // Bob: two streams on an album track, each as four TJ splits.
    const bobTs = [10, 70];
    const bobSplits = ['4', '3', '13', null];
    for (let i = 0; i < bobTs.length; i++) {
      const ts = bobTs[i];
      for (let j = 0; j < bobSplits.length; j++) {
        const cv = bobSplits[j];
        await add(record({ source: 'tj-helipad', customValue: cv, sender: 'Bob', app: 'Fountain', ...disco, total: 50000, ts, time: T0 - 1000 + i * 60 }));
      }
    }
    // Someone with no name: one stream on Ep 82.
    await add(record({ source: 'boostbot', customValue: null, sender: '', app: 'Castamatic', ...ep82, total: 10500, ts: 30, time: T0 - 5000 }));
    // A boost on the same episode never reaches the summary.
    await add(record({ source: 'tj-helipad', customValue: '1', sender: 'Alice', app: 'Fountain', ...ep83, total: 5000, ts: 0, time: T0 + 100, action: 2 }));

    const rows = await store.getStreamSummary({ limit: 50, offset: 0, nowSeconds: T0 + 200 });
    equal(rows.map(r => r.listener), ['Alice', 'Bob', 'Anonymous'], 'summary: one row per listener and item, newest first');
    equal(rows[0], {
      listener: 'Alice', itemTitle: 'Ep 83 - Jon Ross', showTitle: 'Into The Doerfel-Verse', viaShow: null,
      totalSats: 321, streams: 3, autos: 1, apps: ['Fountain', 'v4vmusic'], firstTime: T0, lastTime: T0 + 150, live: true,
    }, 'summary: Alice counts each payment once, streams and autos apart');
    equal({ total: rows[1].totalSats, streams: rows[1].streams, autos: rows[1].autos, live: rows[1].live, show: rows[1].showTitle },
      { total: 100, streams: 2, autos: 0, live: false, show: 'Disco Swag - The Album' }, 'summary: Bob counts four splits as one payment');
    equal(rows[2].totalSats, 10, 'summary: 10500 msat is 10 sats');
    const page2 = await store.getStreamSummary({ limit: 1, offset: 1, nowSeconds: T0 + 200 });
    equal(page2.map(r => r.listener), ['Bob'], 'summary: limit and offset page the rows');

    // boostsOnly: many stream rows do not push boosts out of the boost list.
    for (let i = 0; i < 60; i++) {
      await add(record({ source: 'boostbot', customValue: null, sender: 'Carol', app: 'Fountain', ...ep82, total: 1000, ts: 1000 + i * 60, time: T0 + 300 + i * 60 }));
    }
    await add(record({ source: 'tj-helipad', customValue: '1', sender: 'Dan', app: 'Fountain', ...ep82, total: 7000, ts: 0, time: T0 + 10, action: 2 }));
    await add(record({ source: 'tj-helipad', customValue: '1', sender: 'Eve', app: 'Fountain', ...ep82, total: 8000, ts: 0, time: T0 + 20, action: 2 }));
    const boosts = await store.getHelipadBoosts(50);
    equal(boosts.length, 3, 'boostsOnly: 60 streams leave the 3 boosts in the boost list');
    check(boosts.every(b => b.action === 2), 'boostsOnly: only boosts in the boost list');
    check(boosts.every(b => b.source === 'tj-helipad' && typeof b.paymentKey === 'string'), 'boostsOnly: rows carry source and paymentKey');
    equal(await store.getHelipadBoostsCount(), 3, 'getHelipadBoostsCount: counts boosts only');
  }

  // unavailable: a second process whose driver points at a closed port.
  {
    const child = spawnSync(process.execPath, [...process.execArgv, __filename, '--unavailable'], {
      env: { ...process.env, LOCAL_NEON_PROXY: 'localhost:1' }, encoding: 'utf8', timeout: 60000,
    });
    check(child.status === 0, `unavailable: child process passed\n${child.stdout}${child.stderr}`);
    checks += 4;
  }

  console.log(`✅ ${checks} checks passed`);
  process.exit(0);
}

main().catch(error => fail(`unexpected error: ${error instanceof Error ? error.stack : String(error)}`));
