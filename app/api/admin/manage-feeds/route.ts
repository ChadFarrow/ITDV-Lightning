import { NextRequest, NextResponse } from 'next/server';
import { FeedManager } from '@/lib/feed-manager';
import { RSSParser } from '@/lib/rss-parser';
import { validateSession } from '@/lib/admin-auth';
import fs from 'fs';
import path from 'path';

// Helper function to verify authentication
function verifyAuth(request: NextRequest): boolean {
  const token = request.cookies.get('admin-token')?.value;
  return validateSession(token);
}

// Helper function to update static album files with a new album
async function addAlbumToStaticFiles(album: any, feedUrl: string, feedId: string) {
  const staticAlbumsPath = path.join(process.cwd(), 'public', 'static-albums.json');
  const cachedAlbumsPath = path.join(process.cwd(), 'public', 'albums-static-cached.json');

  // Prepare album with feed metadata
  const albumWithMeta = {
    ...album,
    feedId,
    feedUrl,
    lastUpdated: new Date().toISOString()
  };

  // Update static-albums.json
  try {
    if (fs.existsSync(staticAlbumsPath)) {
      const staticData = JSON.parse(fs.readFileSync(staticAlbumsPath, 'utf8'));
      // Check if album already exists (by feedUrl)
      const existingIndex = staticData.albums?.findIndex((a: any) => a.feedUrl === feedUrl);
      if (existingIndex >= 0) {
        staticData.albums[existingIndex] = albumWithMeta;
      } else {
        staticData.albums = staticData.albums || [];
        staticData.albums.push(albumWithMeta);
      }
      staticData.count = staticData.albums.length;
      staticData.timestamp = new Date().toISOString();
      fs.writeFileSync(staticAlbumsPath, JSON.stringify(staticData, null, 2));
      console.log(`✅ Updated static-albums.json with ${album.title}`);
    }
  } catch (error) {
    console.error('Failed to update static-albums.json:', error);
  }

  // Update albums-static-cached.json
  try {
    if (fs.existsSync(cachedAlbumsPath)) {
      const cachedData = JSON.parse(fs.readFileSync(cachedAlbumsPath, 'utf8'));
      const existingIndex = cachedData.albums?.findIndex((a: any) => a.feedUrl === feedUrl);
      if (existingIndex >= 0) {
        cachedData.albums[existingIndex] = albumWithMeta;
      } else {
        cachedData.albums = cachedData.albums || [];
        cachedData.albums.push(albumWithMeta);
      }
      cachedData.count = cachedData.albums.length;
      cachedData.timestamp = new Date().toISOString();
      fs.writeFileSync(cachedAlbumsPath, JSON.stringify(cachedData, null, 2));
      console.log(`✅ Updated albums-static-cached.json with ${album.title}`);
    }
  } catch (error) {
    console.error('Failed to update albums-static-cached.json:', error);
  }
}

// Helper function to remove album from static files
async function removeAlbumFromStaticFiles(feedId: string) {
  const staticAlbumsPath = path.join(process.cwd(), 'public', 'static-albums.json');
  const cachedAlbumsPath = path.join(process.cwd(), 'public', 'albums-static-cached.json');

  // Update static-albums.json
  try {
    if (fs.existsSync(staticAlbumsPath)) {
      const staticData = JSON.parse(fs.readFileSync(staticAlbumsPath, 'utf8'));
      staticData.albums = staticData.albums?.filter((a: any) => a.feedId !== feedId) || [];
      staticData.count = staticData.albums.length;
      staticData.timestamp = new Date().toISOString();
      fs.writeFileSync(staticAlbumsPath, JSON.stringify(staticData, null, 2));
      console.log(`✅ Removed feed ${feedId} from static-albums.json`);
    }
  } catch (error) {
    console.error('Failed to update static-albums.json:', error);
  }

  // Update albums-static-cached.json
  try {
    if (fs.existsSync(cachedAlbumsPath)) {
      const cachedData = JSON.parse(fs.readFileSync(cachedAlbumsPath, 'utf8'));
      cachedData.albums = cachedData.albums?.filter((a: any) => a.feedId !== feedId) || [];
      cachedData.count = cachedData.albums.length;
      cachedData.timestamp = new Date().toISOString();
      fs.writeFileSync(cachedAlbumsPath, JSON.stringify(cachedData, null, 2));
      console.log(`✅ Removed feed ${feedId} from albums-static-cached.json`);
    }
  } catch (error) {
    console.error('Failed to update albums-static-cached.json:', error);
  }
}

// Helper function to generate ID from URL
function generateIdFromUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase();
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

        // Parse feed to get full album data
        const album = await RSSParser.parseAlbumFeed(feedUrl);
        if (!album) {
          throw new Error('Failed to parse feed');
        }

        // Generate ID
        const id = generateIdFromUrl(feedUrl);

        // Add feed to feeds.json
        FeedManager.addFeed({
          id,
          originalUrl: feedUrl,
          type: 'album',
          title: album.title,
          priority,
          status,
          ...(trackFilter && { trackFilter }),
        });

        // Add album to static files immediately
        await addAlbumToStaticFiles(album, feedUrl, id);

        addedFeeds.push({ id, url: feedUrl, title: album.title });
      } catch (error) {
        errors.push({ url: feedUrl, error: String(error) });
      }
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

    // Remove from feeds.json
    FeedManager.removeFeed(id);

    // Remove from static files
    await removeAlbumFromStaticFiles(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to remove feed' },
      { status: 500 }
    );
  }
}
