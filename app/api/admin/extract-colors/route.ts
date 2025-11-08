import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/admin-auth';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

// Helper function to verify authentication
function verifyAuth(request: NextRequest): boolean {
  const token = request.cookies.get('admin-token')?.value;
  return validateSession(token);
}

// Extract dominant color from image using sharp
async function extractDominantColor(imageUrl: string): Promise<{
  dominant: string;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  isDark: boolean;
}> {
  try {
    // Fetch the image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Use sharp to get image stats
    const image = sharp(buffer);
    const stats = await image.stats();

    // Extract dominant colors from stats
    const channels = stats.channels;
    const r = Math.round(channels[0].mean);
    const g = Math.round(channels[1].mean);
    const b = Math.round(channels[2].mean);

    const dominant = `${r},${g},${b}`;

    // Calculate if dark or light
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const isDark = luminance < 0.5;

    // Create color palette based on dominant color
    const primary = `rgb(${r}, ${g}, ${b})`;
    const secondary = isDark
      ? `rgb(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)})`
      : `rgb(${Math.max(0, r - 40)}, ${Math.max(0, g - 40)}, ${Math.max(0, b - 40)})`;
    const accent = `rgb(${Math.min(255, r + 60)}, ${Math.min(255, g + 60)}, ${Math.min(255, b + 60)})`;
    const background = isDark ? 'rgb(15, 15, 20)' : 'rgb(240, 240, 245)';
    const text = isDark ? 'rgb(240, 240, 245)' : 'rgb(15, 15, 20)';

    return {
      dominant,
      palette: {
        primary,
        secondary,
        accent,
        background,
        text,
      },
      isDark,
    };
  } catch (error) {
    console.error(`Error extracting colors from ${imageUrl}:`, error);
    // Return default colors
    return {
      dominant: '100,100,100',
      palette: {
        primary: 'rgb(100, 100, 100)',
        secondary: 'rgb(140, 140, 140)',
        accent: 'rgb(160, 160, 160)',
        background: 'rgb(15, 15, 20)',
        text: 'rgb(240, 240, 245)',
      },
      isDark: true,
    };
  }
}

export async function POST(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('🎨 Starting color extraction for all albums...');

    // Load static albums data
    const staticAlbumsPath = path.join(process.cwd(), 'public', 'static-albums.json');
    const staticData = await fs.readFile(staticAlbumsPath, 'utf-8');
    const { albums } = JSON.parse(staticData);

    console.log(`📚 Found ${albums.length} albums to process`);

    // Process albums and extract colors
    const albumsWithColors = [];
    let processed = 0;
    let errors = 0;

    for (const album of albums) {
      try {
        console.log(`🎨 Processing: ${album.title} (${processed + 1}/${albums.length})`);

        // Extract album-level colors
        let albumColors = null;
        if (album.coverArt) {
          albumColors = await extractDominantColor(album.coverArt);
        }

        // Extract track-level colors if tracks have individual artwork
        const tracksWithColors = await Promise.all(
          album.tracks.map(async (track: any) => {
            // If track has unique artwork, extract its colors
            if (track.image && track.image !== album.coverArt) {
              try {
                const trackColors = await extractDominantColor(track.image);
                return {
                  ...track,
                  colors: trackColors,
                };
              } catch (error) {
                console.error(`Failed to extract colors for track ${track.title}:`, error);
                return track;
              }
            }
            // If track uses album artwork, copy album colors to track
            else if (track.image && track.image === album.coverArt && albumColors) {
              return {
                ...track,
                colors: albumColors,
              };
            }
            return track;
          })
        );

        albumsWithColors.push({
          title: album.title,
          artist: album.artist,
          coverArt: album.coverArt,
          colors: albumColors,
          tracks: tracksWithColors,
        });

        processed++;
      } catch (error) {
        console.error(`Error processing album ${album.title}:`, error);
        errors++;
        // Add album without colors
        albumsWithColors.push({
          title: album.title,
          artist: album.artist,
          coverArt: album.coverArt,
          colors: null,
          tracks: album.tracks,
        });
      }
    }

    // Save to albums-with-colors.json
    const colorsDataPath = path.join(process.cwd(), 'data', 'albums-with-colors.json');
    const colorsData = {
      albums: albumsWithColors,
      lastUpdated: new Date().toISOString(),
      version: 1,
    };

    await fs.writeFile(colorsDataPath, JSON.stringify(colorsData, null, 2));

    console.log(`✅ Color extraction complete! Processed: ${processed}, Errors: ${errors}`);

    return NextResponse.json({
      success: true,
      processed,
      errors,
      total: albums.length,
    });
  } catch (error) {
    console.error('Error extracting colors:', error);
    return NextResponse.json(
      { error: 'Failed to extract colors: ' + String(error) },
      { status: 500 }
    );
  }
}
