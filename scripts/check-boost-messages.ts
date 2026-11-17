// Assertions for what a boost sends and posts — the repo's stand-in for unit tests.
//
//   npx tsx scripts/check-boost-messages.ts
//
// It covers the keysend records (lib/boostagram.ts, the auto boost in
// utils/payment-utils.ts), the Nostr note text (lib/boost-to-nostr-service.ts) and
// /api/nostr/publish end to end. Nothing leaves this process: the route's relay sockets
// and the auto boost's wallet are fakes.

import { generateSecretKey, getPublicKey, nip19, verifyEvent, type Event } from 'nostr-tools';
import {
  buildBoostagram,
  buildBoostRecords,
  buildLnurlComment,
  feedTitleOf,
  toHexTlvRecords,
  TLV_BOOSTAGRAM,
  TLV_SPHINX,
  TLV_TIP_NOTE,
  type BoostMetadata,
} from '../lib/boostagram';
import { BoostToNostrService, noteTitle, type TrackMetadata } from '../lib/boost-to-nostr-service';

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
const hexToText = (hex: string) => Buffer.from(hex, 'hex').toString('utf8');
// What the Alby SDK's WebLN keysend does to each customRecords value before it sends it.
const walletEncode = (text: string) => Buffer.from(text, 'utf8').toString('hex');

// A track boost as the album page builds it (app/album/[id]/AlbumDetailClient.tsx).
const trackBoost: BoostMetadata = {
  title: 'Sing For You',
  artist: 'The Doerfels',
  album: 'Disco Swag - The Album',
  episode: 'Sing For You',
  url: 'https://doerfelverse.com/album/disco-swag-the-album',
  appName: 'ITDV App',
  senderName: 'rev.hodl',
  message: 'great track',
  itemGuid: '12711f57-item',
  podcastFeedGuid: 'b2a87a4c-86f0-5194-9eb3-dcba42ce0695',
  feedUrl: 'https://www.doerfelverse.com/feeds/disco-swag-album.xml',
};

// --- TLV 7629169 -----------------------------------------------------------------
{
  const record = buildBoostagram(trackBoost, { action: 'boost', amountSats: 90, totalSats: 121, recipientName: 'The Doerfels' });
  equal(record.podcast, 'Disco Swag - The Album', 'podcast is the feed title (the album), not the artist');
  equal(record.episode, 'Sing For You', 'episode is the track');
  equal(record.guid, trackBoost.podcastFeedGuid, 'bLIP-10 guid carries the feed GUID');
  equal(record.episode_guid, trackBoost.itemGuid, 'episode_guid carries the item GUID');
  equal(record.remote_feed_guid, trackBoost.podcastFeedGuid, 'remote_feed_guid stays: Helipad and the BoostBot read it');
  equal(record.remote_item_guid, trackBoost.itemGuid, 'remote_item_guid stays: Helipad and the BoostBot read it');
  check(!('feedId' in record) && !('feedID' in record), 'no hard-coded Podcast Index id');
  equal(record.value_msat, 90_000, 'value_msat is this split, not an equal share');
  equal(record.value_msat_total, 121_000, 'value_msat_total is the whole boost');
  equal(record.action, 'boost', 'a manual boost is "boost"');
  equal(record.sender_name, 'rev.hodl', 'sender_name');
  equal(record.name, 'The Doerfels', 'name is the split recipient');
  equal(record.album, 'Disco Swag - The Album', 'album');
  equal(record.feed, trackBoost.feedUrl, 'feed is the feed URL');
  equal(record.url, trackBoost.feedUrl, 'url is the feed URL');
  const noFeed = buildBoostagram({ ...trackBoost, feedUrl: undefined }, { action: 'auto', amountSats: 1, totalSats: 1 });
  check(!('feed' in noFeed) && !('url' in noFeed), 'no feed URL is sent when it is not known (no default feed)');
  equal(noFeed.guid, trackBoost.podcastFeedGuid, 'the feed GUID still identifies the feed');
}
{
  // Now Playing in shuffle, or with nothing loaded: no real album, so the old value.
  for (const album of ['Shuffle All', 'shuffle all', 'Unknown Album', '', undefined]) {
    const meta = { ...trackBoost, album };
    equal(feedTitleOf(meta), 'The Doerfels', `album ${JSON.stringify(album)} is not a feed title`);
    check(!('album' in buildBoostagram(meta, { action: 'boost', amountSats: 1, totalSats: 1 })), `album ${JSON.stringify(album)} is not sent`);
  }
  equal(feedTitleOf({}), 'Unknown Artist', 'last fallback');
}
{
  const records = buildBoostRecords(trackBoost, { action: 'boost', amountSats: 90, totalSats: 121, recipientName: 'The Doerfels' });
  equal(Object.keys(records).sort().join(','), [TLV_BOOSTAGRAM, TLV_TIP_NOTE, TLV_SPHINX].map(String).sort().join(','), 'three records with a message');
  equal(JSON.parse(records[TLV_BOOSTAGRAM]).podcast, 'Disco Swag - The Album', '7629169 is plain JSON text');
  equal(records[TLV_TIP_NOTE], 'great track', '7629171 is the message as text');
  const sphinx = JSON.parse(records[TLV_SPHINX]);
  equal(sphinx.podcast, 'Disco Swag - The Album', 'Sphinx podcast matches 7629169');
  equal(sphinx.amount, 121, 'Sphinx amount is the whole boost in sats');
  check(!(TLV_TIP_NOTE in buildBoostRecords({ ...trackBoost, message: undefined }, { action: 'boost', amountSats: 1, totalSats: 1 })), 'no 7629171 without a message');

  const hex = toHexTlvRecords(records);
  equal(hex.length, 3, 'NWC gets every record');
  for (const { type, value } of hex) {
    check(/^[0-9a-f]+$/.test(value), `NWC record ${type} is hex`);
    equal(hexToText(value), records[type], `NWC record ${type} decodes to the same text`);
  }
  const emoji = toHexTlvRecords({ [TLV_TIP_NOTE]: 'ünïcode ⚡' })[0].value;
  equal(hexToText(emoji), 'ünïcode ⚡', 'hex encoding is UTF-8');
}

