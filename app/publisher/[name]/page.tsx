import { Metadata } from 'next';
import PublisherDetailClient from './PublisherDetailClient';

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params;
  const publisherName = decodeURIComponent(name).replace(/-/g, ' ');
  
  return {
    title: `${publisherName} | Into the Doerfel-Verse`,
    description: `View all albums from ${publisherName}`,
  };
}

async function getPublisherData(publisherName: string) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || 
                   (process.env.NODE_ENV === 'production' 
                     ? process.env.NEXT_PUBLIC_SITE_URL || 'https://itdv.podtards.com'
                     : `http://localhost:${process.env.PORT || '3000'}`);
    
    // Use albums endpoint
    const response = await fetch(`${baseUrl}/api/albums`, {
      next: { revalidate: 300 }, // Cache for 5 minutes
    });

    if (!response.ok) {
      console.error('Failed to fetch albums:', response.status);
      return null;
    }

    const data = await response.json();
    const albums = data.albums || [];
    
    // Create slug from publisher name for matching
    const createSlug = (name: string) => 
      name.toLowerCase()
        .replace(/[^\w\s-]/g, '') // Remove punctuation except spaces and hyphens
        .replace(/\s+/g, '-')     // Replace spaces with hyphens
        .replace(/-+/g, '-')      // Collapse multiple hyphens
        .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
    
    const decodedName = decodeURIComponent(publisherName);
    const nameSlug = createSlug(decodedName);
    
    // Find albums by this publisher
    const publisherAlbums = albums.filter((album: any) => {
      // Match by artist name (since publishers are usually artists)
      const artistSlug = createSlug(album.artist);
      const artistLower = album.artist.toLowerCase();
      const decodedLower = decodedName.toLowerCase();
      
      // Exact match or slug match, but exclude if this artist is just featured
      if (artistSlug === nameSlug || artistLower === decodedLower) {
        return true;
      }
      
      // Don't include albums where this artist is just featured (contains "feat." or "featuring")
      return false;
    });

    if (publisherAlbums.length === 0) {
      return null;
    }

    // Get publisher info from first album
    const firstAlbum = publisherAlbums[0];
    // Find an album with publisher data, or use defaults
    const albumWithPublisher = publisherAlbums.find((album: any) => album.publisher) || firstAlbum;
    const publisherInfo = {
      name: firstAlbum.artist,
      guid: albumWithPublisher.publisher?.feedGuid || 'no-guid',
      feedUrl: albumWithPublisher.publisher?.feedUrl || '',
      medium: albumWithPublisher.publisher?.medium || 'music',
      albums: publisherAlbums
    };

    return publisherInfo;
  } catch (error) {
    console.error('Error fetching publisher data:', error);
    return null;
  }
}

export default async function PublisherPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const publisherData = await getPublisherData(name);
  const publisherName = decodeURIComponent(name).replace(/-/g, ' ');

  return <PublisherDetailClient publisherName={publisherName} initialPublisher={publisherData} />;
}