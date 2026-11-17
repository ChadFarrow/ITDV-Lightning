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
import { boostSentence, parseBoostNote } from '../lib/boost-note';

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

// The shared format (pc20-boost-notes.md on PC20-Nostr main). "vector N" is that
// document's test vector N, with ITDV's names where its own are a podcast's.
equal(boostSentence({ who: 'rev.hodl', sats: 121, what: 'Sing For You', artist: 'The Doerfels', where: 'ITDV music playlist', app: 'BoostMeBitch' }),
  'rev.hodl boosted 121 sats to Sing For You by The Doerfels from ITDV music playlist via BoostMeBitch', 'the format document\'s own example');
equal(boostSentence({ who: 'ChadF', sats: 100, what: 'Disco Swag - The Album', artist: 'The Doerfels', where: 'Disco Swag - The Album', app: 'Fountain' }),
  'ChadF boosted 100 sats to Disco Swag - The Album by The Doerfels via Fountain', 'vector 16: an album boost says by, and no from');
equal(boostSentence({ sats: 100, what: 'Episode 146', where: 'Homegrown Hits', app: 'Fountain' }),
  'Boosted 100 sats to Episode 146 from Homegrown Hits via Fountain', 'vector 2: no sender name');
equal(boostSentence({ who: 'ChadF', sats: 100, what: 'Kurtis', artist: 'kurtis', where: 'Night Drive', app: 'Fountain' }),
  'ChadF boosted 100 sats to Kurtis from Night Drive via Fountain', 'vector 6: no by when the artist repeats the title');
equal(boostSentence({ who: 'ChadF', sats: 3333, what: 'T', app: 'Fountain' }), 'ChadF boosted 3333 sats to T via Fountain', 'vector 8: digits only');
equal(boostSentence({ who: 'ChadF', sats: 100, what: 'Episode\n146', where: 'Homegrown  Hits ', app: 'Fountain' }),
  'ChadF boosted 100 sats to Episode 146 from Homegrown Hits via Fountain', 'vector 10: names are one line');
equal(boostSentence({ who: 'boostmebitch.com user', sats: 100, what: 'Episode 146', where: 'Homegrown Hits', app: 'BoostMeBitch' }),
  'boostmebitch.com user boosted 100 sats to Episode 146 from Homegrown Hits via BoostMeBitch', 'vector 17: a default sender name prints as it is');
equal(boostSentence({ who: 'ChadF', sats: 100, what: 'Episode 146', where: 'Homegrown Hits' }),
  'ChadF boosted 100 sats to Episode 146 from Homegrown Hits', 'vector 18: no app, no via');
equal(boostSentence({ who: 'Anonymous', sats: 50, what: 'If I Promise(Demo)', artist: 'Unknown Artist', where: 'Shuffle All', app: 'ITDV App' }),
  'Anonymous boosted 50 sats to If I Promise(Demo) via ITDV App', 'placeholders are not names: no "by Unknown Artist", no "from Shuffle All"');
equal(boostSentence({ who: 'x'.repeat(300), sats: 1, what: 'T' }), `${'x'.repeat(120)} boosted 1 sats to T`, 'rule 8: a name is cut to 120');

const secretKey = generateSecretKey();
const service = new BoostToNostrService([], secretKey);
const signFor = (track: TrackMetadata, comment?: string, amount = 500) => service.signBoost({ amount, track, comment }).event;
const noteFor = (track: TrackMetadata, comment?: string, amount = 500) => signFor(track, comment, amount).content;

const trackNote = signFor({ title: '"Nate\'s got it"', artist: 'The Doerfels', album: 'Jam with Nate', senderName: 'rev.hodl', appName: 'ITDV App', guid: 'item-guid', feedGuid: 'feed-guid' }, 'great fiddle', 121);
equal(
  trackNote.content,
  '⚡ Boost ⚡\n\ngreat fiddle\n\nrev.hodl boosted 121 sats to "Nate\'s got it" by The Doerfels from Jam with Nate via ITDV App\n\nhttps://itdv.podtards.com/album/jam-with-nate#nates-got-it',
  'track boost note: header, message, sentence, link'
);
equal(JSON.stringify(trackNote.tags.filter((t) => t[0] === 'amount')), '[["amount","121000"]]', 'amount tag: the chosen amount in millisats');
check(trackNote.tags.some((t) => t[0] === 't' && t[1] === 'boostagram'), 't tag: boostagram');
check(!trackNote.tags.some((t) => t[0] === 'sender'), 'no sender tag: ITDV does not know the listener\'s key');
equal(trackNote.tags.filter((t) => t[0] === 'i').map((t) => t[1]).join(' '), 'podcast:item:guid:item-guid podcast:guid:feed-guid', 'one identifier in each i tag');
equal(
  noteFor({ title: 'Disco Swag - The Album', artist: 'The Doerfels', album: 'Disco Swag - The Album', senderName: 'Super Fan' }, undefined, 50),
  '⚡ Boost ⚡\n\nSuper Fan boosted 50 sats to Disco Swag - The Album by The Doerfels via ITDV App\n\nhttps://itdv.podtards.com/album/disco-swag-the-album',
  'album boost note: no message block, by, no from, "via ITDV App" by default'
);

