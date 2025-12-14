import { NextRequest, NextResponse } from 'next/server';
import { getAllFeeds, addFeed, initializeDatabase } from '@/lib/db';
import { RSSParser } from '@/lib/rss-parser';

/**
 * POST /api/admin/ensure-feed
 * Ensures a feed exists in the database with the correct RSS feed URL.
 * If a feed with podcastindex.org URL exists, it will be replaced with the RSS feed URL.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { rssFeedUrl, podcastIndexId } = body;

    if (!rssFeedUrl) {
      return NextResponse.json(
        { success: false, error: 'RSS feed URL is required' },
        { status: 400 }
      );
    }

    // Initialize database
    await initializeDatabase(false);

    // Get all feeds
    const allFeeds = await getAllFeeds();

    // Check if feed already exists with correct URL
    const existingFeed = allFeeds.find(feed => feed.original_url === rssFeedUrl);

    if (existingFeed) {
      // Feed exists with correct URL
      if (existingFeed.status === 'active') {
        return NextResponse.json({
          success: true,
          message: 'Feed already exists and is active',
          feed: {
            id: existingFeed.id,
            url: existingFeed.original_url,
            title: existingFeed.title,
            status: existingFeed.status
          }
        });
      } else {
        return NextResponse.json({
          success: false,
          error: 'Feed exists but is inactive',
          feed: {
            id: existingFeed.id,
            url: existingFeed.original_url,
            status: existingFeed.status
          }
        }, { status: 400 });
      }
    }

    // Check if there's a feed with podcastindex.org URL that needs to be replaced
    if (podcastIndexId) {
      const wrongFeed = allFeeds.find(feed => 
        feed.original_url.includes('podcastindex.org') && 
        feed.original_url.includes(podcastIndexId)
      );

      if (wrongFeed) {
        return NextResponse.json({
          success: false,
          error: 'Feed exists with podcastindex.org URL (not an RSS feed). Please remove it first and add the correct RSS feed URL.',
          existingFeed: {
            id: wrongFeed.id,
            url: wrongFeed.original_url,
            title: wrongFeed.title
          },
          correctRssUrl: rssFeedUrl
        }, { status: 400 });
      }
    }

    // Test parsing the feed to ensure it's valid
    try {
      console.log(`🧪 Testing RSS feed parsing: ${rssFeedUrl}`);
      const testAlbum = await RSSParser.parseAlbumFeed(rssFeedUrl);
      
      if (!testAlbum || !testAlbum.title) {
        return NextResponse.json(
          { success: false, error: 'RSS feed is not valid or cannot be parsed' },
          { status: 400 }
        );
      }

      console.log(`✅ Feed parsed successfully: ${testAlbum.title}`);
    } catch (parseError) {
      console.error('Failed to parse feed:', parseError);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Failed to parse RSS feed',
          details: parseError instanceof Error ? parseError.message : 'Unknown error'
        },
        { status: 400 }
      );
    }

    // Add the feed to database
    const result = await addFeed(rssFeedUrl, 'album', undefined, {
      source: 'manual',
      priority: 'core'
    });

    if (result.success && result.feed) {
      return NextResponse.json({
        success: true,
        message: 'Feed added successfully',
        feed: {
          id: result.feed.id,
          url: result.feed.original_url,
          title: result.feed.title,
          status: result.feed.status
        }
      });
    } else {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to add feed' },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('Error ensuring feed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to ensure feed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