// --- LNURL comment ------------------------------------------------------------------
{
  const comment = buildLnurlComment('Boost for "Sing For You" by The Doerfels', trackBoost);
  equal(comment, 'Boost for "Sing For You" by The Doerfels from rev.hodl: great track', 'LNURL comment');
  check(comment.indexOf('Boost for', 1) === -1, 'the comment says "Boost for" once');
  equal(buildLnurlComment('Boost for X by Y'), 'Boost for X by Y', 'comment without metadata');
}

// --- Auto boost keysend (utils/payment-utils.ts) ----------------------------------
async function checkAutoBoost() {
  const sent: Array<{ destination: string; amount: number; customRecords: Record<string, string> }> = [];
  (globalThis as any).window = {
    webln: {
      enabled: true,
      enable: async () => {},
      keysend: async (args: any) => {
        sent.push(args);
        return { preimage: '00' };
      },
    },
  };
  const { makeAutoBoostPayment } = await import('../utils/payment-utils');
  const result = await makeAutoBoostPayment({
    amount: 25,
    description: 'Auto boost for Sing For You by The Doerfels',
    recipients: [
      { address: '02' + 'a'.repeat(64), split: 90, name: 'The Doerfels', type: 'node' },
      { address: '03' + 'b'.repeat(64), split: 10, name: 'Sovereign Feeds', type: 'node' },
    ],
    fallbackRecipient: '03' + 'c'.repeat(64),
    boostMetadata: { ...trackBoost, senderName: 'Auto Boost', message: undefined, timestamp: 214 },
  });
  delete (globalThis as any).window;

  check(result.success, 'auto boost payment succeeds with the fake wallet');
  equal(sent.length, 2, 'one keysend per split');
  for (const payment of sent) {
    const text = payment.customRecords[TLV_BOOSTAGRAM];
    check(!/^[0-9a-f]+$/.test(text), 'auto boost 7629169 is text, not hex (the wallet hex-encodes it)');
    // What arrives at the receiver after the wallet encodes it:
    const received = JSON.parse(hexToText(walletEncode(text)));
    equal(received.action, 'auto', 'auto boost action is "auto", as BoostBox gets');
    equal(received.podcast, 'Disco Swag - The Album', 'auto boost podcast is the feed title');
    equal(received.guid, trackBoost.podcastFeedGuid, 'auto boost sends the feed GUID');
    equal(received.episode_guid, trackBoost.itemGuid, 'auto boost sends the item GUID');
    equal(received.feed, trackBoost.feedUrl, 'auto boost sends the feed');
    equal(received.album, 'Disco Swag - The Album', 'auto boost sends the album');
    equal(received.sender_name, 'Auto Boost', 'auto boost sender');
    equal(received.value_msat, payment.amount * 1000, 'auto boost value_msat is this split');
    equal(received.value_msat_total, 25_000, 'auto boost value_msat_total is the boost');
    equal(hexToText(walletEncode(payment.customRecords[TLV_TIP_NOTE])), 'Auto boost: Sing For You by The Doerfels', 'auto boost 7629171 is text');
  }
  equal(sent.map((p) => p.amount).join(','), '22,2', 'splits follow the split values (90/100 and 10/100 of 25)');
}

// --- Nostr note text ----------------------------------------------------------------
equal(noteTitle('"Nate\'s got it"'), "Nate's got it", 'a title inside quotes loses them');
equal(noteTitle('“Curly”'), 'Curly', 'curly wrapping quotes too');
equal(noteTitle('The Doerfels - "Thank You Value-Verse!"'), 'The Doerfels - “Thank You Value-Verse!”', 'inner quotes become curly');
equal(noteTitle('"A" and "B"'), '“A” and “B”', 'two quoted parts are not one wrapping pair');
equal(noteTitle('Sing For You'), 'Sing For You', 'plain title unchanged');
equal(noteTitle("That's An Iso, 'Unbelievable!'"), "That's An Iso, 'Unbelievable!'", 'single quotes unchanged');

