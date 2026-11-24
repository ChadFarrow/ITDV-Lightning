// Assertions for /api/helipad-webhook, /api/streams and /api/helipad-boosts against a LOCAL database.
//
//   STREAMS_TEST_DB=1 npx tsx scripts/check-webhook.ts
//
// Needs POSTGRES_URL on localhost and LOCAL_NEON_PROXY (see scripts/local-db.md); it deletes every
// row of helipad_boosts, so it refuses any other host. It calls the route handlers in-process:
// which token sends a record and how it is labelled, the ITDV filter, bad input, the 503 when the
// store is down, and that no log line carries the request body.

import { spawnSync } from 'node:child_process';
import { NextRequest } from 'next/server';
import { db, sql } from '@vercel/postgres';
// Static imports only: a dynamic import() would load the driver's ESM build beside this file's
// CJS one, and the two copies do not share the local proxy config.
import { POST } from '../app/api/helipad-webhook/route';
import { GET as getStreams } from '../app/api/streams/route';
import { GET as getBoosts } from '../app/api/helipad-boosts/route';
import { ITDV_PODCAST_GUID } from '../lib/boostr-note';
import { describeError, StoreUnavailableError } from '../lib/helipad-storage';

let checks = 0;
function fail(message: string): never {
  process.stderr.write(`❌ ${message}\n`);
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
  if (host !== 'localhost' && !/\.localtest\.me$/.test(host)) fail('POSTGRES_URL must point to localhost: this script deletes rows');
  if (!process.env.LOCAL_NEON_PROXY) fail('set LOCAL_NEON_PROXY (see scripts/local-db.md)');
}

// Production builds strip every console.* call (next.config.js `removeConsole`), so a server line
// that must reach Vercel's logs is written with process.stdout/stderr.write (lib/server-log.ts).
// `logged` keeps console calls apart, swallowed, to prove the routes make none; `written` is
// what reaches stdout and stderr.
const logged: string[] = [];
const written: string[] = [];
for (const stream of [process.stdout, process.stderr]) {
  const original = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
  (stream as unknown as { write: (chunk: unknown, ...rest: unknown[]) => boolean }).write = (chunk, ...rest) => {
    written.push(...String(chunk).split('\n').filter(Boolean));
    return original(chunk, ...rest);
  };
}
(['log', 'info', 'warn', 'error'] as const).forEach(level => {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logged.push(args.map(a => (typeof a === 'string' ? a : a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a))).join(' '));
    if (process.env.CHECK_VERBOSE) original(...args);
  };
});

const TJ_TOKEN = 'tj-token-0123456789abcdef';
const BB_TOKEN = 'bb-token-fedcba9876543210';
const CANARY = `LogCanary${Date.now()}`;
const T0 = 1793364000;
let nextIndex = 7000;

function payload(extra: Record<string, unknown> = {}) {
  return {
    index: nextIndex++, time: T0, value_msat: 33000, value_msat_total: 100000, action: 1,
    sender: CANARY, app: 'Castamatic', message: `${CANARY} message`, podcast: 'Into The Doerfel-Verse', episode: 'Ep 83 - Jon Ross',
    tlv: JSON.stringify({ action: 'stream', guid: ITDV_PODCAST_GUID, episode_guid: 'ep83', sender_name: CANARY, app_name: 'Castamatic',
      value_msat_total: 100000, ts: 1250 + nextIndex }),
    custom_key: '696969', custom_value: '1',
    ...extra,
  };
}

