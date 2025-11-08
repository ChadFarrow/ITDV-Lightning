import { NextRequest, NextResponse } from 'next/server';
import { FeedManager } from '@/lib/feed-manager';
import { RSSParser } from '@/lib/rss-parser';
import { validateSession } from '@/lib/admin-auth';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

// Helper function to verify authentication
function verifyAuth(request: NextRequest): boolean {
  const token = request.cookies.get('admin-token')?.value;
  return validateSession(token);
}

// Helper function to generate ID from URL
function generateIdFromUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase();
}

// Helper function to parse feed and extract metadata
async function parseFeedMetadata(url: string) {
  try {
    const album = await RSSParser.parseAlbumFeed(url);
    return {
      title: album?.title || 'Feed from ' + new URL(url).hostname,
      type: 'album' as const,
    };
  } catch (error) {
    // If we can't parse as album, try as publisher
    try {
      const feed = await RSSParser.parsePublisherFeed(url);
      return {
        title: feed?.title || 'Publisher Feed',
        type: 'publisher' as const,
      };
    } catch {
      // Default to album type with generic title
      return {
        title: 'Feed from ' + new URL(url).hostname,
        type: 'album' as const,
      };
    }
  }
}

// POST - Add new feed(s)
export async function POST(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { url, urls, priority = 'extended', status = 'active', trackFilter } = body;

    // Handle single URL or multiple URLs
    const feedUrls = urls || [url];
    if (!feedUrls || feedUrls.length === 0) {
      return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
    }

    const addedFeeds = [];
    const errors = [];

    for (const feedUrl of feedUrls) {
      try {
        // Validate URL
        new URL(feedUrl);

        // Parse feed to get metadata
        const metadata = await parseFeedMetadata(feedUrl);

        // Generate ID
        const id = generateIdFromUrl(feedUrl);

        // Add feed
        FeedManager.addFeed({
          id,
          originalUrl: feedUrl,
          type: metadata.type,
          title: metadata.title,
          priority,
          status,
          ...(trackFilter && { trackFilter }),
        });

        addedFeeds.push({ id, url: feedUrl, title: metadata.title });
      } catch (error) {
        errors.push({ url: feedUrl, error: String(error) });
      }
    }

    // Regenerate static cache
    try {
      await execPromise('node scripts/regenerate-static-cache.js');
    } catch (error) {
      console.error('Failed to regenerate cache:', error);
    }

    return NextResponse.json({
      success: true,
      added: addedFeeds,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error adding feed:', error);
    return NextResponse.json(
      { error: 'Failed to add feed: ' + String(error) },
      { status: 500 }
    );
  }
}

// GET - List all feeds
export async function GET(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const feedsData = FeedManager.loadFeeds();
    return NextResponse.json({ feeds: feedsData.feeds });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load feeds' },
      { status: 500 }
    );
  }
}

// DELETE - Remove feed
export async function DELETE(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: 'No ID provided' }, { status: 400 });
    }

    FeedManager.removeFeed(id);

    // Regenerate static cache
    try {
      await execPromise('node scripts/regenerate-static-cache.js');
    } catch (error) {
      console.error('Failed to regenerate cache:', error);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to remove feed' },
      { status: 500 }
    );
  }
}
