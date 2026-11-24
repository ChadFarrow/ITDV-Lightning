// Assertions for the Boostr Bot notes on /boosts — the repo's stand-in for unit tests.
//
//   npx tsx scripts/check-boostr-notes.ts
//
// It covers lib/boostr-note.ts (the reader for Boostr_Bot's kind 1 notes) against the 31 real
// ITDV notes in scripts/fixtures/boostr-itdv-notes.json, saved from the relays on 2026-11-24,
// and lib/boost-dedupe.ts (which cards /boosts hides as duplicates).
// Nothing leaves this process.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOOSTR_BOT_PUBKEY, ITDV_PODCAST_I_TAG, parseBoostrNote } from '../lib/boostr-note';
import { deduplicateBoosts, type DedupeInput } from '../lib/boost-dedupe';

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

interface FixtureEvent { id: string; pubkey: string; created_at: number; content: string; tags: string[][] }
const fixtures: FixtureEvent[] = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'boostr-itdv-notes.json'), 'utf8'));
const at = (iso: string) => {
  const e = fixtures.find(f => new Date(f.created_at * 1000).toISOString().startsWith(iso));
  if (!e) fail(`no fixture at ${iso}`);
  return e;
};
const synthetic = (content: string, extraTags: string[][] = []) => ({
  pubkey: BOOSTR_BOT_PUBKEY,
  content,
  tags: [['i', ITDV_PODCAST_I_TAG], ['k', 'podcast:guid'], ...extraTags],
});

function checkReader() {
  equal(fixtures.length, 31, 'fixture count');
  for (const e of fixtures) {
    const note = parseBoostrNote(e);
    check(note, `fixture ${e.id} parses`);
    check(note!.sats > 0, `fixture ${e.id} has sats`);
    equal(note!.show, 'Into The Doerfel-Verse', `fixture ${e.id} show`);
  }

  const hey = parseBoostrNote(at('2026-11-24T13:43:01'))!;
  equal(hey.sats, 3333, 'HeyCitizen sats');
  equal(hey.sender, 'HeyCitizen', 'HeyCitizen sender');
  equal(hey.episode, 'Ep 83 - Jon Ross', 'HeyCitizen episode');
  equal(hey.app, 'Castamatic', 'HeyCitizen app');
  equal(hey.message, 'Ah, finally a patrician valueverse musician who recognizes that Tony Banks is the GOAT!', 'HeyCitizen message');
  equal(hey.listenUrl, 'https://castamatic.com/guid/41aace28-8679-5ef1-9958-75cf76c2b5f0', 'HeyCitizen listen link');
  equal(hey.boostUrl, 'https://castamatic.com/boost/ECE103D8-BDED-44DD-B445-2073294A38C3', 'HeyCitizen boost link');
  equal(hey.senderNpub, undefined, 'HeyCitizen has no sender tag');

  const matt = parseBoostrNote(at('2026-11-12T01:32:19'))!;
  equal(
    matt.message,
    '🚨 BREAKING NEWS 🚨\n@Sir TJ The Wrathful admits to using AI for latest track\nFull details of this shocking revelation can be found in the podcast linked below.\n\n🤣',
    'a message keeps its line breaks and blank lines',
  );
  equal(matt.senderNpub, 'npub12znrejs4k94kp5efhyhk9rzr9jxpy6ymgrlf6py4awpkkhed7cmshs6yg6', 'Matt Finlay sender npub');
  equal(matt.listenUrl, undefined, 'Matt Finlay has no app link');
  equal(matt.app, 'BoostMeBuddy', 'Matt Finlay app');
  equal(matt.sender, 'Matt Finlay', 'Matt Finlay sender');

  const duh = parseBoostrNote(at('2026-11-11T21:10:43'))!;
  equal(duh.episode, undefined, 'a show-level boost has no episode');
  equal(duh.sats, 3333, 'DuhLaurien sats');
  equal(duh.sender, 'DuhLaurien ✌🏻👽💨', 'DuhLaurien sender');

  const anonymous = parseBoostrNote(synthetic('⚡ Boost ⚡\n\nBoosted 100 sats → Into The Doerfel-Verse'))!;
  check(anonymous, 'a boost with no sender parses');
  equal(anonymous.sats, 100, 'no amount tag: sats from the sentence');
  equal(anonymous.sender, undefined, 'no sender name');
  equal(anonymous.message, undefined, 'no message');

  const badTag = parseBoostrNote(synthetic('⚡ Boost ⚡\n\nAnn boosted 21 sats → Into The Doerfel-Verse', [['amount', 'abc']]))!;
  equal(badTag.sats, 21, 'a non-numeric amount tag falls back to the sentence');

  const quoting = parseBoostrNote(synthetic(
    '⚡ Boost ⚡\n\nBob boosted 5 sats → X\nnice\n\nAnn boosted 21 sats → Into The Doerfel-Verse\n📻 Ep 83 - Jon Ross',
    [['amount', '21000']],
  ))!;
  equal(quoting.sender, 'Ann', 'the attribution is the last sentence');
  equal(quoting.message, 'Bob boosted 5 sats → X\nnice', 'a sentence-shaped message line stays in the message');
  equal(quoting.episode, 'Ep 83 - Jon Ross', 'episode after the sentence');

  const real = at('2026-11-24T13:43:01');
  equal(parseBoostrNote({ ...real, pubkey: 'b46bf003'.padEnd(64, '0') }), null, 'another author is not a Boostr note');
  equal(parseBoostrNote({ ...real, tags: real.tags.filter(t => t[0] !== 'i') }), null, 'a note without the ITDV guid tag is not shown');
  equal(parseBoostrNote(synthetic('⚡ Boost ⚡\n\njust text')), null, 'a note with no attribution sentence is not a boost');
}

