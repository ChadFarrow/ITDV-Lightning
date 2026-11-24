// Reader for Boostr_Bot's boost notes, for /boosts.
//
// Boostr_Bot is Chad's BoostBox Nostr bot. It is a 1% split recipient (boostr@getalby.com) in the
// Into The Doerfel-Verse podcast feed, and it posts each boostagram it receives as a public kind 1.
// The text layout is boostbox's `->note-content` (ChadFarrow/boostbox,
// src/boostbox/boostagram.clj); that file is the source of truth, so read it before you change the
// rules below:
//
//   ⚡ Boost ⚡
//
//   <message, any number of lines, blank ones included>   (optional)
//
//   <sender> boosted <N> sats → <show>     ("Boosted <N> sats → <show>" with no sender)
//   📻 <episode>                          (optional)
//   🎧 Find it on <app> | ▶️ Listen on <app>   (optional, the URL on the next line)
//
//   <banner URL>
//
// The bot is in no other ITDV feed (Chad, 2026-11-24), so only notes that carry the ITDV podcast's
// NIP-73 `i` tag are read; a note for any other show returns null.
//
// Client-safe: the page imports this, and tsconfig targets es5, so no lookbehind and no `u` flag.

export const BOOSTR_BOT_PUBKEY = 'adab4ccd313996520304a5b1ec6c4076bc271bc6a3236702321c5811009d0649';
export const ITDV_PODCAST_GUID = '41aace28-8679-5ef1-9958-75cf76c2b5f0';
export const ITDV_PODCAST_I_TAG = `podcast:guid:${ITDV_PODCAST_GUID}`;

export interface BoostrNote {
  sats: number;
  sender?: string;
  show?: string;
  message?: string;
  episode?: string;
  app?: string;
  listenUrl?: string;
  boostUrl?: string;
  senderNpub?: string;
}

const HEADER = '⚡ Boost ⚡';
// "<sender> boosted <N> sats → <show>" or "Boosted <N> sats → <show>".
const ATTRIBUTION = /^(?:(.+) boosted|Boosted) (\d+) sats?(?: → (.+))?$/;
const EPISODE_PREFIX = '📻 ';
const APP_LINK_PREFIXES = ['🎧 Find it on ', '▶️ Listen on '];

function tagValue(tags: string[][], name: string): string | undefined {
  const tag = tags.find(t => t[0] === name && typeof t[1] === 'string' && t[1] !== '');
  return tag ? tag[1] : undefined;
}

export function parseBoostrNote(event: { pubkey: string; content: string; tags: string[][] }): BoostrNote | null {
  if (event.pubkey !== BOOSTR_BOT_PUBKEY) return null;
  if (!event.tags.some(t => t[0] === 'i' && t[1] === ITDV_PODCAST_I_TAG)) return null;

  const lines = event.content.split('\n');

  // The last sentence-shaped line is the attribution: a message can contain one of its own.
  let at = -1;
  let match: RegExpMatchArray | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    match = lines[i].trim().match(ATTRIBUTION);
    if (match) {
      at = i;
      break;
    }
  }
  if (at < 0 || !match) return null;

  const start = lines[0].trim() === HEADER ? 1 : 0;
  const message = lines.slice(start, at).join('\n').trim() || undefined;

  let episode: string | undefined;
  let listenUrl: string | undefined;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!episode && line.indexOf(EPISODE_PREFIX) === 0) {
      episode = line.slice(EPISODE_PREFIX.length).trim() || undefined;
    }
    if (!listenUrl && APP_LINK_PREFIXES.some(p => line.indexOf(p) === 0)) {
      const next = (lines[i + 1] || '').trim();
      if (next.indexOf('https://') === 0) listenUrl = next;
    }
  }

  const amountTag = tagValue(event.tags, 'amount');
  const sats = amountTag && /^\d+$/.test(amountTag)
    ? Math.floor(Number(amountTag) / 1000)
    : Number(match[2]);

  const senderTag = tagValue(event.tags, 'sender');

  return {
    sats,
    sender: match[1] ? match[1].trim() : undefined,
    show: match[3] ? match[3].trim() : undefined,
    message,
    episode,
    app: tagValue(event.tags, 'app'),
    listenUrl,
    boostUrl: tagValue(event.tags, 'r'),
    senderNpub: senderTag && senderTag.indexOf('npub1') === 0 ? senderTag : undefined,
  };
}