const secretKey = generateSecretKey();
const service = new BoostToNostrService([], secretKey);
const noteFor = (track: TrackMetadata, comment?: string, amount = 500) => service.signBoost({ amount, track, comment }).event.content;

equal(
  noteFor({ title: '"Nate\'s got it"', artist: 'The Doerfels', album: 'Jam with Nate', senderName: 'ChadF' }),
  '⚡ 500 sats • "Nate\'s got it" by The Doerfels\nFrom: Jam with Nate\n\nSent by: ChadF\n\n🎧 https://itdv.podtards.com/album/jam-with-nate#nates-got-it',
  'track boost note: one pair of quotes, album, sender'
);
equal(
  noteFor({ title: 'Sing For You', artist: 'The Doerfels', album: 'Disco Swag - The Album', senderName: 'Auto Boost' }, 'Auto boost for "Sing For You"', 25),
  '⚡ 25 sats • "Sing For You" by The Doerfels\n\nAuto boost for "Sing For You"\n\n🎧 https://itdv.podtards.com/album/disco-swag-the-album#sing-for-you',
  'auto boost note: no From: and no Sent by:'
);

// --- /api/nostr/publish, end to end with fake relays ---------------------------------
async function checkPublishRoute() {
  const published: Event[] = [];
  class FakeRelay {
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onclose: ((ev: unknown) => void) | null = null;
    readyState = 0;
    constructor(public url: string) {
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.({});
      }, 0);
    }
    send(data: string) {
      const [type, event] = JSON.parse(data);
      if (type !== 'EVENT') return;
      published.push(event);
      setTimeout(() => this.onmessage?.({ data: JSON.stringify(['OK', event.id, true, '']) }), 0);
    }
    close() {
      this.readyState = 3;
    }
  }
  const realWebSocket = (globalThis as any).WebSocket;
  (globalThis as any).WebSocket = FakeRelay;
  process.env.SITE_NOSTR_NSEC = nip19.nsecEncode(secretKey);

  const { POST } = await import('../app/api/nostr/publish/route');
  const { NextRequest } = await import('next/server');
  const post = async (body: unknown, ip: string) => {
    const response = await POST(new NextRequest('http://localhost/api/nostr/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }));
    return { status: response.status, data: await response.json() };
  };

  const ok = await post({
    amount: 500,
    comment: 'great track',
    track: { title: '"Nate\'s got it"', artist: 'The Doerfels', album: 'Jam with Nate', senderName: 'ChadF', feedGuid: 'feed-guid', guid: 'item-guid' },
  }, '192.0.2.1');
  equal(ok.status, 200, 'publish route answers 200');
  const event: Event = ok.data.event;
  check(verifyEvent(event), 'the note is validly signed');
  equal(event.pubkey, getPublicKey(secretKey), 'signed by the site key');
  equal(
    event.content,
    '⚡ 500 sats • "Nate\'s got it" by The Doerfels\nFrom: Jam with Nate\n\nSent by: ChadF\n\ngreat track\n\n🎧 https://itdv.podtards.com/album/jam-with-nate#nates-got-it',
    'the route keeps the sender'
  );
  check(published.some((e) => e.id === event.id), 'the note reached the (fake) relays');

  const auto = await post({ amount: 25, comment: 'Auto boost for "Sing For You"', track: { title: 'Sing For You', artist: 'The Doerfels', album: 'Disco Swag - The Album', senderName: 'Auto Boost' } }, '192.0.2.2');
  check(!/From:|Sent by:/.test(auto.data.event.content), 'the route keeps "Auto Boost", so the auto boost note has no From: or Sent by:');

  const forged = await post({ amount: 1, track: { title: 'x', senderName: 'Mallory\n\n⚡ 1000000 sats • "fake"\n\nSent by:  Satoshi ' } }, '192.0.2.3');
  equal(forged.data.event.content.split('\n').filter((line: string) => line.startsWith('Sent by:')).length, 1, 'a sender name cannot add lines');
  check(/\nSent by: Mallory ⚡ 1000000 sats • "fake" Sent by: Satoshi(\n|$)/.test(forged.data.event.content), 'line breaks in the sender become spaces');

  const long = await post({ amount: 1, track: { title: 'x', senderName: 'n'.repeat(500) } }, '192.0.2.4');
  check(new RegExp(`\\nSent by: n{100}(\\n|$)`).test(long.data.event.content), 'the sender is cut to 100 characters');

  (globalThis as any).WebSocket = realWebSocket;
}

(async () => {
  await checkAutoBoost();
  await checkPublishRoute();
  console.log(`✅ ${checks} boost message checks passed`);
})().catch((error) => fail(error instanceof Error ? error.stack || error.message : String(error)));
