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
          console.log(`✅ SSR: Found album "${album.title}" in static cache`);
          
          // Check if album should have videos but doesn't
          const shouldHaveVideo = albumsWithVideo.some(videoAlbum => 
            normalizedId.includes(videoAlbum) || 
            createSlug(album.title).includes(videoAlbum) ||
            album.title.toLowerCase().includes('satellite spotlight')
          );
          
          const hasVideoUrls = album.tracks?.some((track: any) => track.videoUrl);
          
          // If album should have videos but doesn't, fetch them from API during SSR
          if (shouldHaveVideo && !hasVideoUrls) {
            console.log(`📺 SSR: Album should have videos but missing from static cache, fetching from API...`);
            try {
              // Construct API URL - use absolute URL for SSR
              // In production/Vercel, use the VERCEL_URL, otherwise use localhost
              const protocol = process.env.VERCEL ? 'https' : 'http';
              const host = process.env.VERCEL_URL || 
                          process.env.NEXT_PUBLIC_BASE_URL?.replace(/^https?:\/\//, '') ||
                          'localhost:3000';
              const baseUrl = `${protocol}://${host}`;
              
              const apiUrl = `${baseUrl}/api/album/${encodeURIComponent(albumId)}?refresh=1`;
              console.log(`📺 SSR: Fetching from ${apiUrl}`);
              
              // Create abort controller with timeout to prevent hanging requests
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
              
              try {
                const response = await fetch(apiUrl, {
                  cache: 'no-store', // Don't cache during SSR
                  signal: controller.signal,
                  headers: {
                    'Accept': 'application/json',
                  }
                });
                
                clearTimeout(timeoutId);
                
                if (response.ok) {
                  const apiData = await response.json();
                  if (apiData.album) {
                    const videoTracks = apiData.album.tracks?.filter((t: any) => t.videoUrl) || [];
                    console.log(`✅ SSR: Fetched album with ${videoTracks.length} video tracks from API`);
                    return apiData.album;
                  }
                } else {
                  console.warn(`⚠️ SSR: Failed to fetch videos from API: ${response.status}`);
                }
              } catch (fetchError: any) {
                clearTimeout(timeoutId);
                // Handle abort errors gracefully (don't log as error)
                if (fetchError.name === 'AbortError' || fetchError.name === 'TimeoutError') {
                  console.log(`ℹ️ SSR: Video fetch aborted or timed out (this is normal during navigation)`);
                } else {
                  console.warn(`⚠️ SSR: Error fetching videos from API:`, fetchError.message || fetchError);
                }
                // Fall through to return album without videos
              }
            } catch (apiError: any) {
              // Handle any other errors gracefully
              if (apiError.name !== 'AbortError') {
                console.warn(`⚠️ SSR: Error fetching videos from API:`, apiError.message || apiError);
              }
              // Fall through to return album without videos
            }
          }
          
          return album;
        }
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