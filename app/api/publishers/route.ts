import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface Album {
  title: string;
  artist: string;
  description: string;
  coverArt: string;
  releaseDate: string;
  feedId: string;
  feedUrl?: string;
  publisher?: {
    feedGuid: string;
    feedUrl: string;
    medium: string;
  };
}

interface Publisher {
  name: string;
  guid: string;
  feedUrl: string;
  medium: string;
  albumCount: number;
  firstAlbumCover?: string;
}

export async function GET(request: NextRequest) {
  try {
    // Read the static cache directly rather than HTTP-fetching our own
    // /api/albums. The old code hardcoded a base URL — localhost:3002 in dev
    // (the dev server runs on 3000) and itdv-site.vercel.app in production —
    // so this endpoint returned 500 locally, and every request paid a full
    // network round trip plus a possible cold start to reach the same file
    // this process can just read. /api/publisher/[name] already does it this way.
    const staticAlbumsPath = path.join(process.cwd(), 'public', 'static-albums.json');

    if (!fs.existsSync(staticAlbumsPath)) {
      return NextResponse.json(
        { error: 'Album data not available' },
        { status: 503 }
      );
    }

    const data = JSON.parse(fs.readFileSync(staticAlbumsPath, 'utf-8'));
    const albums: Album[] = data.albums || [];

    // Group albums by publisher
    const publishersMap = new Map<string, Publisher>();

    albums.forEach((album) => {
      if (!album.publisher) return;

      const publisherKey = album.publisher.feedGuid;
      
      if (!publishersMap.has(publisherKey)) {
        publishersMap.set(publisherKey, {
          name: album.artist,
          guid: album.publisher.feedGuid,
          feedUrl: album.publisher.feedUrl,
          medium: album.publisher.medium,
          albumCount: 0,
          firstAlbumCover: album.coverArt
        });
      }

      const publisher = publishersMap.get(publisherKey)!;
      publisher.albumCount++;
    });

    // Convert to array and sort by album count
    const publishers = Array.from(publishersMap.values())
      .sort((a, b) => b.albumCount - a.albumCount);

    return NextResponse.json({
      publishers,
      totalPublishers: publishers.length,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching publishers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch publishers' },
      { status: 500 }
    );
  }
}