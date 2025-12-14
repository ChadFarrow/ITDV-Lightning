import { NextResponse } from 'next/server';
import { RSSParser } from '@/lib/rss-parser';
import { getAllFeeds, initializeDatabase } from '@/lib/db';

// Cache albums for 5 minutes to dramatically improve performance
let albumsCache: any = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // Check for cache-busting query parameter
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('refresh') === '1' || searchParams.get('nocache') === '1';
    
    // Check if we have fresh cached data (unless force refresh)
    const now = Date.now();
    if (!forceRefresh && albumsCache && (now - cacheTimestamp) < CACHE_TTL) {
      console.log('📦 Serving cached albums data');
      const response = NextResponse.json({
        ...albumsCache,
        cached: true,
        cacheAge: Math.round((now - cacheTimestamp) / 1000)
      });
      
      // Add HTTP cache headers for browser caching
      response.headers.set('Cache-Control', 'public, max-age=180, s-maxage=300');
      return response;
    }
    
    if (forceRefresh) {
      console.log('🔄 Force refresh requested, clearing cache...');
      albumsCache = null;
      cacheTimestamp = 0;
    }

    console.log('🔄 Cache miss or expired, fetching fresh data...');
    
    // Initialize database schema if needed (but don't auto-seed)
    await initializeDatabase();
    
    // Load RSS feeds from database
    const dbFeeds = await getAllFeeds();
    
    // Process each RSS feed
    const albums = [];
    let processed = 0;
    
    for (const feed of dbFeeds) {
      if (feed.status === 'active') {
        try {
          console.log(`🎵 Processing RSS feed ${++processed}/${dbFeeds.length}: ${feed.original_url}`);
          const album = await RSSParser.parseAlbumFeed(feed.original_url);
          if (album) {
            // Clean up image URLs to prevent 400 errors
            if (album.coverArt) {
              album.coverArt = album.coverArt
                .replace(/\?\.jpg$/, '.jpg')
                .replace(/\?\.$/, '')
                .replace(/\?$/, '');
            }
            
            // Clean track images too
            album.tracks.forEach(track => {
              if (track.image) {
                track.image = track.image
                  .replace(/\?\.jpg$/, '.jpg')
                  .replace(/\?\.$/, '')
                  .replace(/\?$/, '');
              }
            });
            
            // Add feed metadata to the album
            album.feedId = feed.id;
            album.feedUrl = feed.original_url;
            album.lastUpdated = feed.last_updated.toISOString();
            albums.push(album);
            console.log(`✅ Successfully parsed album: ${album.title}`);
          }
        } catch (error) {
          console.error(`❌ Failed to parse RSS feed ${feed.original_url}:`, error);
          // Continue processing other feeds
        }
      }
    }

    // Cache the result
    albumsCache = {
      albums,
      count: albums.length,
      timestamp: new Date().toISOString()
    };
    cacheTimestamp = now;
    
    console.log(`💾 Cached ${albums.length} albums for ${CACHE_TTL/1000/60} minutes`);

    const response = NextResponse.json({
      ...albumsCache,
      cached: false
    });
    
    // Add HTTP cache headers
    response.headers.set('Cache-Control', 'public, max-age=180, s-maxage=300');
    return response;
  } catch (error) {
    console.error('Error processing RSS feeds:', error);
    
    // Try to fallback to static albums data when database is unavailable
    try {
      console.log('🔄 Database unavailable, falling back to static albums data...');
      const fs = require('fs');
      const path = require('path');
      const staticDataPath = path.join(process.cwd(), 'public', 'static-albums.json');
      
      if (fs.existsSync(staticDataPath)) {
        const staticData = JSON.parse(fs.readFileSync(staticDataPath, 'utf8'));
        console.log(`📦 Serving ${staticData.albums?.length || 0} static albums as fallback`);
        
        // Cache the static data
        albumsCache = {
          albums: staticData.albums || [],
          count: staticData.albums?.length || 0,
          timestamp: new Date().toISOString(),
          fallback: true
        };
        cacheTimestamp = Date.now();
        
        const response = NextResponse.json({
          ...albumsCache,
          cached: false,
          source: 'static_fallback'
        });
        
        response.headers.set('Cache-Control', 'public, max-age=180, s-maxage=300');
        return response;
      }
    } catch (fallbackError) {
      console.error('Static fallback also failed:', fallbackError);
    }
    
    return NextResponse.json(
      { 
        error: 'Failed to process RSS feeds and static fallback unavailable',
        albums: [],
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}