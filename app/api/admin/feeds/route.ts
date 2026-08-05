import { NextRequest, NextResponse } from 'next/server';
import { getAllFeeds, addFeed, removeFeed, initializeDatabase } from '@/lib/db';
import { discoverPodrollFeeds } from '@/lib/podroll-discovery';
import { isAuthenticatedRequest } from '@/lib/admin-auth';

// Helper function to verify authentication

export async function GET(request: NextRequest) {
  if (!(await isAuthenticatedRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Initialize database schema if needed (but don't auto-seed)
    await initializeDatabase();
    
    const dbFeeds = await getAllFeeds();
    
    // Convert DB format to API format for compatibility
    const apiFeeds = dbFeeds.map(feed => ({
      id: feed.id,
      originalUrl: feed.original_url,
      type: feed.type,
      title: feed.title,
      priority: feed.priority,
      status: feed.status,
      addedAt: feed.added_at.toISOString(),
      lastUpdated: feed.last_updated.toISOString(),
      source: feed.source,
      discoveredFrom: feed.discovered_from
    }));
    
    return NextResponse.json({
      success: true,
      feeds: apiFeeds,
      count: apiFeeds.length
    });
  } catch (error) {
    console.error('Error fetching feeds:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch feeds',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticatedRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    console.log('POST /api/admin/feeds - Request body:', JSON.stringify(body, null, 2));
    
    const { url, type = 'album', title, discoverPodroll = true } = body;

    // Validate inputs
    if (!url) {
      console.log('POST /api/admin/feeds - ERROR: URL is required');
      return NextResponse.json(
        { success: false, error: 'URL is required' },
        { status: 400 }
      );
    }

    try {
      new URL(url);
      console.log('POST /api/admin/feeds - URL validation passed');
    } catch (urlError) {
      console.log('POST /api/admin/feeds - ERROR: Invalid URL format:', url);
      return NextResponse.json(
        { success: false, error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    if (!['album', 'publisher'].includes(type)) {
      console.log('POST /api/admin/feeds - ERROR: Invalid type:', type);
      return NextResponse.json(
        { success: false, error: 'Type must be "album" or "publisher"' },
        { status: 400 }
      );
    }

    console.log('POST /api/admin/feeds - All validations passed, proceeding with feed addition');

    // Add feed to database with manual source
    const result = await addFeed(url, type, title, { 
      source: 'manual',
      priority: 'core' 
    });
    
    if (result.success && result.feed) {
      let podrollStats = null;
      
      // Discover podroll feeds if requested (default true)
      if (discoverPodroll && type === 'album') {
        try {
          console.log(`🔍 Discovering podroll feeds for manually added feed: ${url}`);
          const discovery = await discoverPodrollFeeds(url, {
            autoAdd: true,
            recursive: true,
            maxDepth: 2,
            priority: 'extended'
          });
          podrollStats = discovery.stats;
          console.log(`📊 Podroll discovery completed:`, podrollStats);
        } catch (discoveryError) {
          console.error('Podroll discovery failed, but main feed was added:', discoveryError);
          // Don't fail the main request if podroll discovery fails
        }
      }
      
      // Convert DB format to API format
      const apiFeed = {
        id: result.feed.id,
        originalUrl: result.feed.original_url,
        type: result.feed.type,
        title: result.feed.title,
        priority: result.feed.priority,
        status: result.feed.status,
        addedAt: result.feed.added_at.toISOString(),
        lastUpdated: result.feed.last_updated.toISOString(),
        source: result.feed.source,
        discoveredFrom: result.feed.discovered_from
      };
      
      const response: any = {
        success: true,
        feed: apiFeed,
        message: 'Feed added successfully'
      };
      
      if (podrollStats) {
        response.podrollDiscovery = podrollStats;
        response.message += `. Discovered ${podrollStats.added} additional podroll feeds.`;
      }
      
      return NextResponse.json(response);
    } else {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to add feed' },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('POST /api/admin/feeds - Exception caught:', error);
    console.error('Error adding feed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to add feed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticatedRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { feedId } = body;

    if (!feedId) {
      return NextResponse.json(
        { success: false, error: "Feed ID is required" },
        { status: 400 }
      );
    }

    // Remove feed from database
    const result = await removeFeed(feedId);
    
    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Feed removed successfully'
      });
    } else {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to remove feed' },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error("Error removing feed:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: "Failed to remove feed",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
