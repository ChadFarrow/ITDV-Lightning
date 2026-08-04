/**
 * One-off: re-parse the Them feed (whose URL is redacted as "PRIVATE_FEED_URL"
 * in committed feeds.json) using the public source URL, and update the local
 * static cache. Preserves the redacted feedUrl so the JSON files stay safe to
 * commit.
 */
import fs from 'fs';
import path from 'path';
import { RSSParser } from '../lib/rss-parser';
import { resolveOriginalRelease } from '../lib/album-date';
import { loadOriginalReleaseOverrides } from './feed-overrides';

const PUBLIC_URL = 'https://www.doerfelverse.com/feeds/them.xml';
const FEED_ID = 'www-doerfelverse-com-feeds-them-xml';
const REDACTED_URL = 'PRIVATE_FEED_URL';

async function main() {
  console.log(`🔄 Re-parsing Them feed from ${PUBLIC_URL}`);
  const album = await RSSParser.parseAlbumFeed(PUBLIC_URL);
  if (!album) {
    console.error('❌ Failed to parse feed');
    process.exit(1);
  }

  const albumWithMeta: any = {
    ...album,
    feedId: FEED_ID,
    feedUrl: REDACTED_URL,
    priority: 'extended',
    // A curated originalReleaseYear in feeds.json beats the date mined from the
    // description, so hand-corrected years survive a reparse. This replaces the
    // whole cache entry, so without it the curated year is silently dropped.
    originalRelease: resolveOriginalRelease(
      album.originalRelease,
      loadOriginalReleaseOverrides()[FEED_ID]
    ),
    lastUpdated: new Date().toISOString(),
  };

  console.log(`✅ Parsed ${albumWithMeta.tracks.length} tracks`);
  const videoTracks = albumWithMeta.tracks.filter((t: any) => t.videoUrl);
  console.log(`🎬 ${videoTracks.length} tracks have video:`);
  videoTracks.forEach((t: any) => console.log(`   - ${t.title} -> ${t.videoUrl}`));

  const filesToUpdate = [
    'public/static-albums.json',
    'public/albums-static-cached.json',
  ];

  for (const file of filesToUpdate) {
    const fullPath = path.join(process.cwd(), file);
    if (!fs.existsSync(fullPath)) {
      console.log(`⚠️  ${file} not found, skipping`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    data.albums = data.albums || [];
    const idx = data.albums.findIndex((a: any) => a.feedId === FEED_ID);
    if (idx >= 0) {
      data.albums[idx] = albumWithMeta;
    } else {
      data.albums.push(albumWithMeta);
    }
    data.count = data.albums.length;
    data.timestamp = new Date().toISOString();
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
    console.log(`✅ Updated ${file}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
