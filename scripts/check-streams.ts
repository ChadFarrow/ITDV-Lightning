// Assertions for the /boosts Streams tab's record logic — the repo's stand-in for unit tests.
//
//   npx tsx scripts/check-streams.ts
//
// It covers lib/stream-records.ts: which kind a Helipad record is, whether it belongs to an ITDV
// feed, how one listener payment is recognised across the split records that TJ's node, Chad's
// node and Chad's own sent records each deliver, and the listener default. The records are
// hand-made in scripts/fixtures/helipad-records.json. Nothing leaves this process.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ITDV_PODCAST_GUID } from '../lib/boostr-note';
import {
  assignPaymentKey,
  buildItdvFeedIndex,
  classifyRecord,
  matchItdvFeed,
  normalizeRecord,
  parseBoostagram,
  paymentIdentity,
  type HelipadRecord,
  type NormalizedRecord,
  type PaymentCandidate,
} from '../lib/stream-records';

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
  if (actual !== expected) fail(`${message}\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`);
}

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'helipad-records.json'), 'utf8'));
const records = fixture.records as Record<string, HelipadRecord>;
const index = buildItdvFeedIndex(fixture.albums, ITDV_PODCAST_GUID, 'Into The Doerfel-Verse');
const NOW = 1793370000;

// classify
equal(classifyRecord({ action: 1 }), 'stream', 'classify: action 1 is a stream');
equal(classifyRecord({ action: 4 }), 'auto', 'classify: action 4 is an auto boost');
equal(classifyRecord({ action: 2 }), 'boost', 'classify: action 2 is a boost');
equal(classifyRecord({ action: 5 }), 'boost', 'classify: a bare invoice (5) is a boost');
equal(classifyRecord({}), 'boost', 'classify: no action is a boost');

// parseTs0
equal(parseBoostagram('{"ts":0}')?.ts, undefined, 'parseTs0: ts 0 counts as missing');
check(parseBoostagram('{"ts":0}') !== null, 'parseTs0: valid JSON parses');
equal(parseBoostagram('keysend:{not json'), null, 'parseTs0: non-JSON tlv gives null');
equal(parseBoostagram(''), null, 'parseTs0: empty tlv gives null');
equal(parseBoostagram(records.podcastStream.tlv)?.itemGuid, 'ep83-guid', 'parseBoostagram: episode_guid is the item guid');

// itdvByGuid
{
  const r = records.podcastStream;
  const m = matchItdvFeed(r, parseBoostagram(r.tlv), index);
  check(m, 'itdvByGuid: the ITDV podcast guid matches');
  equal(m?.feedGuid, ITDV_PODCAST_GUID, 'itdvByGuid: feedGuid');
  equal(m?.viaShow, null, 'itdvByGuid: no viaShow');
  equal(m?.showTitle, 'Into The Doerfel-Verse', 'itdvByGuid: showTitle');
}

// itdvByRemote
{
  const r = records.songInOtherShow;
  const m = matchItdvFeed(r, parseBoostagram(r.tlv), index);
  check(m, 'itdvByRemote: an ITDV album as remote_feed_guid matches');
  equal(m?.feedGuid, 'b2a87a4c-86f0-5194-9eb3-dcba42ce0695', 'itdvByRemote: feedGuid is the album');
  equal(m?.showTitle, 'Disco Swag - The Album', 'itdvByRemote: showTitle is the album title');
  equal(m?.viaShow, 'Homegrown Hits', 'itdvByRemote: viaShow is the other show');
}

// itdvByTitle
{
  const r = records.titleOnly;
  const m = matchItdvFeed(r, parseBoostagram(r.tlv), index);
  check(m, 'itdvByTitle: an ITDV title with stray case and space matches');
  equal(m?.feedGuid, null, 'itdvByTitle: no feedGuid from a title match');
  equal(m?.showTitle, 'Into The Doerfel-Verse', 'itdvByTitle: showTitle is the canonical title');
}

