/**
 * One-off: re-parse the three feeds whose behavior we just refactored
 * (Satellite Spotlight + CityBeach filter via feeds.json, Autumn Rust + simplified
 * track filter, Them + alt-enclosure video extraction). Confirms the new parser
 * code path produces the expected track counts before we trust the cache.
 *
 * Run: npx tsx scripts/reparse-affected.ts
 */
import fs from 'fs';
import path from 'path';
import { RSSParser } from '../lib/rss-parser';
import { resolveOriginalRelease } from '../lib/album-date';
import { loadOriginalReleaseOverrides } from './feed-overrides';

interface Target {
  publicUrl: string;
  feedId: string;
  trackFilter?: string;
  expectedTracks?: number;
  expectedVideos?: number;
  redactInCache?: boolean; // keep PRIVATE_FEED_URL in cache
}

const TARGETS: Target[] = [
  {
    publicUrl: 'https://music.behindthesch3m3s.com/wp-content/uploads/Sat_Skirmish/sproutingsymphonies/rss/satspotlightsymphony.xml',
    feedId: 'music-behindthesch3m3s-com-satellite-spotlight-citybeach-tracks-xml',
    trackFilter: 'CityBeach',
    expectedTracks: 17,
    expectedVideos: 2,
  },
  {
    publicUrl: 'https://music.behindthesch3m3s.com/wp-content/uploads/Sat_Skirmish/autumnrust/mp3s/album_feed/feed.xml',
    feedId: 'music-behindthesch3m3s-com-autumn-rust-doerfels-tracks-xml',
    trackFilter: 'The Doerfels',
    expectedTracks: 11,
    expectedVideos: 1,
  },
  {
    publicUrl: 'https://www.doerfelverse.com/feeds/them.xml',
    feedId: 'www-doerfelverse-com-feeds-them-xml',
    expectedTracks: 12,
    expectedVideos: 6,
    redactInCache: true,
  },
];

const FILES = [
  'public/static-albums.json',
  'public/albums-static-cached.json',
];

async function main() {
  const overrides = loadOriginalReleaseOverrides();

  for (const target of TARGETS) {
    console.log(`\n🔄 ${target.feedId}`);
    const album = await RSSParser.parseAlbumFeed(target.publicUrl, target.trackFilter);
    if (!album) {
      console.error('  ❌ parse failed');
      process.exit(1);
    }
    const videos = album.tracks.filter((t: any) => t.videoUrl);
    console.log(`  parsed ${album.tracks.length} tracks (${videos.length} with video)`);
    if (target.expectedTracks !== undefined && album.tracks.length !== target.expectedTracks) {
      console.error(`  ❌ expected ${target.expectedTracks} tracks, got ${album.tracks.length}`);
      process.exit(1);
    }
    if (target.expectedVideos !== undefined && videos.length !== target.expectedVideos) {
      console.error(`  ❌ expected ${target.expectedVideos} videos, got ${videos.length}`);
      process.exit(1);
    }

    const albumWithMeta: any = {
      ...album,
      feedId: target.feedId,
      feedUrl: target.redactInCache ? 'PRIVATE_FEED_URL' : target.publicUrl,
      priority: 'extended',
      // A curated originalReleaseYear in feeds.json beats the date mined from the
      // description, so hand-corrected years survive a reparse. This replaces the
      // whole cache entry, so without it the curated year is silently dropped.
      originalRelease: resolveOriginalRelease(album.originalRelease, overrides[target.feedId]),
      lastUpdated: new Date().toISOString(),
    };

    for (const file of FILES) {
      const fullPath = path.join(process.cwd(), file);
      if (!fs.existsSync(fullPath)) continue;
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      data.albums = data.albums || [];
      const idx = data.albums.findIndex((a: any) => a.feedId === target.feedId);
      if (idx >= 0) data.albums[idx] = albumWithMeta;
      else data.albums.push(albumWithMeta);
      data.count = data.albums.length;
      data.timestamp = new Date().toISOString();
      fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
      console.log(`  ✅ updated ${file}`);
    }
  }

  console.log('\n🔄 Rebuilding album-index.json');
  const { buildIndex } = require('./build-album-index.js');
  buildIndex();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
