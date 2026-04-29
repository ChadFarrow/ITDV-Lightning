/**
 * Direct static cache regeneration script
 * Uses the RSS parser directly instead of going through the API
 * This ensures the latest parser changes are used without needing to restart the dev server
 */

import fs from 'fs';
import path from 'path';
import { RSSParser } from '../lib/rss-parser';

interface FeedEntry {
  id: string;
  originalUrl: string;
  type: string;
  title?: string;
  priority?: string;
  status?: string;
  trackFilter?: string;
}

interface FeedsData {
  feeds: FeedEntry[];
}

async function regenerateCache() {
  console.log('🔄 Regenerating static cache directly using RSS parser...\n');

  const feedsPath = path.join(process.cwd(), 'data', 'feeds.json');
  const outputPath = path.join(process.cwd(), 'public', 'albums-static-cached.json');
  const staticAlbumsPath = path.join(process.cwd(), 'public', 'static-albums.json');

  // Load feeds from feeds.json
  let feedsData: FeedsData;
  try {
    feedsData = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));
  } catch (error) {
    console.error('❌ Failed to load feeds.json:', error);
    process.exit(1);
  }

  const activeFeeds = feedsData.feeds.filter(f => f.status === 'active' && f.type === 'album');
  console.log(`📋 Found ${activeFeeds.length} active album feeds\n`);

  const albums: any[] = [];
  const errors: { feedId: string; error: string }[] = [];

  for (const feed of activeFeeds) {
    try {
      console.log(`🔍 Parsing: ${feed.title || feed.id}`);
      const album = await RSSParser.parseAlbumFeed(feed.originalUrl, feed.trackFilter);

      if (album) {
        // Add feed metadata
        const albumWithMeta = {
          ...album,
          feedId: feed.id,
          feedUrl: feed.originalUrl,
          priority: feed.priority,
          lastUpdated: new Date().toISOString()
        };

        albums.push(albumWithMeta);

        // Log video track info
        const videoTracks = album.tracks?.filter((t: any) => t.videoUrl) || [];
        if (videoTracks.length > 0) {
          console.log(`   ✅ ${album.title} - ${album.tracks?.length} tracks (${videoTracks.length} with video)`);
        } else {
          console.log(`   ✅ ${album.title} - ${album.tracks?.length} tracks`);
        }
      } else {
        errors.push({ feedId: feed.id, error: 'Failed to parse feed' });
        console.log(`   ❌ Failed to parse`);
      }
    } catch (error) {
      errors.push({ feedId: feed.id, error: String(error) });
      console.log(`   ❌ Error: ${String(error).slice(0, 100)}`);
    }
  }

  console.log(`\n📊 Results: ${albums.length} albums parsed, ${errors.length} errors`);

  // Write to albums-static-cached.json
  const cacheData = {
    timestamp: new Date().toISOString(),
    count: albums.length,
    albums
  };

  fs.writeFileSync(outputPath, JSON.stringify(cacheData, null, 2));
  console.log(`\n✅ Wrote ${albums.length} albums to ${outputPath}`);

  // Also update static-albums.json
  fs.writeFileSync(staticAlbumsPath, JSON.stringify(cacheData, null, 2));
  console.log(`✅ Wrote ${albums.length} albums to ${staticAlbumsPath}`);

  // Show Think EP LIVE status
  const thinkEp = albums.find(a => a.title?.toLowerCase().includes('think ep live'));
  if (thinkEp) {
    console.log('\n🎵 Think EP LIVE! status:');
    thinkEp.tracks?.slice(0, 2).forEach((t: any, i: number) => {
      console.log(`   Track ${i}: ${t.title}`);
      console.log(`      url: ${t.url}`);
      console.log(`      videoUrl: ${t.videoUrl}`);
    });
  }

  if (errors.length > 0) {
    console.log('\n⚠️ Errors:');
    errors.forEach(e => console.log(`   ${e.feedId}: ${e.error}`));
  }

  // Rebuild album index to match new cache order
  console.log('\n🔄 Rebuilding album index...');
  const { buildIndex } = require('./build-album-index.js');
  buildIndex();
}

regenerateCache().catch(console.error);
