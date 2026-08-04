/**
 * Reads the hand-curated `originalReleaseYear` values out of data/feeds.json.
 *
 * Script-side only: it touches the filesystem, so it deliberately does not live
 * in lib/album-date.ts, which client components on the homepage import. Pair the
 * result with `resolveOriginalRelease` from lib/album-date.ts in any script that
 * merges feed metadata onto a cached album.
 */
import fs from 'fs';
import path from 'path';

const FEEDS_FILE = 'data/feeds.json';

/**
 * feedId -> curated originalReleaseYear, for the feeds that declare one.
 * A feed with no key is absent from the map, so `overrides[feedId]` is
 * `undefined` and the extractor stays in charge; an explicit `null` is kept,
 * because that means "suppress the extracted date".
 */
export function loadOriginalReleaseOverrides(): Record<string, number | null> {
  const fullPath = path.join(process.cwd(), FEEDS_FILE);
  if (!fs.existsSync(fullPath)) return {};

  const feeds: any[] = JSON.parse(fs.readFileSync(fullPath, 'utf-8')).feeds || [];
  const overrides: Record<string, number | null> = {};
  feeds.forEach((feed) => {
    if (Object.prototype.hasOwnProperty.call(feed, 'originalReleaseYear')) {
      overrides[feed.id] = feed.originalReleaseYear;
    }
  });
  return overrides;
}
