import { Metadata } from 'next';
import AlbumDetailClient from './AlbumDetailClient';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const albumData = await getAlbumData(id);

  // Fallback title if album not found
  const title = albumData?.title || decodeURIComponent(id).replace(/-/g, ' ');
  const description = `Listen to ${title} on Into the Doerfel-Verse`;
  const rawImageUrl = albumData?.coverArt || 'https://itdv.podtards.com/icon-512x512.png';

  // Use og-image endpoint for GIFs to convert to static PNG for link previews
  const imageUrl = rawImageUrl.toLowerCase().endsWith('.gif')
    ? `https://itdv.podtards.com/api/og-image?url=${encodeURIComponent(rawImageUrl)}`
    : rawImageUrl;
  const url = `https://itdv.podtards.com/album/${id}`;

  return {
    title: `${title} | Into the Doerfel-Verse`,
    description,
    openGraph: {
      title: `${title} | Into the Doerfel-Verse`,
      description,
      url,
      siteName: 'Into the Doerfel-Verse',
      images: [
        {
          url: imageUrl,
          alt: title,
        },
      ],
      type: 'music.album',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | Into the Doerfel-Verse`,
      description,
      images: [imageUrl],
    },
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

    const fs = require('fs');
    const path = require('path');
    
    // Use index file for fast lookup (58KB vs 1.2MB)
    const indexPath = path.join(process.cwd(), 'public', 'album-index.json');
    const staticAlbumsPath = path.join(process.cwd(), 'public', 'static-albums.json');
    
    // Try index-based lookup first (much faster)
    if (fs.existsSync(indexPath) && fs.existsSync(staticAlbumsPath)) {
      try {
        const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        const index = indexData.index || {};
        
        // Try multiple lookup keys
        const indexEntry = index[normalizedId] || 
                          index[createSlug(albumId)] ||
                          index[albumId.toLowerCase().replace(/\s+/g, '-')];
        
        if (indexEntry && indexEntry.index !== undefined) {
          // Load static albums and access by index (O(1) lookup)
          const staticData = JSON.parse(fs.readFileSync(staticAlbumsPath, 'utf-8'));
          const albums = staticData.albums || [];
          
          if (albums[indexEntry.index]) {
            return albums[indexEntry.index];
          }
        }
      } catch (error) {
        // Fall through to full search if index lookup fails
      }
    }
    
    // Fallback: full file search (slower but more reliable)
    if (fs.existsSync(staticAlbumsPath)) {
      const data = JSON.parse(fs.readFileSync(staticAlbumsPath, 'utf-8'));
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
        return album;
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