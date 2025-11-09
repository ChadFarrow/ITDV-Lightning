import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const staticFilePath = path.join(process.cwd(), 'public', 'albums-static-cached.json');
    
    // Check if static file exists
    if (!fs.existsSync(staticFilePath)) {
      return NextResponse.json({ 
        error: 'Static album data not found. Run the build script to generate static data.' 
      }, { status: 404 });
    }
    
    // Read and return the static data
    const staticData = JSON.parse(fs.readFileSync(staticFilePath, 'utf-8'));
    
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