// notItdv
equal(normalizeRecord(records.otherShowStream, 'tj-helipad', index, NOW), null, 'notItdv: another show is dropped');
equal(normalizeRecord(records.brokenTlv, 'tj-helipad', index, NOW), null, 'notItdv: non-JSON tlv with another title is dropped');

// listenerDefault
{
  const n = normalizeRecord(records.titleOnly, 'boostbot', index, NOW);
  equal(n?.listener, 'Anonymous', 'listenerDefault: empty sender is Anonymous');
  equal(n?.kind, 'stream', 'listenerDefault: kind is carried');
  equal(n?.itemKey, 'ep 82 - doerfelmon', 'normalize: itemKey falls back to the lower-cased episode title');
  equal(n?.time, 1793364120, 'normalize: time is the Helipad time');
}

// Feed records one at a time through assignPaymentKey, as the store does, and return the keys.
function runKeys(items: NormalizedRecord[]): string[] {
  const seen: (PaymentCandidate & { identity: string })[] = [];
  let next = 0;
  return items.map(n => {
    const candidates = seen.filter(c => c.identity === n.identity);
    const key = assignPaymentKey(n, candidates, () => `key-${++next}`);
    seen.push({ paymentKey: key, source: n.source, recipient: n.recipient, time: n.time, identity: n.identity });
    return key;
  });
}
function albumRecord(source: 'tj-helipad' | 'boostbot', customValue: string | null, time: number, ts: number): NormalizedRecord {
  const r: HelipadRecord = {
    index: time, time, value_msat: 1000, value_msat_total: 20000, action: 1,
    sender: 'Listener', app: 'Fountain', podcast: 'Disco Swag - The Album', episode: 'Disco Swag',
    tlv: JSON.stringify({ action: 'stream', guid: 'b2a87a4c-86f0-5194-9eb3-dcba42ce0695', episode_guid: 'disco-track-1',
      sender_name: 'Listener', app_name: 'Fountain', value_msat_total: 20000, ts }),
    custom_key: customValue === null ? null : '696969', custom_value: customValue,
  };
  const n = normalizeRecord(r, source, index, NOW);
  if (!n) fail('albumRecord: fixture album record is not ITDV');
  return n;
}

// albumSplitsOnePayment
{
  const t = 1793364000;
  const keys = runKeys([
    albumRecord('tj-helipad', '4', t, 300),
    albumRecord('tj-helipad', '3', t + 2, 300),
    albumRecord('boostbot', null, t + 40, 300),
    albumRecord('tj-helipad', '13', t + 70, 300),
    albumRecord('tj-helipad', null, t + 90, 300),
  ]);
  equal(new Set(keys).size, 1, 'albumSplitsOnePayment: five split records of one payment share one key');
  const a = albumRecord('tj-helipad', '4', t, 300);
  equal(paymentIdentity(a), a.identity, 'paymentIdentity: normalizeRecord stores the identity');
}

// crossBucket
{
  const t1 = Date.UTC(2026, 9, 30, 12, 56, 58) / 1000;
  const t2 = Date.UTC(2026, 9, 30, 12, 57, 7) / 1000;
  const keys = runKeys([albumRecord('tj-helipad', '4', t1, 420), albumRecord('boostbot', null, t2, 420)]);
  equal(keys[0], keys[1], 'crossBucket: splits across a minute edge share one key');
}

// noTsTwoPayments
{
  const t = 1793364000;
  const first = albumRecord('boostbot', null, t, 0);
  const second = albumRecord('boostbot', null, t + 60, 0);
  equal(first.playbackTs, null, 'noTsTwoPayments: ts 0 is stored as null');
  const keys = runKeys([first, second]);
  check(keys[0] !== keys[1], 'noTsTwoPayments: the same source and recipient again starts a new payment');
}

// outsideWindow
{
  const t = 1793364000;
  const keys = runKeys([albumRecord('tj-helipad', '4', t, 300), albumRecord('boostbot', null, t + 121, 300)]);
  check(keys[0] !== keys[1], 'outsideWindow: 121 s apart is two payments');
}

console.log(`✅ ${checks} checks passed`);
