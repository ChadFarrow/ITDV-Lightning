// Which cards /boosts hides as duplicates. Moved out of app/boosts/page.tsx on 2026-11-24 so that
// scripts/check-boostr-notes.ts can test it.
//
// Three rules, in this order:
// 1. A Boostr Bot card (platform 'boostr') is one event, so it is unique by event id. Two listeners
//    who boost one episode with the same message (or none) stay two cards.
// 2. A Helipad webhook record that is the same boost as a Boostr card is hidden (Chad, 2026-11-24:
//    "check for duplicates and hide them"). The Boostr card stays: it has the Nostr replies.
// 3. Every other card keeps the old content rule: one card per title + artist + message, the
//    higher amount wins, and a card with none of the three is dropped.
//
// Client-safe: the page imports this, and tsconfig targets es5 (no for..of over a Map).

export interface DedupeInput {
  id: string;
  platform?: string;
  amount?: string;
  trackTitle?: string;
  trackArtist?: string;
  userMessage?: string;
  timestamp: number;
  action?: number;
}

/** Seconds between a Helipad record and a Boostr note of the same boost, at most. */
const SAME_BOOST_WINDOW_SECONDS = 600;
/**
 * Helipad's action numbers (helipad dbif/src/boosts.rs `ActionType`, serialized as numbers for the
 * webhook): 1 stream, 2 boost, 4 auto boost. A stream is never a boost note.
 */
export const HELIPAD_ACTION_STREAM = 1;

export function isHelipadStream(action: number | undefined | null): boolean {
  return action === HELIPAD_ACTION_STREAM;
}

export function normalizeString(str: string | undefined | null): string {
  if (!str) return '';
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Whether a Helipad record and a Boostr card describe one boost. Both sides carry the whole
 * boost's sats (Helipad's value_msat_total, the bot's amount tag), the payer's message and the
 * time it was paid, so those three decide. The episode is left out on purpose: Helipad names it
 * from the payer's TLV, the bot from its own feed lookup, and the two can differ.
 */
export function sameBoost(helipad: DedupeInput, boostr: DedupeInput): boolean {
  if (isHelipadStream(helipad.action)) return false;
  const a = parseFloat(helipad.amount || '');
  const b = parseFloat(boostr.amount || '');
  if (isNaN(a) || a !== b) return false;
  if (normalizeString(helipad.userMessage) !== normalizeString(boostr.userMessage)) return false;
  return Math.abs(helipad.timestamp - boostr.timestamp) <= SAME_BOOST_WINDOW_SECONDS;
}

/** Keeps the input order (the page renders the result as is): a card stays where it first appears. */
export function deduplicateBoosts<T extends DedupeInput>(boosts: T[]): T[] {
  const boostrCards = boosts.filter(b => b.platform === 'boostr');

  const result: T[] = [];
  const boostrIds: { [id: string]: true } = {};
  const contentIndex: { [key: string]: number } = {};
  for (const boost of boosts) {
    if (boost.platform === 'boostr') {
      if (boostrIds[boost.id]) continue;
      boostrIds[boost.id] = true;
      result.push(boost);
      continue;
    }
    if (boost.platform === 'helipad' && boostrCards.some(b => sameBoost(boost, b))) continue;

    const contentKey = `${normalizeString(boost.trackTitle)}-${normalizeString(boost.trackArtist)}-${normalizeString(boost.userMessage)}`;
    if (contentKey === '--') continue; // no title, artist or message: not a boost

    const index = contentIndex[contentKey];
    if (index === undefined) {
      contentIndex[contentKey] = result.length;
      result.push(boost);
    } else if (parseInt(boost.amount || '0', 10) > parseInt(result[index].amount || '0', 10)) {
      // A duplicate with a higher amount may be the aggregated one.
      result[index] = boost;
    }
  }
  return result;
}
