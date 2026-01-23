import { NextRequest, NextResponse } from 'next/server';
import { FeedManager, FeedsData, Feed } from '@/lib/feed-manager';
import { RSSParser } from '@/lib/rss-parser';
import { validateSession } from '@/lib/admin-auth';
import { commitFiles, isGitHubConfigured } from '@/lib/github';
import fs from 'fs';
import path from 'path';

// Check if we're running on Vercel (read-only filesystem)
// VERCEL can be '1' or 'true', also check for VERCEL_URL as a fallback
const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_URL);

// Helper function to verify authentication
function verifyAuth(request: NextRequest): boolean {
  const token = request.cookies.get('admin-token')?.value;
  return validateSession(token);
}

// File paths for data files
const FEEDS_PATH = 'data/feeds.json';
const STATIC_ALBUMS_PATH = 'public/static-albums.json';
const CACHED_ALBUMS_PATH = 'public/albums-static-cached.json';
const ALBUM_INDEX_PATH = 'public/album-index.json';

// Helper to read JSON files safely
function readJsonFile<T>(relativePath: string, defaultValue: T): T {
  try {
    const fullPath = path.join(process.cwd(), relativePath);
    if (fs.existsSync(fullPath)) {
      return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    }
  } catch (error) {
    console.error(`Failed to read ${relativePath}:`, error);
  }
  return defaultValue;
}

