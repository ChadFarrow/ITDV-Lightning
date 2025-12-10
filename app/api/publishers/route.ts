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
    // Get albums data
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ||
                   (process.env.NODE_ENV === 'production'
                     ? 'https://itdv-site.vercel.app'
                     : 'http://localhost:3002');

    const response = await fetch(`${baseUrl}/api/albums`, {
      next: { revalidate: 60 }, // Cache for 1 minute
    });

    if (!response.ok) {
      console.error('Failed to fetch albums:', response.status);
      return NextResponse.json(
        { error: 'Failed to fetch albums data' },
        { status: 500 }
      );
    }

    const data = await response.json();
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