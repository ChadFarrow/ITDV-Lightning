import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');

    if (!imageUrl) {
      return NextResponse.json({ error: 'Missing URL parameter' }, { status: 400 });
    }

    // Validate URL
    let url: URL;
    try {
      url = new URL(imageUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    // Only allow HTTPS URLs
    if (url.protocol !== 'https:') {
      return NextResponse.json({ error: 'Only HTTPS URLs allowed' }, { status: 400 });
    }

    const isGif = imageUrl.toLowerCase().endsWith('.gif');

    // Fetch the image with timeout
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OGImageProxy/1.0)',
        'Accept': 'image/*',
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: ${response.status}` },
        { status: 502 }
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    let outputBuffer: Buffer;
    let contentType: string;

    if (isGif) {
      // Convert GIF to PNG (extracts first frame)
      outputBuffer = await sharp(buffer, { pages: 1 })
        .png({ quality: 90 })
        .toBuffer();
      contentType = 'image/png';
    } else {
      // Pass through non-GIF images
      outputBuffer = buffer;
      contentType = response.headers.get('content-type') || 'image/jpeg';
    }

    // Return image with aggressive caching for OG crawlers
    return new NextResponse(outputBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': outputBuffer.length.toString(),
        'Cache-Control': 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400', // 1 week browser, 1 month CDN
        'Access-Control-Allow-Origin': '*',
        'X-OG-Image-Proxy': 'itdv.podtards.com',
      },
    });
  } catch (error) {
    console.error('OG image proxy error:', error);

    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json({ error: 'Image fetch timeout' }, { status: 408 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
