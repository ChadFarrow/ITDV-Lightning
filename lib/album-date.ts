/**
 * Shared album-date utilities. Single source of truth for pulling the original
 * recorded/released date out of an album description, and for deciding which
 * year the UI should display.
 *
 * Why this exists: an album's `releaseDate` comes from the feed's RSS pubDate,
 * which is when the v4v feed was published — not when the music was made. Many
 * descriptions state the real date ("recorded in 2015", "originally released in
 * 2017"), so we mine that and prefer it, falling back to pubDate when absent.
 *
 * Pure functions only — no Node APIs — so client components can import this.
 */

export type AlbumDateKind = 'recorded' | 'released';

export interface AlbumDateInfo {
  /** The stated year, e.g. 2017. */
  year: number;
  /** Whether the surrounding wording read as a recording or a release. Lower confidence than `year`. */
  kind: AlbumDateKind;
  /** 'day' when a full "Month D, YYYY" was stated, otherwise 'year'. */
  precision: 'year' | 'day';
  /** The phrase the year was taken from, kept for provenance and debugging. */
  source: string;
}

const MIN_YEAR = 1950;

const MONTHS =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

/**
 * Contexts in which a year is about a person or an event, never the album.
 * A sentence matching any of these is skipped wholesale — e.g. "our daughter,
 * Autumn, born Jan 12, 2024" and "Ben married Dougs daughter, Emma in 2020".
 */
const NEGATIVE_CONTEXT =
  /\b(born|birth(?:day|s)?|died|death|passed away|in memory|memoriam|dedicated|rip|r\.i\.p\.|married|marriage|wedding|anniversary|founded|graduat)/i;

/** A YYYY-YYYY span is a lifespan or an era, never a single album date. */
const YEAR_RANGE = /\b(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\b/g;

const RECORDED_WORDS = /\b(record(?:ed|ing)?|tracked|laid down|captured?|jam(?:med)?|live|concert|session)\b/i;
const RELEASE_VERBS = /\b(releas(?:e|ed|ing)|came out|dropped|put out|debut(?:ed)?|premiered?)\b/i;
/** Nouns that make a sentence album-related but say nothing about recorded vs released. */
const RELEASE_NOUNS = /\b(album|ep)\b/i;
const DATE_CONTEXT = new RegExp(
  `${RECORDED_WORDS.source}|${RELEASE_VERBS.source}|${RELEASE_NOUNS.source}`,
  'i'
);

/** How close (in characters) a year must sit to a recording/release word to count. */
const PROXIMITY = 120;

const YEAR = /\b(19[5-9]\d|20[0-4]\d)\b/g;

/**
 * Split into sentences, keeping the terminating punctuation.
 * Deliberately avoids lookbehind: tsconfig targets es5 and regex syntax can't be
 * down-levelled, so a lookbehind literal would throw SyntaxError on Safari < 16.4
 * and take the whole module — and any page importing it — down with it.
 */
function splitSentences(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?]*/g) || []).map((s) => s.trim()).filter(Boolean);
}

/**
 * Pull the original recorded/released date out of an album description.
 * Returns null when the description states no date — which is the common case.
 */
export function extractAlbumDate(description?: string | null): AlbumDateInfo | null {
  if (!description) return null;

  const text = description.replace(/\s+/g, ' ').trim();
  const maxYear = new Date().getFullYear();
  const candidates: AlbumDateInfo[] = [];

  for (const rawSentence of splitSentences(text)) {
    // A sentence about a birth, death or wedding tells us nothing about the album.
    if (NEGATIVE_CONTEXT.test(rawSentence)) continue;

    // Blank out lifespans so "Miles Fonda 1988-2023" contributes no candidate years.
    const sentence = rawSentence.replace(YEAR_RANGE, ' ');
    if (!DATE_CONTEXT.test(sentence)) continue;

    YEAR.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = YEAR.exec(sentence)) !== null) {
      const year = parseInt(match[1], 10);
      if (year < MIN_YEAR || year > maxYear) continue;

      // The year has to sit near the recording/release wording, not merely in
      // the same sentence — long sentences otherwise produce false matches.
      const window = sentence.slice(Math.max(0, match.index - PROXIMITY), match.index + PROXIMITY);
      if (!DATE_CONTEXT.test(window)) continue;

      // "recorded in 2015" reads as a recording; an explicit release verb wins that label.
      // The bare nouns "album"/"ep" deliberately don't decide this either way.
      const kind: AlbumDateKind =
        RECORDED_WORDS.test(window) && !RELEASE_VERBS.test(window) ? 'recorded' : 'released';

      // A full "Dec 2, 2025" immediately before the year means we know the day.
      const preceding = sentence.slice(Math.max(0, match.index - 20), match.index);
      const hasMonthDay = new RegExp(`${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s*$`, 'i').test(preceding);

      candidates.push({
        year,
        kind,
        precision: hasMonthDay ? 'day' : 'year',
        source: sentence.slice(Math.max(0, match.index - 60), match.index + 20).trim(),
      });
    }
  }

  if (candidates.length === 0) return null;

  // Earliest year wins: we want the original recording, not a later re-release.
  candidates.sort((a, b) => a.year - b.year);
  return candidates[0];
}

/**
 * The year to show for an album: the date stated in its description when we
 * found one, otherwise the feed's pubDate year. Returns '' if neither parses.
 */
export function getDisplayYear(album: {
  originalRelease?: AlbumDateInfo | null;
  releaseDate?: string;
}): string {
  if (album?.originalRelease?.year) return String(album.originalRelease.year);

  if (!album?.releaseDate) return '';
  const parsed = new Date(album.releaseDate);
  return isNaN(parsed.getTime()) ? '' : String(parsed.getFullYear());
}
