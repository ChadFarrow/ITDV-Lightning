import { NextResponse } from 'next/server';
import { FeedManager } from '@/lib/feed-manager';
import { RSSParser } from '@/lib/rss-parser';

// Cache for individual albums to avoid repeated RSS parsing
let albumCache: Map<string, { data: any; timestamp: number }> = new Map();
const ALBUM_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// In-memory cache for static albums data (1.2MB, but faster than reading from disk every time)
let staticAlbumsCache: { albums: any[]; timestamp: number } | null = null;
let albumIndexCache: { index: Record<string, any>; timestamp: number } | null = null;
const STATIC_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const albumId = decodeURIComponent(id);
    
    // Check for bypass cache parameter
    const { searchParams } = new URL(request.url);
    const bypassCache = searchParams.get('nocache') === '1' || searchParams.get('refresh') === '1';
    
    // Check cache first (unless bypassing)
    if (!bypassCache) {
      const cached = albumCache.get(albumId);
      if (cached && Date.now() - cached.timestamp < ALBUM_CACHE_TTL) {
        const response = NextResponse.json({ 
          album: cached.data,
          cached: true,
          timestamp: new Date().toISOString()
        });
        
        // Add cache headers for better performance
        response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=600');
        return response;
      }
    } else {
      // Clear cache if bypassing
      albumCache.delete(albumId);
    }
    
    // Helper function to create URL slug (same as homepage)
    const createSlug = (title: string) =>
      title.toLowerCase()
        .replace(/[^\w\s-]/g, '')       // Remove punctuation except spaces and hyphens
        .replace(/\s+/g, '-')           // Replace spaces with dashes
        .replace(/-+/g, '-')            // Replace multiple consecutive dashes with single dash
        .replace(/^-+|-+$/g, '');       // Remove leading/trailing dashes

    // PRIORITY 1: Check static albums data first (fastest, no RSS parsing needed)
    // Use index file for fast lookups instead of reading entire 1.2MB file
    let matchingStaticAlbum = null;
    let feedIdFromCache = null;
    
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const now = Date.now();
      
      // Load index cache (58KB, much faster than 1.2MB)
      if (!albumIndexCache || (now - albumIndexCache.timestamp) > STATIC_CACHE_TTL) {
        const indexPath = path.join(process.cwd(), 'public', 'album-index.json');
        try {
          const indexData = await fs.readFile(indexPath, 'utf8');
          const indexJson = JSON.parse(indexData);
          albumIndexCache = { index: indexJson.index || {}, timestamp: now };
        } catch (error) {
          // Index file doesn't exist, will fall back to full file search
          albumIndexCache = { index: {}, timestamp: now };
        }
      }
      
      // Try to find album using index (fast lookup)
      const normalizedId = albumId.toLowerCase();
      const indexEntry = albumIndexCache.index[normalizedId] || 
                        albumIndexCache.index[createSlug(albumId)] ||
                        albumIndexCache.index[albumId.toLowerCase().replace(/\s+/g, '-')];
      
      if (indexEntry && indexEntry.index !== undefined) {
        // Load static albums cache if needed
        if (!staticAlbumsCache || (now - staticAlbumsCache.timestamp) > STATIC_CACHE_TTL) {
          const staticAlbumsPath = path.join(process.cwd(), 'public', 'static-albums.json');
          const staticAlbumsData = await fs.readFile(staticAlbumsPath, 'utf8');
          const staticAlbumsJson = JSON.parse(staticAlbumsData);
          staticAlbumsCache = { albums: staticAlbumsJson.albums || [], timestamp: now };
        }
        
        // Directly access album by index (O(1) instead of O(n) search)
        if (staticAlbumsCache.albums[indexEntry.index]) {
          matchingStaticAlbum = staticAlbumsCache.albums[indexEntry.index];
        }
      } else {
        // Fallback: search through albums if index lookup failed
        if (!staticAlbumsCache || (now - staticAlbumsCache.timestamp) > STATIC_CACHE_TTL) {
          const staticAlbumsPath = path.join(process.cwd(), 'public', 'static-albums.json');
          const staticAlbumsData = await fs.readFile(staticAlbumsPath, 'utf8');
          const staticAlbumsJson = JSON.parse(staticAlbumsData);
          staticAlbumsCache = { albums: staticAlbumsJson.albums || [], timestamp: now };
        }
        
        const staticAlbums = staticAlbumsCache.albums;
        
        // Search static albums for matching ID (fallback)
        matchingStaticAlbum = staticAlbums.find((album: any) => {
          const titleMatch = album.title?.toLowerCase() === albumId.toLowerCase();
          const slugMatch = createSlug(album.title || '') === albumId.toLowerCase();
          const compatMatch = album.title?.toLowerCase().replace(/\s+/g, '-') === albumId.toLowerCase();

          // Flexible matching: check if the album title starts with the decoded ID
          const baseTitle = album.title?.toLowerCase().split(/\s*[-–]\s*/)[0] || '';
          const baseTitleSlug = createSlug(baseTitle);
          const flexibleMatch = baseTitleSlug === albumId.toLowerCase();

          return titleMatch || slugMatch || compatMatch || flexibleMatch;
        });
      }

      if (matchingStaticAlbum) {
        // Get feedId from static cache for faster RSS parsing when refresh=1
        feedIdFromCache = matchingStaticAlbum.feedId;
        
        // If not bypassing cache, return static album data directly
        if (!bypassCache) {
          const album = {
            ...matchingStaticAlbum,
            lastUpdated: matchingStaticAlbum.lastUpdated || new Date().toISOString()
          };

          // Cache the result
          albumCache.set(albumId, { data: album, timestamp: Date.now() });

          const response = NextResponse.json({
            album,
            timestamp: new Date().toISOString(),
            source: 'static-cache',
            cached: false
          });

          // Add aggressive cache headers for static data
          response.headers.set('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400');
          return response;
        }
      }
    } catch (error) {
      // Silently handle errors - continue to RSS parsing fallback
    }

    // PRIORITY 2: Fall back to RSS parsing if not in static cache (only if bypassCache is true)
    // For normal requests, return 404 if not in static cache to avoid slow RSS parsing
    if (!bypassCache) {
      return NextResponse.json({ error: 'Album not found in cache' }, { status: 404 });
    }

    // Get feeds directly from FeedManager (uses feeds.json, no database)
    const feeds = FeedManager.getActiveFeeds();
    const albumFeeds = feeds.filter(feed => feed.type === 'album');

    // Find the matching album feed first
    let matchingFeed = null;

    // First try using feedId from static cache (fastest when refresh=1)
    if (feedIdFromCache) {
      matchingFeed = albumFeeds.find(feed => feed.id === feedIdFromCache);
    }
    
    // If no match from cache feedId, try direct feed ID match
    if (!matchingFeed) {
      for (const feed of albumFeeds) {
        if (feed.id === albumId) {
          matchingFeed = feed;
          break;
        }
      }
    }
    
    // If no direct match, try parsing RSS feeds to match by album title
    if (!matchingFeed) {
      for (const feed of albumFeeds) {
        try {
          // Parse this feed to get the actual album data
          const albumData = await RSSParser.parseAlbumFeed(feed.originalUrl, feed.trackFilter);
          if (!albumData?.title) continue;
          
          // Try various matching patterns with the actual album title
          const albumTitle = albumData.title;
          const titleMatch = albumTitle.toLowerCase() === albumId.toLowerCase();
          const slugMatch = createSlug(albumTitle) === albumId.toLowerCase();
          const compatMatch = albumTitle.toLowerCase().replace(/\s+/g, '-') === albumId.toLowerCase();
          
          // Flexible matching: check if the album title starts with the decoded ID
          const baseTitle = albumTitle.toLowerCase().split(/\s*[-–]\s*/)[0];
          const baseTitleSlug = createSlug(baseTitle);
          const flexibleMatch = baseTitleSlug === albumId.toLowerCase();
          
          if (titleMatch || slugMatch || compatMatch || flexibleMatch) {
            matchingFeed = feed;
            // Store the already parsed album data to avoid re-parsing
            (matchingFeed as any)._parsedAlbumData = albumData;
            break;
          }
        } catch (error) {
          continue; // Try next feed
        }
      }
    }
    
    // If no feed found after RSS parsing, return 404
    if (!matchingFeed) {
      return NextResponse.json({ error: 'Album not found' }, { status: 404 });
    }
    
    // Parse only the single RSS feed we need (or reuse already parsed data)
    const startTime = Date.now();
    
    let albumData;
    
    // If we already parsed this feed during title matching, reuse the data
    if ((matchingFeed as any)._parsedAlbumData) {
      albumData = (matchingFeed as any)._parsedAlbumData;
    } else {
      albumData = await RSSParser.parseAlbumFeed(matchingFeed.originalUrl, matchingFeed.trackFilter);
    }
    
    if (!albumData) {
      return NextResponse.json({ error: 'Failed to parse album' }, { status: 500 });
    }
    
    // Add feed metadata (same as albums-no-db endpoint)
    const album = {
      ...albumData,
      feedId: matchingFeed.id,
      feedUrl: matchingFeed.originalUrl,
      lastUpdated: matchingFeed.lastUpdated
    };
    
    const parseTime = Date.now() - startTime;
    
    // Cache the result
    albumCache.set(albumId, { data: album, timestamp: Date.now() });
    
    const response = NextResponse.json({ 
      album,
      parseTime: `${parseTime}ms`,
      timestamp: new Date().toISOString(),
      cached: false
    });
    
    // Add cache headers for better performance
    response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=600');
    return response;
    
  } catch (error) {
    return NextResponse.json({ 
      error: 'Failed to fetch album',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}