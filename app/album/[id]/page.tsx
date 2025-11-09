import { Metadata } from 'next';
import AlbumDetailClient from './AlbumDetailClient';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const albumTitle = decodeURIComponent(id).replace(/-/g, ' ');
  
  return {
      title: `${albumTitle} | Into the Doerfel-Verse`,
  description: `Listen to ${albumTitle} on Into the Doerfel-Verse`,
  };
}

async function getAlbumData(albumId: string) {
  try {
    // Helper function to create URL slug (same as API route)
    const createSlug = (title: string) =>
      title.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

    // Normalize the album ID to match URL format
    const normalizedId = albumId.toLowerCase();

    // Albums that should have video URLs
    const albumsWithVideo = [
      'the-satellite-spotlight',
      'satellite-spotlight',
      'satellite-spotlight-sprouting-symphonies-citybeach-tracks'
    ];

    // Try both static cache files (prioritize cached version)
    const fs = require('fs');
    const path = require('path');
    
    const staticFiles = [
      path.join(process.cwd(), 'public', 'albums-static-cached.json'),
      path.join(process.cwd(), 'public', 'static-albums.json')
    ];

    for (const staticPath of staticFiles) {
      if (fs.existsSync(staticPath)) {
        const data = JSON.parse(fs.readFileSync(staticPath, 'utf-8'));
        const albums = data.albums || [];

        // Find album using flexible matching (same as API route)
        const album = albums.find((a: any) => {
          if (!a.title) return false;
          
          const titleMatch = a.title.toLowerCase() === normalizedId;
          const slugMatch = createSlug(a.title) === normalizedId;
          const compatMatch = a.title.toLowerCase().replace(/\s+/g, '-') === normalizedId;
          
          // Flexible matching: check if the album title starts with the decoded ID
          const baseTitle = a.title.toLowerCase().split(/\s*[-–]\s*/)[0] || '';
          const baseTitleSlug = createSlug(baseTitle);
          const flexibleMatch = baseTitleSlug === normalizedId;

          return titleMatch || slugMatch || compatMatch || flexibleMatch;
        });

        if (album) {
          // Return album immediately - don't block SSR on video fetch
          // Videos will be loaded client-side if missing (handled in AlbumDetailClient)
          return album;
        }
      }
    }

    // Album not found in static cache, will load client-side
    return null;
  } catch (error) {
    // Silently handle errors - client-side will handle loading
    return null;
  }
}

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const albumData = await getAlbumData(id);
  const albumTitle = decodeURIComponent(id).replace(/-/g, ' ');

  return <AlbumDetailClient albumTitle={albumTitle} initialAlbum={albumData} />;
}