async function post(body: unknown, auth?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth !== undefined) headers.authorization = auth;
  const response = await POST(new NextRequest('http://localhost/api/helipad-webhook', {
    method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function rowCount(): Promise<number> {
  return Number((await sql`SELECT count(*)::int AS n FROM helipad_boosts`).rows[0].n);
}

async function storeDownMode() {
  process.env.HELIPAD_AUTH_TOKEN = TJ_TOKEN;
  const res = await post(payload(), `Bearer ${TJ_TOKEN}`);
  equal(res.status, 503, 'storeDown: the webhook answers 503');
  equal(res.json, { success: false, error: 'store unavailable' }, 'storeDown: the webhook body');
  const streams = await getStreams(new NextRequest('http://localhost/api/streams'));
  equal(streams.status, 503, 'storeDown: /api/streams answers 503');
  const boosts = await getBoosts(new NextRequest('http://localhost/api/helipad-boosts'));
  equal(boosts.status, 503, 'storeDown: /api/helipad-boosts answers 503');
  check(!logged.concat(written).some(line => line.includes(CANARY)), 'storeDown: no log line carries the request body');
  check(written.some(line => /^helipad-webhook source=tj-helipad action=1 result=503$/.test(line)), 'storeDown: the webhook logs result=503 where production keeps it');
  const storeLine = written.find(line => /^helipad-store \S+ failed: /.test(line)) || '';
  check(storeLine !== '', 'storeDown: the store logs why it failed where production keeps it');
  check(!storeLine.includes('[object Object]'), `storeDown: the reason is readable, not [object Object] (${storeLine})`);
  check(logged.length === 0, `storeDown: nothing goes through console.*, which production strips (${logged.length})`);
  // Production's insert runs on db.connect() (WebSocket), whose failure is an ErrorEvent, not an
  // Error; String() of it is "[object Object]".
  const wsError: unknown = await db.connect().then(client => { client.release(); return null; }, (error: unknown) => error);
  check(wsError !== null && !(wsError instanceof Error), 'storeDown: a WebSocket failure is not an Error');
  check(/ECONNREFUSED/.test(describeError(wsError)), `storeDown: describeError reads the event (${describeError(wsError)})`);
  check(/ECONNREFUSED/.test(new StoreUnavailableError(wsError).message), 'storeDown: StoreUnavailableError names the cause');
  process.stdout.write(`✅ ${checks} store-down checks passed\n`);
  process.exit(0);
}

async function main() {
  if (process.argv.includes('--store-down')) return storeDownMode();
  assertLocal();

  // Both tokens unset: closed for everyone, even an empty token.
  delete process.env.HELIPAD_AUTH_TOKEN;
  delete process.env.BOOSTBOT_WEBHOOK_TOKEN;
  equal((await post(payload(), 'Bearer anything')).status, 401, 'unset: a token is refused when no token is configured');
  equal((await post(payload(), 'Bearer ')).status, 401, 'unset: an empty token is refused');
  equal((await post(payload())).status, 401, 'unset: no header is refused');

  process.env.HELIPAD_AUTH_TOKEN = TJ_TOKEN;
  process.env.BOOSTBOT_WEBHOOK_TOKEN = BB_TOKEN;
  // The first stored request migrates the table; start from an empty one.
  await post(payload(), `Bearer ${TJ_TOKEN}`);
  await sql`DELETE FROM helipad_boosts`;

  // tjToken
  {
    const res = await post(payload(), `Bearer ${TJ_TOKEN}`);
    equal(res.status, 200, 'tjToken: 200');
    equal({ stored: res.json?.stored, kind: res.json?.kind, success: res.json?.success }, { stored: true, kind: 'stream', success: true }, 'tjToken: stored as a stream');
    check(typeof res.json?.paymentKey === 'string', 'tjToken: answers the payment key');
    const row = (await sql`SELECT source FROM helipad_boosts ORDER BY id DESC LIMIT 1`).rows[0];
    equal(row?.source, 'tj-helipad', 'tjToken: the row is labelled tj-helipad');
  }

  // boostbotToken, without the Bearer prefix
  {
    const res = await post(payload({ action: 4 }), BB_TOKEN);
    equal(res.status, 200, 'boostbotToken: 200 without the Bearer prefix');
    equal(res.json?.kind, 'auto', 'boostbotToken: action 4 is an auto boost');
    const row = (await sql`SELECT source FROM helipad_boosts ORDER BY id DESC LIMIT 1`).rows[0];
    equal(row?.source, 'boostbot', 'boostbotToken: the row is labelled boostbot');
  }

  // wrong tokens
  const before = await rowCount();
  equal((await post(payload(), 'Bearer wrong')).status, 401, 'wrongToken: 401');
  equal((await post(payload(), `Bearer ${TJ_TOKEN}0`)).status, 401, 'wrongToken: a longer token is 401, no throw');
  equal((await post(payload(), `Bearer ${TJ_TOKEN.slice(0, 5)}`)).status, 401, 'wrongToken: a shorter token is 401, no throw');
  equal((await post(payload())).status, 401, 'wrongToken: no header is 401');
  equal(await rowCount(), before, 'wrongToken: nothing stored');

  // notItdv
  {
    const res = await post(payload({
      podcast: 'Homegrown Hits',
      tlv: JSON.stringify({ guid: '0e3d8f4c-1111-4c3a-9d55-000000000001', podcast: 'Homegrown Hits', sender_name: CANARY }),
    }), `Bearer ${TJ_TOKEN}`);
    equal(res.status, 200, 'notItdv: 200');
    equal(res.json, { success: true, stored: false, reason: 'not itdv' }, 'notItdv: not stored');
    equal(await rowCount(), before, 'notItdv: no row');
  }

  // bad input
  equal((await post('{not json', `Bearer ${TJ_TOKEN}`)).status, 400, 'badJson: 400');
  equal((await post(payload({ value_msat: undefined }), `Bearer ${TJ_TOKEN}`)).status, 400, 'missingValue: 400');
  equal((await post([1, 2], `Bearer ${TJ_TOKEN}`)).status, 400, 'notAnObject: 400');

  // a boost keeps its message and stays in the boost list
  {
    const res = await post(payload({ action: 2 }), `Bearer ${TJ_TOKEN}`);
    equal(res.json?.kind, 'boost', 'boost: action 2 is a boost');
    const list = await getBoosts(new NextRequest('http://localhost/api/helipad-boosts?limit=100000'));
    const body = await list.json();
    equal(list.status, 200, 'boostList: 200');
    check(!('debug' in body), 'boostList: no debug field');
    equal(body.boosts.length, 1, 'boostList: only the boost, not the stream or the auto boost');
    equal(body.boosts[0].source, 'tj-helipad', 'boostList: rows carry their source');
  }

  // /api/streams
  {
    const res = await getStreams(new NextRequest('http://localhost/api/streams?limit=100000&offset=-5'));
    equal(res.status, 200, 'streams: 200 with a huge limit and a negative offset');
    const body = await res.json();
    equal(body.success, true, 'streams: success');
    equal(body.rows.length, 1, 'streams: one listener and episode');
    equal({ listener: body.rows[0].listener, streams: body.rows[0].streams, autos: body.rows[0].autos },
      { listener: CANARY, streams: 1, autos: 1 }, 'streams: the stream and the auto boost count');
  }

  // log lines
  check(!logged.concat(written).some(line => line.includes(CANARY)), 'logs: no log line carries the sender or the message');
  check(written.some(line => /^helipad-webhook source=tj-helipad action=1 result=stored$/.test(line)), 'logs: one summary line per stored request');
  check(written.some(line => /^helipad-webhook source=none action=\S+ result=401$/.test(line)), 'logs: a refused request logs result=401');
  check(written.some(line => /^helipad-webhook source=tj-helipad action=1 result=dropped$/.test(line)), 'logs: a non-ITDV record logs result=dropped');
  check(logged.length === 0, `logs: the routes write nothing through console.*, which production strips (${logged.length})`);

  // storeDown: a second process whose driver points at a closed port.
  {
    const child = spawnSync(process.execPath, [...process.execArgv, __filename, '--store-down'], {
      env: { ...process.env, LOCAL_NEON_PROXY: '127.0.0.1:1' }, encoding: 'utf8', timeout: 60000,
    });
    check(child.status === 0, `storeDown: child process passed\n${child.stdout}${child.stderr}`);
    checks += 12;
  }

  process.stdout.write(`✅ ${checks} checks passed\n`);
  process.exit(0);
}

main().catch(error => fail(`unexpected error: ${error instanceof Error ? error.stack : String(error)}`));