// /boosts reads back what the note writes.
const read = parseBoostNote(trackNote.content)!;
equal(JSON.stringify(read), JSON.stringify({ sats: 121, links: ['https://itdv.podtards.com/album/jam-with-nate#nates-got-it'], who: 'rev.hodl', app: 'ITDV App', what: '"Nate\'s got it"', artist: 'The Doerfels', where: 'Jam with Nate', message: 'great fiddle' }), 'parseBoostNote reads every part back');
const porkchops = parseBoostNote(noteFor({ title: 'Porkchops Fried by HeyCitizen', artist: 'HeyCitizen', album: 'Some Album', senderName: 'ChadF' }))!;
equal(`${porkchops.what} | ${porkchops.artist} | ${porkchops.where}`, 'Porkchops Fried by HeyCitizen | HeyCitizen | Some Album', 'a title with " by " in it (a real ITDV track)');
const tricky = parseBoostNote(noteFor({ title: 'Letters from Home', artist: 'A', album: 'Music From The Doerfel-Verse', senderName: 'ChadF' }, 'line one\n\nI boosted 5 sats to my mom'))!;
equal(`${tricky.what} | ${tricky.where} | ${tricky.message}`, 'Letters from Home | Music From The Doerfel-Verse | line one\n\nI boosted 5 sats to my mom', 'a title with " from ", and a message with a blank line and a sentence-like line');
const noName = parseBoostNote(noteFor({ title: 'T' }, undefined, 7))!;
equal(`${noName.who} | ${noName.sats} | ${noName.what} | ${noName.app}`, 'undefined | 7 | T | ITDV App', 'no sender: "Boosted 7 sats"');
equal(parseBoostNote('⚡ 500 sats • "Nate\'s got it" by The Doerfels\nFrom: Jam with Nate\n\nSent by: ChadF'), null, 'an old note is left to the old reader');

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
    '⚡ Boost ⚡\n\ngreat track\n\nChadF boosted 500 sats to "Nate\'s got it" by The Doerfels from Jam with Nate via ITDV App\n\nhttps://itdv.podtards.com/album/jam-with-nate#nates-got-it',
    'the route keeps the sender'
  );
  equal(JSON.stringify(event.tags.filter((t) => t[0] === 'amount')), '[["amount","500000"]]', 'the route\'s note has the amount tag');

  const otherApp = await post({ amount: 5, track: { title: 'T', senderName: 'ChadF', appName: 'Fountain' } }, '192.0.2.6');
  check(/ via ITDV App$/m.test(otherApp.data.event.content), 'the route always says "via ITDV App", whatever app the caller names');
  check(published.some((e) => e.id === event.id), 'the note reached the (fake) relays');

  // Auto boosts post no note (2026-11-16). This is the request older bundles send.
  const before = published.length;
  const auto = await post({ amount: 25, comment: 'Auto boost for "Sing For You"', track: { title: 'Sing For You', artist: 'The Doerfels', album: 'Disco Swag - The Album', senderName: 'Auto Boost' } }, '192.0.2.2');
  equal(auto.status, 403, 'the route refuses an auto boost note');
  equal(auto.data.error, 'Auto boosts are not posted to Nostr', 'the refusal says why');
  equal(published.length, before, 'no auto boost note reaches a relay');

  const namedAuto = await post({ amount: 25, comment: 'love this one', track: { title: 'Sing For You', artist: 'The Doerfels', senderName: 'Auto Boost' } }, '192.0.2.5');
  equal(namedAuto.status, 200, 'a hand-sent boost from a listener named "Auto Boost" still posts');

  const forged = await post({ amount: 1, track: { title: 'x', senderName: 'Mallory\n\n⚡ 1000000 sats • "fake"\n\nSent by:  Satoshi ' } }, '192.0.2.3');
  equal(forged.data.event.content, '⚡ Boost ⚡\n\nMallory ⚡ 1000000 sats • "fake" Sent by: Satoshi boosted 1 sats to x via ITDV App', 'a sender name cannot add lines: line breaks become spaces');

  const long = await post({ amount: 1, track: { title: 'x', senderName: 'n'.repeat(500) } }, '192.0.2.4');
  check(new RegExp(`\\nn{120} boosted 1 sats`).test(long.data.event.content), 'the sender is cut to 120 characters (format rule 8)');

  (globalThis as any).WebSocket = realWebSocket;
}

(async () => {
  await checkAutoBoost();
  await checkPublishRoute();
  console.log(`✅ ${checks} boost message checks passed`);
})().catch((error) => fail(error instanceof Error ? error.stack || error.message : String(error)));
