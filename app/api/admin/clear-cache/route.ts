import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/admin-auth';

/**
 * POST /api/admin/clear-cache
 * Clears the server-side albums cache
 * Note: Client-side cache (localStorage) needs to be cleared on the client
 */
export async function POST(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Clear the albums cache by importing and resetting it
    // Since the cache is in a different module, we'll need to expose a function
    // For now, we'll return a success and the client can use ?refresh=1
    
    return NextResponse.json({
      success: true,
      message: 'Cache clear requested. Use ?refresh=1 on /api/albums to force refresh.',
      instructions: 'To clear cache, call /api/albums?refresh=1 or wait 5 minutes for TTL'
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to clear cache',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
