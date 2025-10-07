import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// In-memory cache for generated data
let generatedData: any = null;
let lastGenerated = 0;
const GENERATION_TTL = 10 * 60 * 1000; // 10 minutes

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const forceRegenerate = searchParams.get('regenerate') === 'true';
    const clearCache = searchParams.get('clear') === 'true';
    const priority = searchParams.get('priority'); // 'high' for critical albums
    
    // Handle cache clearing
    const staticDataPath = path.join(process.cwd(), 'public', 'static-albums.json');
    
    if (clearCache) {
      // Clear in-memory cache (can't delete files in serverless/read-only environments)
      generatedData = null;
      lastGenerated = 0;
      console.log('🗑️ Cleared in-memory cache (file system is read-only)');
      
      return NextResponse.json({
        message: 'In-memory cache cleared successfully (file system is read-only)',
        cleared: true,
        note: 'Static file cannot be deleted in serverless environment',
        timestamp: new Date().toISOString()
      });
    }
    
    // Try to serve pre-generated static file first (unless forced regeneration)
    // Skip static file if regenerating or if we want to ignore old incomplete data
    const ignoreStaticFile = forceRegenerate || searchParams.get('ignore-static') === 'true';
    
    if (!ignoreStaticFile && fs.existsSync(staticDataPath)) {
      const staticData = JSON.parse(fs.readFileSync(staticDataPath, 'utf8'));
      
      const response = NextResponse.json({
        ...staticData,
        static: true,
        loadTime: 'instant'
      });
      
      // Aggressive caching for static data
      response.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=7200, stale-while-revalidate=86400');
      response.headers.set('CDN-Cache-Control', 'max-age=7200');
      return response;
    }
    
    // Check in-memory cache (unless forced regeneration)
    const now = Date.now();
    if (!forceRegenerate && generatedData && (now - lastGenerated) < GENERATION_TTL) {
      console.log('📦 Serving cached generated data');
      const response = NextResponse.json({
        ...generatedData,
        static: false,
        cached: true,
        loadTime: 'cached'
      });
      
      response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=1800');
      response.headers.set('CDN-Cache-Control', 'max-age=600');
      return response;
    }
    
    // Generate data on-demand by calling the RSS parsing endpoint
    if (forceRegenerate) {
      console.log('🔄 Force regenerating static data with all feeds...');
    } else {
      console.log('🔄 Generating static data on-demand...');
    }
    
    try {
      // Import and use RSS parser directly to avoid HTTP overhead
      const { FeedManager } = await import('@/lib/feed-manager');
      const { RSSParser } = await import('@/lib/rss-parser');
      
      console.log('🔄 Parsing albums without database dependency...');
      
      // Get feeds directly from FeedManager (uses feeds.json, no database)
      const feeds = FeedManager.getActiveFeeds();
      const albumFeeds = feeds.filter(feed => feed.type === 'album');
      
      console.log(`📡 Processing ${albumFeeds.length} album feeds...`);
      
      const albums = [];
      const errors = [];
      
      // Process ALL album feeds - no priority filtering
      // Show everything on the site as requested
      const feedsToProcess = albumFeeds;

      console.log(`📡 Processing ${feedsToProcess.length} album feeds (all priorities)...`);

      for (const feed of feedsToProcess) {
        try {
          console.log(`🎵 Parsing: ${feed.title}${feed.trackFilter ? ` (filtering: ${feed.trackFilter})` : ''}`);
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
            console.log(`✅ Parsed: ${albumData.title}`);
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
      
      console.log(`🎉 Successfully parsed ${albums.length} albums for static generation`);
      
      const albumsData = {
        albums,
        count: albums.length,
        errors,
        timestamp: new Date().toISOString(),
        source: 'direct-static-parsing'
      };
      
      // Cache in memory
      generatedData = {
        ...albumsData,
        generated: true,
        generatedAt: new Date().toISOString()
      };
      lastGenerated = now;
      
      // Try to save to file for next time
      try {
        fs.writeFileSync(staticDataPath, JSON.stringify(generatedData, null, 2));
        console.log('💾 Saved generated data to static file');
      } catch (writeError) {
        console.warn('⚠️ Could not save static file:', writeError instanceof Error ? writeError.message : writeError);
      }
      
      const response = NextResponse.json({
        ...generatedData,
        static: false,
        generated: true,
        loadTime: 'on-demand'
      });
      
      response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=1800');
      response.headers.set('CDN-Cache-Control', 'max-age=600');
      return response;
    } catch (generationError) {
      console.warn('⚠️ Could not generate data:', generationError instanceof Error ? generationError.message : generationError);
    }
    
    // Fallback to minimal hardcoded data if no static file exists
    const fallbackAlbums = [
      {
        title: "Bloodshot Lies",
        artist: "Doerfel Family",
        description: "The album",
        coverArt: "/bloodshot-lies-big.png",
        tracks: [
          {
            title: "Bloodshot Lies",
            duration: "3:45",
            url: "https://www.doerfelverse.com/audio/bloodshot-lies.mp3",
            trackNumber: 1
          }
        ],
        releaseDate: "2024-01-01",
        feedId: "fallback"
      }
    ];
    
    const response = NextResponse.json({
      albums: fallbackAlbums,
      count: fallbackAlbums.length,
      timestamp: new Date().toISOString(),
      static: false,
      fallback: true
    });
    
    response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=600');
    return response;
    
  } catch (error) {
    console.error('Error serving static albums:', error);
    return NextResponse.json(
      { 
        error: 'Failed to load albums',
        albums: [],
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}