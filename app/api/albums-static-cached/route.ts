import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// In-memory cache for static albums data to avoid reading from disk every time
let staticAlbumsCache: { data: any; timestamp: number; fileMtime: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  try {
    const staticFilePath = path.join(process.cwd(), 'public', 'static-albums.json');
    
    // Check if static file exists
    if (!fs.existsSync(staticFilePath)) {
      return NextResponse.json({ 
        error: 'Static album data not found. Run the build script to generate static data.' 
      }, { status: 404 });
    }
    
    // Check file modification time to invalidate cache if file changed
    const fileStats = fs.statSync(staticFilePath);
    const fileMtime = fileStats.mtimeMs;
    const now = Date.now();
    
    // Use cache if it exists, is fresh, and file hasn't changed
    if (staticAlbumsCache && 
        (now - staticAlbumsCache.timestamp) < CACHE_TTL &&
        staticAlbumsCache.fileMtime === fileMtime) {
      const response = {
        ...staticAlbumsCache.data,
        metadata: {
          ...staticAlbumsCache.data.metadata,
          servedFrom: 'memory-cache',
          servedAt: new Date().toISOString()
        }
      };
      
      return NextResponse.json(response, {
        headers: {
          'Cache-Control': 'public, max-age=3600, s-maxage=7200, stale-while-revalidate=86400',
        }
      });
    }
    
    // Read from disk and cache
    const staticData = JSON.parse(fs.readFileSync(staticFilePath, 'utf-8'));
    
    // Update cache
    staticAlbumsCache = {
      data: staticData,
      timestamp: now,
      fileMtime: fileMtime
    };
    
    // Add metadata about the static data
    const response = {
      ...staticData,
      metadata: {
        ...staticData.metadata,
        servedFrom: 'static-file',
        servedAt: new Date().toISOString()
      }
    };
    
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=7200, stale-while-revalidate=86400', // Aggressive caching
      }
    });
    
  } catch (error) {
    console.error('❌ Error serving static albums:', error);
    return NextResponse.json({ 
      error: 'Failed to load static album data',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}