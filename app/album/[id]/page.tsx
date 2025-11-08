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
    // Normalize the album ID to match URL format
    const normalizedId = albumId
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');

    // Load from static cache for fast SSR
    const fs = require('fs');
    const path = require('path');
    const staticPath = path.join(process.cwd(), 'public', 'static-albums.json');

    if (fs.existsSync(staticPath)) {
      const data = JSON.parse(fs.readFileSync(staticPath, 'utf-8'));

      // Find album by matching normalized title
      const album = data.albums?.find((a: any) => {
        const albumSlug = a.title
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-+|-+$/g, '');
        return albumSlug === normalizedId;
      });

      if (album) {
        console.log(`✅ SSR: Found album "${album.title}" in static cache`);
        return album;
      }
    }

    console.log('⚠️ Album not found in static cache, will load client-side');
    return null;
  } catch (error) {
    console.error('❌ Error loading album data for SSR:', error);
    return null;
  }
}

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const albumData = await getAlbumData(id);
  const albumTitle = decodeURIComponent(id).replace(/-/g, ' ');

  return <AlbumDetailClient albumTitle={albumTitle} initialAlbum={albumData} />;
}