// Helper to write files - uses GitHub on Vercel, filesystem locally
async function writeFiles(files: { path: string; content: string }[], commitMessage: string): Promise<{ success: boolean; error?: string; deployed?: boolean }> {
  console.log(`writeFiles called - IS_VERCEL: ${IS_VERCEL}, VERCEL env: ${process.env.VERCEL}, VERCEL_URL: ${process.env.VERCEL_URL}`);

  if (IS_VERCEL) {
    // On Vercel: commit to GitHub, which triggers auto-deploy
    console.log('Using GitHub commit method for Vercel');
    if (!isGitHubConfigured()) {
      return { success: false, error: 'GITHUB_TOKEN not configured on Vercel' };
    }
    const result = await commitFiles(files, commitMessage);
    if (result.success) {
      return { success: true, deployed: true };
    }
    return { success: false, error: result.error };
  } else {
    console.log('Using filesystem write method for local development');
    // Local development: write directly to filesystem
    try {
      for (const file of files) {
        const fullPath = path.join(process.cwd(), file.path);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, file.content);
        console.log(`✅ Wrote ${file.path}`);
      }
      return { success: true, deployed: false };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

// Helper function to create URL slug for album index
function createSlug(title: string): string {
  return title.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Helper function to build album index data from albums array
function buildAlbumIndex(albums: any[]): any {
  const index: Record<string, any> = {};

  albums.forEach((album: any, idx: number) => {
    if (!album.title) return;

    const title = album.title;
    const lowerTitle = title.toLowerCase();
    const slug = createSlug(title);
    const simpleSlug = lowerTitle.replace(/\s+/g, '-');
    const baseTitle = lowerTitle.split(/\s*[-–]\s*/)[0];
    const baseSlug = createSlug(baseTitle);

    const indexEntry = {
      title: album.title,
      artist: album.artist,
      coverArt: album.coverArt,
      feedId: album.feedId,
      feedUrl: album.feedUrl,
      index: idx
    };

    index[lowerTitle] = indexEntry;
    index[slug] = indexEntry;
    index[simpleSlug] = indexEntry;
    index[baseSlug] = indexEntry;

    if (album.feedId) {
      index[album.feedId.toLowerCase()] = indexEntry;
    }
  });

  return {
    version: '1.0',
    totalAlbums: albums.length,
    indexedAt: new Date().toISOString(),
    index: index
  };
}

// Helper function to prepare updated album files (returns files to write)
function prepareAlbumFilesForAdd(album: any, feedUrl: string, feedId: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];

  // Prepare album with feed metadata
  const albumWithMeta = {
    ...album,
    feedId,
    feedUrl,
    lastUpdated: new Date().toISOString()
  };

  // Update static-albums.json
  const staticData = readJsonFile<any>(STATIC_ALBUMS_PATH, { albums: [], count: 0 });
  const existingStaticIndex = staticData.albums?.findIndex((a: any) => a.feedUrl === feedUrl);
  if (existingStaticIndex >= 0) {
    staticData.albums[existingStaticIndex] = albumWithMeta;
  } else {
    staticData.albums = staticData.albums || [];
    staticData.albums.push(albumWithMeta);
  }
  staticData.count = staticData.albums.length;
  staticData.timestamp = new Date().toISOString();
  files.push({ path: STATIC_ALBUMS_PATH, content: JSON.stringify(staticData, null, 2) });

  // Update albums-static-cached.json
  const cachedData = readJsonFile<any>(CACHED_ALBUMS_PATH, { albums: [], count: 0 });
  const existingCachedIndex = cachedData.albums?.findIndex((a: any) => a.feedUrl === feedUrl);
  if (existingCachedIndex >= 0) {
    cachedData.albums[existingCachedIndex] = albumWithMeta;
  } else {
    cachedData.albums = cachedData.albums || [];
    cachedData.albums.push(albumWithMeta);
  }
  cachedData.count = cachedData.albums.length;
  cachedData.timestamp = new Date().toISOString();
  files.push({ path: CACHED_ALBUMS_PATH, content: JSON.stringify(cachedData, null, 2) });

  // Rebuild album index
  const indexData = buildAlbumIndex(staticData.albums);
  files.push({ path: ALBUM_INDEX_PATH, content: JSON.stringify(indexData, null, 2) });

  return files;
}

// Helper function to prepare feeds.json update for adding a feed
function prepareFeedsFileForAdd(feed: Omit<Feed, 'addedAt' | 'lastUpdated'>): { path: string; content: string } {
  const feedsData = readJsonFile<FeedsData>(FEEDS_PATH, { feeds: [], lastUpdated: '', version: 1 });
  const newFeed: Feed = {
    ...feed,
    addedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  };
  feedsData.feeds.push(newFeed);
  feedsData.lastUpdated = new Date().toISOString();
  return { path: FEEDS_PATH, content: JSON.stringify(feedsData, null, 2) };
}

// Helper function to prepare feeds.json update for updating a feed
function prepareFeedsFileForUpdate(id: string, updates: Partial<Feed>): { path: string; content: string } {
  const feedsData = readJsonFile<FeedsData>(FEEDS_PATH, { feeds: [], lastUpdated: '', version: 1 });
  const feedIndex = feedsData.feeds.findIndex(feed => feed.id === id);
  if (feedIndex !== -1) {
    feedsData.feeds[feedIndex] = {
      ...feedsData.feeds[feedIndex],
      ...updates,
      lastUpdated: new Date().toISOString()
    };
  }
  feedsData.lastUpdated = new Date().toISOString();
  return { path: FEEDS_PATH, content: JSON.stringify(feedsData, null, 2) };
}

// Helper function to prepare files for removing an album
function prepareAlbumFilesForRemove(feedId: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];

  // Update static-albums.json
  const staticData = readJsonFile<any>(STATIC_ALBUMS_PATH, { albums: [], count: 0 });
  staticData.albums = staticData.albums?.filter((a: any) => a.feedId !== feedId) || [];
  staticData.count = staticData.albums.length;
  staticData.timestamp = new Date().toISOString();
  files.push({ path: STATIC_ALBUMS_PATH, content: JSON.stringify(staticData, null, 2) });

  // Update albums-static-cached.json
  const cachedData = readJsonFile<any>(CACHED_ALBUMS_PATH, { albums: [], count: 0 });
  cachedData.albums = cachedData.albums?.filter((a: any) => a.feedId !== feedId) || [];
  cachedData.count = cachedData.albums.length;
  cachedData.timestamp = new Date().toISOString();
  files.push({ path: CACHED_ALBUMS_PATH, content: JSON.stringify(cachedData, null, 2) });

  // Rebuild album index
  const indexData = buildAlbumIndex(staticData.albums);
  files.push({ path: ALBUM_INDEX_PATH, content: JSON.stringify(indexData, null, 2) });

  return files;
}

// Helper function to prepare feeds.json for removing a feed
function prepareFeedsFileForRemove(id: string): { path: string; content: string } {
  const feedsData = readJsonFile<FeedsData>(FEEDS_PATH, { feeds: [], lastUpdated: '', version: 1 });
  feedsData.feeds = feedsData.feeds.filter(feed => feed.id !== id);
  feedsData.lastUpdated = new Date().toISOString();
  return { path: FEEDS_PATH, content: JSON.stringify(feedsData, null, 2) };
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
    const allFilesToWrite: { path: string; content: string }[] = [];
    const feedsToAdd: Omit<Feed, 'addedAt' | 'lastUpdated'>[] = [];

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

        // Prepare feed data
        feedsToAdd.push({
          id,
          originalUrl: feedUrl,
          type: 'album',
          title: album.title,
          priority,
          status,
          ...(trackFilter && { trackFilter }),
        });

        // Prepare album files
        const albumFiles = prepareAlbumFilesForAdd(album, feedUrl, id);
        // Merge into allFilesToWrite (replace if same path)
        for (const file of albumFiles) {
          const existingIdx = allFilesToWrite.findIndex(f => f.path === file.path);
          if (existingIdx >= 0) {
            allFilesToWrite[existingIdx] = file;
          } else {
            allFilesToWrite.push(file);
          }
        }

        addedFeeds.push({ id, url: feedUrl, title: album.title });
      } catch (error) {
        errors.push({ url: feedUrl, error: String(error) });
      }
    }

    // Prepare feeds.json with all new feeds
    if (feedsToAdd.length > 0) {
      const feedsData = readJsonFile<FeedsData>(FEEDS_PATH, { feeds: [], lastUpdated: '', version: 1 });
      for (const feed of feedsToAdd) {
        feedsData.feeds.push({
          ...feed,
          addedAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString()
        });
      }
      feedsData.lastUpdated = new Date().toISOString();
      allFilesToWrite.push({ path: FEEDS_PATH, content: JSON.stringify(feedsData, null, 2) });
    }

    // Write all files (locally or via GitHub)
    if (allFilesToWrite.length > 0) {
      const titles = addedFeeds.map(f => f.title).join(', ');
      const writeResult = await writeFiles(allFilesToWrite, `Add feed(s): ${titles}`);
      if (!writeResult.success) {
        return NextResponse.json(
          { error: `Failed to write files: ${writeResult.error}` },
          { status: 500 }
        );
      }

      // Clear FeedManager cache since we modified feeds.json
      FeedManager['feedsData'] = null;

      return NextResponse.json({
        success: true,
        added: addedFeeds,
        errors: errors.length > 0 ? errors : undefined,
        deployed: writeResult.deployed,
        message: writeResult.deployed ? 'Changes committed to GitHub. Site will redeploy automatically.' : undefined,
      });
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

// PUT - Reparse existing feed(s)
export async function PUT(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { url, urls } = body;

    console.log('PUT /api/admin/manage-feeds - body:', JSON.stringify(body));

    // Handle single URL or multiple URLs
    const feedUrls = urls || (url ? [url] : []);
    console.log('PUT /api/admin/manage-feeds - feedUrls:', feedUrls);

    if (!feedUrls || feedUrls.length === 0) {
      return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
    }

    const reparsedFeeds = [];
    const errors = [];
    const allFilesToWrite: { path: string; content: string }[] = [];

    // Load current feeds.json for updates
    const feedsData = readJsonFile<FeedsData>(FEEDS_PATH, { feeds: [], lastUpdated: '', version: 1 });

    for (const feedUrl of feedUrls) {
      console.log(`PUT /api/admin/manage-feeds - processing: "${feedUrl}"`);
      try {
        // Validate URL
        new URL(feedUrl);

        // Re-parse feed to get updated album data
        const album = await RSSParser.parseAlbumFeed(feedUrl);
        if (!album) {
          throw new Error('Failed to parse feed');
        }

        // Generate ID from URL
        const id = generateIdFromUrl(feedUrl);

        // Check if feed already exists in feeds.json
        const existingFeedIndex = feedsData.feeds.findIndex(f => f.id === id);

        if (existingFeedIndex >= 0) {
          // Update existing feed's lastUpdated timestamp and title
          feedsData.feeds[existingFeedIndex] = {
            ...feedsData.feeds[existingFeedIndex],
            title: album.title,
            lastUpdated: new Date().toISOString()
          };
        } else {
          // Add new feed to feeds.json so it shows in Current Feeds
          feedsData.feeds.push({
            id,
            originalUrl: feedUrl,
            type: 'album',
            title: album.title,
            priority: 'extended',
            status: 'active',
            addedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
          });
        }

        // Prepare album files
        const albumFiles = prepareAlbumFilesForAdd(album, feedUrl, id);
        // Merge into allFilesToWrite (replace if same path)
        for (const file of albumFiles) {
          const existingIdx = allFilesToWrite.findIndex(f => f.path === file.path);
          if (existingIdx >= 0) {
            allFilesToWrite[existingIdx] = file;
          } else {
            allFilesToWrite.push(file);
          }
        }

        reparsedFeeds.push({ id, url: feedUrl, title: album.title });
      } catch (error) {
        errors.push({ url: feedUrl, error: String(error) });
      }
    }

    // Add feeds.json to files to write
    feedsData.lastUpdated = new Date().toISOString();
    allFilesToWrite.push({ path: FEEDS_PATH, content: JSON.stringify(feedsData, null, 2) });

    // Write all files (locally or via GitHub)
    if (allFilesToWrite.length > 0) {
      const titles = reparsedFeeds.map(f => f.title).join(', ');
      const writeResult = await writeFiles(allFilesToWrite, `Update static data with reparsed ${titles.length > 50 ? titles.substring(0, 50) + '...' : titles} feed`);
      if (!writeResult.success) {
        return NextResponse.json(
          { error: `Failed to write files: ${writeResult.error}` },
          { status: 500 }
        );
      }

      // Clear FeedManager cache since we modified feeds.json
      FeedManager['feedsData'] = null;

      return NextResponse.json({
        success: true,
        reparsed: reparsedFeeds,
        errors: errors.length > 0 ? errors : undefined,
        deployed: writeResult.deployed,
        message: writeResult.deployed ? 'Changes committed to GitHub. Site will redeploy automatically.' : undefined,
      });
    }

    return NextResponse.json({
      success: true,
      reparsed: reparsedFeeds,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error reparsing feed:', error);
    return NextResponse.json(
      { error: 'Failed to reparse feed: ' + String(error) },
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

    // Prepare all files for removal
    const allFilesToWrite: { path: string; content: string }[] = [];

    // Prepare feeds.json without this feed
    const feedsFile = prepareFeedsFileForRemove(id);
    allFilesToWrite.push(feedsFile);

    // Prepare album files without this feed
    const albumFiles = prepareAlbumFilesForRemove(id);
    allFilesToWrite.push(...albumFiles);

    // Write all files
    const writeResult = await writeFiles(allFilesToWrite, `Remove feed: ${id}`);
    if (!writeResult.success) {
      return NextResponse.json(
        { error: `Failed to write files: ${writeResult.error}` },
        { status: 500 }
      );
    }

    // Clear FeedManager cache since we modified feeds.json
    FeedManager['feedsData'] = null;

    return NextResponse.json({
      success: true,
      deployed: writeResult.deployed,
      message: writeResult.deployed ? 'Changes committed to GitHub. Site will redeploy automatically.' : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to remove feed' },
      { status: 500 }
    );
  }
}
