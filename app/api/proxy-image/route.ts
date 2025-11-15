import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');
    
    if (!imageUrl) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing image URL parameter' 
      }, { status: 400 });
    }

    // Validate URL
    let url: URL;
    try {
      url = new URL(imageUrl);
    } catch {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid URL format' 
      }, { status: 400 });
    }

    // Only allow HTTPS URLs for security
    if (url.protocol !== 'https:') {
      return NextResponse.json({ 
        success: false, 
        error: 'Only HTTPS URLs are allowed' 
      }, { status: 400 });
    }

    // Determine timeout based on file type (GIFs may be large and need more time)
    const isGif = imageUrl.toLowerCase().includes('.gif');
    const timeoutMs = isGif ? 30000 : 15000; // 30 seconds for GIFs, 15 seconds for others

    // Check for conditional requests and forward them to upstream server
    const ifNoneMatch = request.headers.get('if-none-match');
    const ifModifiedSince = request.headers.get('if-modified-since');
    
    // Build headers for upstream request
    const upstreamHeaders: HeadersInit = {
      'User-Agent': 'Mozilla/5.0 (compatible; PodtardsImageProxy/1.0)',
      'Accept': 'image/*',
      'Accept-Encoding': 'gzip, deflate, br',
    };
    
    // Forward conditional request headers to upstream server
    if (ifNoneMatch) {
      upstreamHeaders['If-None-Match'] = ifNoneMatch;
    }
    if (ifModifiedSince) {
      upstreamHeaders['If-Modified-Since'] = ifModifiedSince;
    }

    // Fetch the image
    const response = await fetch(imageUrl, {
      headers: upstreamHeaders,
      // Add timeout - longer for GIFs to handle large files
      signal: AbortSignal.timeout(timeoutMs),
    });

    // Handle 304 Not Modified from upstream server
    if (response.status === 304) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': isGif 
            ? 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400'
            : 'public, max-age=3600, s-maxage=86400',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    if (!response.ok) {
      return NextResponse.json({ 
        success: false, 
        error: `Failed to fetch image: ${response.status} ${response.statusText}` 
      }, { status: response.status });
    }

    // Get content type and length from response
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const contentLength = response.headers.get('content-length');
    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');

    // Handle conditional requests - return 304 Not Modified if content hasn't changed
    if (ifNoneMatch && etag && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': isGif 
            ? 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400'
            : 'public, max-age=3600, s-maxage=86400',
        }
      });
    }

    if (ifModifiedSince && lastModified) {
      const ifModifiedSinceDate = new Date(ifModifiedSince);
      const lastModifiedDate = new Date(lastModified);
      if (lastModifiedDate <= ifModifiedSinceDate) {
        return new NextResponse(null, {
          status: 304,
          headers: {
            'Last-Modified': lastModified,
            'Cache-Control': isGif 
              ? 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400'
              : 'public, max-age=3600, s-maxage=86400',
          }
        });
      }
    }

    // Set headers for image serving
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }
    
    // Much longer cache for GIFs (they rarely change) - similar to optimized images
    // For GIFs: 1 week browser cache, 1 month CDN cache
    // For other images: 1 hour browser, 24 hours CDN
    if (isGif) {
      headers.set('Cache-Control', 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400'); // 1 week client, 1 month CDN, 1 day stale-while-revalidate
    } else {
      headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400'); // 1 hour client, 24 hours CDN
    }
    
    // Add ETag and Last-Modified for better cache validation
    if (etag) {
      headers.set('ETag', etag);
    }
    if (lastModified) {
      headers.set('Last-Modified', lastModified);
    }
    
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD');
    headers.set('X-Image-Proxy', 're.podtards.com');
    headers.set('Vary', 'Accept-Encoding');

    // Stream the response instead of buffering - much faster for large files
    // This allows the browser to start rendering the image while it's still downloading
    return new NextResponse(response.body, {
      status: 200,
      headers
    });

  } catch (error) {
    console.error('Image proxy error:', error);
    
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json({ 
        success: false, 
        error: 'Image fetch timeout' 
      }, { status: 408 });
    }

    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

// Handle OPTIONS requests for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}