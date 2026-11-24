// Assertions for the Boostr Bot notes on /boosts — the repo's stand-in for unit tests.
//
//   npx tsx scripts/check-boostr-notes.ts
//
// It covers lib/boostr-note.ts (the reader for Boostr_Bot's kind 1 notes) against the 31 real
// ITDV notes in scripts/fixtures/boostr-itdv-notes.json, saved from the relays on 2026-11-24.
// Nothing leaves this process.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOOSTR_BOT_PUBKEY, ITDV_PODCAST_I_TAG, parseBoostrNote } from '../lib/boostr-note';

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

checkReader();
console.log(`✅ ${checks} checks passed`);