function checkDedupe() {
  const t = 1795527781;
  const card = (over: Partial<DedupeInput> & { id: string }): DedupeInput => ({
    platform: 'boostr', amount: '3333', trackTitle: 'Ep 83 - Jon Ross', trackArtist: 'Into The Doerfel-Verse',
    userMessage: 'Hi', timestamp: t, ...over,
  });
  const ids = (list: DedupeInput[]) => list.map(b => b.id).sort().join(',');

  equal(ids(deduplicateBoosts([card({ id: 'a' }), card({ id: 'b' })])), 'a,b',
    'two Boostr boosts on one episode with the same message stay two cards');
  equal(ids(deduplicateBoosts([card({ id: 'a' }), card({ id: 'a' })])), 'a', 'one Boostr note twice is one card');

  const helipad = (over: Partial<DedupeInput>) => card({ id: 'helipad-index-7', platform: 'helipad', ...over });
  const bot = card({ id: 'e1', userMessage: ' hi ', timestamp: t + 120 });
  equal(ids(deduplicateBoosts([helipad({}), bot])), 'e1', 'a Helipad record of a Boostr boost is hidden');
  equal(ids(deduplicateBoosts([helipad({}), card({ id: 'e1', timestamp: t + 700 })])), 'e1,helipad-index-7',
    'more than 10 minutes apart: two boosts');
  equal(ids(deduplicateBoosts([helipad({ amount: '3332' }), bot])), 'e1,helipad-index-7', 'other sats: two boosts');
  equal(ids(deduplicateBoosts([
    helipad({ action: 2, userMessage: undefined, timestamp: t + 10 }),
    card({ id: 'e1', userMessage: undefined }),
  ])), 'e1,helipad-index-7', 'a Helipad stream is never hidden by a Boostr boost');

  const site = (id: string, amount: string) => card({ id, platform: 'nostr', amount, trackTitle: 'Them', trackArtist: 'The Doerfels' });
  const sites = deduplicateBoosts([site('s1', '50'), site('s2', '100')]);
  equal(sites.length, 1, 'site cards with the same title, artist and message are one card (old rule)');
  equal(sites[0].amount, '100', 'the old rule keeps the higher amount');
  equal(deduplicateBoosts([card({ id: 'x', platform: 'nostr', trackTitle: '', trackArtist: '', userMessage: '' })]).length, 0,
    'a site card with no title, artist or message is dropped (old rule)');

  // The page renders the result as is, so the input order (newest first) must survive.
  const ordered = deduplicateBoosts([
    card({ id: 's1', platform: 'nostr', trackTitle: 'One' }),
    card({ id: 'e1' }),
    card({ id: 's2', platform: 'nostr', trackTitle: 'Two' }),
  ]);
  equal(ordered.map(b => b.id).join(','), 's1,e1,s2', 'the input order is kept');
}

checkReader();
checkDedupe();
console.log(`✅ ${checks} checks passed`);
