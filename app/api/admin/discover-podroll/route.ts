import { NextRequest, NextResponse } from 'next/server';
import { RSSParser } from '@/lib/rss-parser';
import { getAllFeeds, addFeed } from '@/lib/db';
import { validateSession } from '@/lib/admin-auth';

// Helper function to verify authentication
function verifyAuth(request: NextRequest): boolean {
  const token = request.cookies.get('admin-token')?.value;
  return validateSession(token);
}

interface PodrollItem {
  url: string;
  title?: string;
  description?: string;
}

interface DiscoveredFeed {
  url: string;
  title: string;
  artist: string;
  hasAlbum: boolean;
  trackCount: number;
  podrollCount: number;
  alreadyExists: boolean;
  source: 'podroll' | 'recursive';
  discoveredFrom: string;
  error?: string;
}

// Helper to normalize URLs for comparison
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slashes and normalize protocol
    return parsed.href.replace(/\/$/, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

// Generate feed ID from URL
function generateFeedId(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = [
      parsed.hostname.replace(/\./g, '-'),
      ...parsed.pathname.split('/').filter(p => p)
    ];
    return parts.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  } catch {
    return url.replace(/[^a-z0-9-]/g, '-').toLowerCase();
  }
}

export async function POST(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { url, recursive = true, depth = 2, autoAdd = false } = body;

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const discovered: DiscoveredFeed[] = [];
    const processed = new Set<string>();
    const queue: { url: string; currentDepth: number; discoveredFrom: string }[] = [{ url, currentDepth: 0, discoveredFrom: url }];

    // Get existing feeds for comparison
    const existingFeeds = await getAllFeeds();
    const existingUrls = new Set(
      existingFeeds.map(f => normalizeUrl(f.original_url))
    );

    while (queue.length > 0) {
      const { url: currentUrl, currentDepth, discoveredFrom } = queue.shift()!;
      const normalizedUrl = normalizeUrl(currentUrl);

      // Skip if already processed
      if (processed.has(normalizedUrl)) continue;
      processed.add(normalizedUrl);

      try {
        console.log(`🔍 Discovering feed: ${currentUrl} (depth: ${currentDepth})`);
        
        // Parse the feed
        const albumData = await RSSParser.parseAlbumFeed(currentUrl);
        
        if (!albumData) {
          discovered.push({
            url: currentUrl,
            title: 'Unknown',
            artist: 'Unknown',
            hasAlbum: false,
            trackCount: 0,
            podrollCount: 0,
            alreadyExists: existingUrls.has(normalizedUrl),
            source: currentDepth === 1 ? 'podroll' : 'recursive',
            discoveredFrom,
            error: 'Failed to parse feed'
          });
          continue;
        }

        const feedInfo: DiscoveredFeed = {
          url: currentUrl,
          title: albumData.title || 'Unknown',
          artist: albumData.artist || 'Unknown',
          hasAlbum: true,
          trackCount: albumData.tracks?.length || 0,
          podrollCount: albumData.podroll?.length || 0,
          alreadyExists: existingUrls.has(normalizedUrl),
          source: currentDepth === 1 ? 'podroll' : 'recursive',
          discoveredFrom
        };

        discovered.push(feedInfo);

        // If recursive and not at max depth, add podroll items to queue
        if (recursive && currentDepth < depth && albumData.podroll) {
          for (const podrollItem of albumData.podroll) {
            if (podrollItem.url && !processed.has(normalizeUrl(podrollItem.url))) {
              queue.push({ 
                url: podrollItem.url, 
                currentDepth: currentDepth + 1,
                discoveredFrom: currentDepth === 0 ? url : discoveredFrom
              });
            }
          }
        }

      } catch (error) {
        console.error(`Error discovering feed ${currentUrl}:`, error);
        discovered.push({
          url: currentUrl,
          title: 'Unknown',
          artist: 'Unknown',
          hasAlbum: false,
          trackCount: 0,
          podrollCount: 0,
          alreadyExists: existingUrls.has(normalizedUrl),
          source: currentDepth === 1 ? 'podroll' : 'recursive',
          discoveredFrom,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Automatically add new feeds if requested
    const added: string[] = [];

    if (autoAdd) {
      for (const feed of discovered) {
        if (!feed.alreadyExists && feed.hasAlbum && !feed.error) {
          try {
            const result = await addFeed(
              feed.url,
              'album',
              `${feed.title} by ${feed.artist}`,
              {
                priority: 'extended',
                source: feed.source,
                discoveredFrom: feed.discoveredFrom
              }
            );
            
            if (result.success) {
              added.push(feed.url);
              console.log(`✅ Added feed: ${feed.title} by ${feed.artist}`);
            } else {
              console.error(`Failed to add feed ${feed.url}: ${result.error}`);
            }
          } catch (error) {
            console.error(`Failed to add feed ${feed.url}:`, error);
          }
        }
      }
    }

    return NextResponse.json({
      discovered,
      stats: {
        total: discovered.length,
        new: discovered.filter(d => !d.alreadyExists && d.hasAlbum).length,
        existing: discovered.filter(d => d.alreadyExists).length,
        errors: discovered.filter(d => d.error).length,
        added: added.length
      },
      added
    });

  } catch (error) {
    console.error('Error in discover-podroll:', error);
    return NextResponse.json(
      { error: 'Failed to discover podroll feeds' },
      { status: 500 }
    );
  }
}

// GET endpoint to check discovery status
export async function GET(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const feeds = await getAllFeeds();
    const stats = {
      total: feeds.length,
      byType: {
        album: feeds.filter(f => f.type === 'album').length,
        publisher: feeds.filter(f => f.type === 'publisher').length
      },
      byPriority: {
        core: feeds.filter(f => f.priority === 'core').length,
        extended: feeds.filter(f => f.priority === 'extended').length,
        low: feeds.filter(f => f.priority === 'low').length
      }
    };

    return NextResponse.json({ feeds, stats });
  } catch (error) {
    console.error('Error in GET /api/admin/discover-podroll:', error);
    return NextResponse.json(
      { error: 'Failed to fetch feeds' },
      { status: 500 }
    );
  }
}