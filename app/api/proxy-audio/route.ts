import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  let audioUrl = searchParams.get('url');

  if (!audioUrl) {
    return NextResponse.json({ error: 'Audio URL parameter required' }, { status: 400 });
  }

  try {
    // If the URL is already proxied, extract the actual URL
    if (audioUrl.includes('/api/proxy-audio')) {
      try {
        const proxiedUrl = new URL(audioUrl, 'http://localhost');
        audioUrl = proxiedUrl.searchParams.get('url') || audioUrl;
        if (!audioUrl || audioUrl === proxiedUrl.href) {
          const match = audioUrl.match(/url=([^&]+)/);
          if (match) {
            audioUrl = decodeURIComponent(match[1]);
          }
        }
      } catch (e) {
        const match = audioUrl.match(/url=([^&]+)/);
        if (match) {
          audioUrl = decodeURIComponent(match[1]);
        } else {
          return NextResponse.json({ error: 'Invalid proxied URL format' }, { status: 400 });
        }
      }
    }
    
    // Validate URL
    let url: URL;
    try {
      url = new URL(audioUrl);
    } catch (e) {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }
    
    // Only allow HTTPS URLs for security
    if (url.protocol !== 'https:') {
      return NextResponse.json({ error: 'Only HTTPS URLs are allowed' }, { status: 400 });
    }

    // Get the Range header for partial content requests (streaming)
    const rangeHeader = request.headers.get('range');
    
    // Fetch the audio file
    const fetchOptions: RequestInit = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PodtardsAudioProxy/1.0)',
        'Accept': 'audio/*',
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
    };

    // Add Range header if present (for seeking/streaming)
    if (rangeHeader) {
      fetchOptions.headers = {
        ...fetchOptions.headers,
        'Range': rangeHeader,
      };
    }

    const response = await fetch(audioUrl, fetchOptions);

    if (!response.ok) {
      return NextResponse.json({ 
        error: `Failed to fetch audio: ${response.status} ${response.statusText}` 
      }, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const contentLength = response.headers.get('content-length');
    const contentRange = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges') || 'bytes';

    // Create response with proper headers for audio streaming
    const proxyResponse = new NextResponse(response.body, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600', // 1 hour
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': 'Range, Accept',
        'Accept-Ranges': acceptRanges,
      },
    });

    // Copy relevant headers from original response
    if (contentLength) {
      proxyResponse.headers.set('Content-Length', contentLength);
    }
    
    if (contentRange) {
      proxyResponse.headers.set('Content-Range', contentRange);
    }

    return proxyResponse;

  } catch (error) {
    console.error('❌ Audio proxy error:', error, 'URL:', audioUrl);
    return NextResponse.json({ 
      error: 'Failed to proxy audio file',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Handle OPTIONS requests for CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Accept',
      'Access-Control-Max-Age': '86400',
    },
  });
}

