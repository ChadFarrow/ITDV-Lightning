/**
 * The site's boost note, in the shared format of ChadFarrow/PC20-Nostr
 * `pc20-boost-notes.md` (PR #51, merged 2026-11-17). Rule numbers below are that
 * document's.
 *
 *   ⚡ Boost ⚡
 *
 *   <the message>
 *
 *   <who> boosted <N> sats to <what>[ by <artist>][ from <where>][ via <app>]
 *
 *   <link>
 *
 * `boostSentence` and `boostNoteContent` write it; `parseBoostNote` reads it back for
 * the /boosts page. They live together so scripts/check-boost-messages.ts can check
 * that one reads what the other writes. Notes written before 2026-11-17 have another
 * layout and no header; app/boosts/page.tsx keeps its old reader for those, because a
 * kind 1 cannot be edited and every old note stays on the relays.
 *
 * Client-safe: no Node APIs, no nostr-tools, no post-ES5 syntax (tsconfig targets es5).
 */

/** Rule 10. Also how the /boosts page tells this layout from the old ones. */
export const NOTE_HEADER = '⚡ Boost ⚡';

/** Rule 8: every name is capped at this many characters. */
export const MAX_NAME_LENGTH = 120;

/**
 * Values the UI passes when it knows nothing: printing them would claim an artist
 * called "Unknown Artist". "Shuffle All" is the queue, not a feed the track is in.
 */
const PLACEHOLDERS: { [lowerCased: string]: true } = {
  'unknown artist': true,
  'unknown song': true,
  'unknown title': true,
  'unknown album': true,
  'shuffle all': true,
};

/** Rule 8: whitespace runs (line breaks too) become one space; trim; cap. */
export function cleanName(value?: string | null): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
}

function knownName(value?: string | null): string {
  const name = cleanName(value);
  return name && !PLACEHOLDERS[name.toLowerCase()] ? name : '';
}

export interface BoostSentenceParts {
  /** The boostagram's sender_name, as the payment carried it (rule 1). */
  who?: string;
  /** What the listener chose, in whole sats (rule 2). */
  sats: number;
  /** The track, or the album for an album boost (rule 3). */
  what?: string;
  artist?: string;
  /** The track's own album. Left out when it is the same as `what`. */
  where?: string;
  /** The boostagram's app_name (rule 7). */
  app?: string;
}

/** The one-line sentence (rules 1–8). */
export function boostSentence(parts: BoostSentenceParts): string {
  const who = cleanName(parts.who);
  const sats = Math.max(0, Math.floor(parts.sats || 0));
  const what = knownName(parts.what);
  const artist = knownName(parts.artist);
  const where = knownName(parts.where);
  const app = cleanName(parts.app);

  let sentence = who ? `${who} boosted ${sats} sats` : `Boosted ${sats} sats`;
  if (what) sentence += ` to ${what}`;
  // Rule 6: "by" follows a music title, and not when it repeats the title.
  if (what && artist && artist.toLowerCase() !== what.toLowerCase()) sentence += ` by ${artist}`;
  // An album boost's album is its `what`, and a single's track is often named as
  // its album; "to X from X" says nothing.
  if (where && (!what || where.toLowerCase() !== what.toLowerCase())) sentence += ` from ${where}`;
  if (app) sentence += ` via ${app}`;
  return sentence;
}

/** The note body (rules 10–12): header, message, sentence, links. */
export function boostNoteContent(note: { message?: string; sentence: string; links?: string[] }): string {
  const lines = [NOTE_HEADER, ''];
  const message = note.message ? note.message.trim() : '';
  if (message) lines.push(message, '');
  lines.push(note.sentence);
  const links = (note.links || []).filter(Boolean);
  if (links.length) lines.push('');
  links.forEach((link) => lines.push(link));
  return lines.join('\n');
}

export interface ParsedBoostNote {
  who?: string;
  sats: number;
  what?: string;
  artist?: string;
  where?: string;
  app?: string;
  message?: string;
  links: string[];
}

const SENTENCE = /^(?:(.+?) boosted|Boosted) (\d+) sats((?: (?:to|from|via) .+)?)$/;

/**
 * Read a note that `boostNoteContent` wrote. Returns null for any other layout.
 *
 * The sentence is plain text, so a title that holds " by ", " from " or " via " can be
 * split in the wrong place. The split favours the titles ITDV has: " via " is taken
 * from the end, "by" is the LAST " by " ("Porkchops Fried by HeyCitizen" is a track),
 * and "from" is the first " from " after it. An album title with " by " in it, or a
 * title with " by " whose artist is unknown, would still split wrong; on 2026-11-17
 * none of the 50 albums and 301 tracks did. Amount readers should prefer the `amount`
 * tag (rule 22).
 */
export function parseBoostNote(content: string): ParsedBoostNote | null {
  if (typeof content !== 'string' || content.indexOf(NOTE_HEADER) !== 0) return null;
  const lines = content.split('\n');

  // The message may hold any text, even a line that looks like a sentence, so the
  // sentence is the last line that matches.
  let at = -1;
  for (let i = lines.length - 1; i > 0; i--) {
    if (SENTENCE.test(lines[i])) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;

  const match = SENTENCE.exec(lines[at])!;
  const parsed: ParsedBoostNote = { sats: parseInt(match[2], 10), links: [] };
  if (match[1]) parsed.who = match[1];

  let rest = match[3];
  const via = rest.lastIndexOf(' via ');
  if (via >= 0) {
    parsed.app = rest.slice(via + 5);
    rest = rest.slice(0, via);
  }
  if (rest.indexOf(' to ') === 0) {
    rest = rest.slice(4);
    const by = rest.lastIndexOf(' by ');
    if (by >= 0) {
      parsed.what = rest.slice(0, by);
      const after = rest.slice(by + 4);
      const from = after.indexOf(' from ');
      if (from >= 0) {
        parsed.artist = after.slice(0, from);
        parsed.where = after.slice(from + 6);
      } else {
        parsed.artist = after;
      }
    } else {
      const from = rest.lastIndexOf(' from ');
      if (from >= 0) {
        parsed.what = rest.slice(0, from);
        parsed.where = rest.slice(from + 6);
      } else {
        parsed.what = rest;
      }
    }
  } else if (rest.indexOf(' from ') === 0) {
    parsed.where = rest.slice(6);
  }

  const message = lines.slice(1, at).join('\n').trim();
  if (message) parsed.message = message;

  for (let i = at + 1; i < lines.length; i++) {
    const link = /^https?:\/\/\S+$/.exec(lines[i].trim());
    if (link) parsed.links.push(link[0]);
  }
  return parsed;
}
