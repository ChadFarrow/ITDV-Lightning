import { NextRequest, NextResponse } from 'next/server';
import { FeedManager } from '@/lib/feed-manager';
import { RSSParser } from '@/lib/rss-parser';

export async function GET(request: NextRequest) {
  console.log('🔄 Parsing albums without database dependency...');
  
  try {
    // Get feeds directly from FeedManager (uses feeds.json, no database)
    const feeds = FeedManager.getActiveFeeds();
    const albumFeeds = feeds.filter(feed => feed.type === 'album');
    
    console.log(`📡 Processing ${albumFeeds.length} album feeds...`);
    
    const albums = [];
    const errors = [];
    
    for (const feed of albumFeeds) {
      try {
        console.log(`🎵 Parsing: ${feed.title}`);
        
        // Add delay for Wavlake feeds to avoid rate limiting
        if (feed.originalUrl.includes('wavlake.com')) {
          await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay for Wavlake
        }
        
        const albumData = await RSSParser.parseAlbumFeed(feed.originalUrl, feed.trackFilter);

        if (albumData) {
          // Add feed metadata
          const enrichedAlbum = {
            ...albumData,
            feedId: feed.id,
            feedUrl: feed.originalUrl,
            lastUpdated: feed.lastUpdated
          };
          
          albums.push(enrichedAlbum);
          console.log(`✅ Parsed: ${albumData.title} ${albumData.publisher ? '(with publisher)' : '(no publisher)'}`);
        } else {
          console.warn(`⚠️ No data returned for ${feed.title}`);
          errors.push({
            feedId: feed.id,
            error: 'No album data returned'
          });
        }
      } catch (error) {
        console.error(`❌ Error parsing ${feed.title}:`, error);
        errors.push({
          feedId: feed.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    console.log(`🎉 Successfully parsed ${albums.length} albums (${errors.length} errors)`);
    
    return NextResponse.json({
      albums,
      count: albums.length,
      errors,
      timestamp: new Date().toISOString(),
      source: 'direct-rss-parsing'
    });
    
  } catch (error) {
    console.error('❌ Error in albums-no-db endpoint:', error);
    return NextResponse.json({
      error: 'Failed to parse albums',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}