/**
 * Backfill `originalRelease` onto the cached albums by re-running the description
 * date extractor over the text already in the cache.
 *
 * Why not a full re-parse: private feeds (isPrivate: true) carry PRIVATE_FEED_URL
 * in the committed JSON, so `regenerate-static-cache-direct.ts` can't reach them
 * from a fresh checkout. The descriptions are already in the cache, and the
 * extractor is pure text — no network needed.
 *
 * Idempotent: re-running produces the same result, and albums whose description
 * no longer yields a date have the key removed.
 *
 * Run: npx tsx scripts/backfill-album-dates.ts
 */
import fs from 'fs';
import path from 'path';
import { extractAlbumDate } from '../lib/album-date';

const FILES = ['public/static-albums.json', 'public/albums-static-cached.json'];

/**
 * The dates we verified by hand when this extractor was written. The backfill
 * refuses to write if the extractor stops agreeing — this is the repo's stand-in
 * for a unit test (same convention as scripts/reparse-affected.ts).
 */
const EXPECTED_YEARS: Record<string, number> = {
  'Think EP': 2017,
  'Think EP LIVE!': 2017,
  Them: 2019,
  'Your Chance': 2015,
  'Jam with Nate': 2025,
  'DFB Volume 1': 2007,
  'DFB Volume 2': 2009,
  'Beware of Banjo': 2008,
  'Generation Gap': 2009,
};

/** Years in these descriptions are a birth date and a memorial lifespan, not album dates. */
const MUST_NOT_MATCH = ['Autumn', 'Unsound Existence (self-hosted version)'];

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function main() {
  const authoritativePath = path.join(process.cwd(), FILES[0]);
  const authoritative = JSON.parse(fs.readFileSync(authoritativePath, 'utf-8'));
  const albums: any[] = authoritative.albums || [];

  console.log(`📋 ${albums.length} albums in ${FILES[0]}\n`);

  // --- Verify the extractor still behaves before touching any file ---
  const extracted = albums.map((album) => ({
    title: album.title as string,
    releaseDate: album.releaseDate as string,
    info: extractAlbumDate(album.description),
  }));
  const byTitle = (title: string) => extracted.filter((e) => e.title === title)[0];

  Object.keys(EXPECTED_YEARS).forEach((title) => {
    const expectedYear = EXPECTED_YEARS[title];
    const entry = byTitle(title);
    if (!entry) fail(`expected album "${title}" is missing from the cache`);
    if (!entry.info) fail(`"${title}" should yield ${expectedYear}, got nothing`);
    if (entry.info.year !== expectedYear) {
      fail(`"${title}" should yield ${expectedYear}, got ${entry.info.year}`);
    }
  });

  MUST_NOT_MATCH.forEach((title) => {
    const entry = byTitle(title);
    if (entry && entry.info) {
      fail(`"${title}" must not yield a date, got ${entry.info.year} from "${entry.info.source}"`);
    }
  });

  const matched = extracted.filter((e) => e.info);
  const unexpected = matched.filter((e) => !(e.title in EXPECTED_YEARS));
  if (unexpected.length > 0) {
    fail(
      `unexpected matches (verify these by hand, then add them to EXPECTED_YEARS): ` +
        unexpected.map((e) => `${e.title}=${e.info!.year}`).join(', ')
    );
  }
  if (matched.length !== Object.keys(EXPECTED_YEARS).length) {
    fail(`expected ${Object.keys(EXPECTED_YEARS).length} matches, got ${matched.length}`);
  }

  console.log(`✅ extractor checks passed: ${matched.length} matches, ${MUST_NOT_MATCH.length} traps rejected\n`);

  // --- Report what will change ---
  console.log('Album                                  pubDate year -> display year');
  console.log('-'.repeat(70));
  matched.forEach((entry) => {
    const info = entry.info!;
    const oldYear = new Date(entry.releaseDate).getFullYear();
    const flag = oldYear === info.year ? '   ' : ' * ';
    console.log(`${flag}${entry.title.padEnd(36)} ${oldYear}  ->  ${info.year}  (${info.kind})`);
  });

  // --- Write both cache files (CLAUDE.md: treat them as one set) ---
  console.log('');
  for (const file of FILES) {
    const fullPath = path.join(process.cwd(), file);
    if (!fs.existsSync(fullPath)) {
      console.log(`⏭️  ${file} not present, skipping`);
      continue;
    }

    const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    const list: any[] = data.albums || [];
    let changed = 0;

    for (const album of list) {
      const info = extractAlbumDate(album.description);
      if (info) {
        album.originalRelease = info;
        changed++;
      } else {
        delete album.originalRelease;
      }
    }

    data.count = list.length;
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
    console.log(`✅ ${file}: ${changed}/${list.length} albums given originalRelease`);
  }

  console.log('\n🔄 Rebuilding album-index.json');
  const { buildIndex } = require('./build-album-index.js');
  buildIndex();
}

main();
