import { NextRequest, NextResponse } from 'next/server';
import {
  validateProxyTarget,
  fetchProxyTarget,
  forwardableLength,
  isAllowedMediaType,
  MEDIA_LIMITS,
} from '@/lib/proxy-guard';

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
    
    // Rejects non-HTTPS targets and private addresses as written. The fetch
    // below checks again after DNS and on every redirect (op3.dev tracks
    // redirect to their host).
    const target = validateProxyTarget(audioUrl);
    if (!target.ok) {
      return NextResponse.json({ error: target.error }, { status: target.status });
    }

    // Get the Range header for partial content requests (streaming)
    const rangeHeader = request.headers.get('range');
    
    // fetchProxyTarget adds the User-Agent.
    const upstreamHeaders: Record<string, string> = {
      'Accept': 'audio/*',
    };

    // Add Range header if present (for seeking/streaming)
    if (rangeHeader) {
      upstreamHeaders['Range'] = rangeHeader;
    }

    // Fetch the validated URL through the shared guard: 30 s over connection,
    // redirects and body, and a size limit per response.
    const fetched = await fetchProxyTarget(target.url, MEDIA_LIMITS.audio, {
      headers: upstreamHeaders,
    });
    if (!fetched.ok) {
      return NextResponse.json({ error: fetched.error }, { status: fetched.status });
    }
    const response = fetched.response;

    if (!response.ok) {
      await fetched.body?.cancel().catch(() => {});
      return NextResponse.json({ 
        error: `Failed to fetch audio: ${response.status} ${response.statusText}` 
      }, { status: response.status });
    }

    const upstreamContentType = response.headers.get('content-type');

    // Served from our own origin, so refuse anything a browser would execute.
    // octet-stream is allowed because many podcast hosts serve MP3s that way,
    // and video/* because m4a/mp4 audio is routinely labelled as video.
    if (
      !isAllowedMediaType(upstreamContentType, ['audio/', 'video/', 'application/ogg'], {
        allowOctetStream: true,
      })
    ) {
      await fetched.body?.cancel().catch(() => {});
      return NextResponse.json(
        { error: 'Upstream response is not an audio file' },
        { status: 415 }
      );
    }

    const contentType = upstreamContentType || 'audio/mpeg';
    const contentLength = forwardableLength(response);
    const contentRange = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges') || 'bytes';

    // Create response with proper headers for audio streaming. The body is
    // counted on the way through and stops at the size limit.
    const proxyResponse = new NextResponse(fetched.body, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600', // 1 hour
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': 'Range, Accept',
        'Accept-Ranges': acceptRanges,
        'X-Content-Type-Options': 'nosniff',
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
    // Fetch failures are answered above. Do not echo the message: it can name
    // the upstream host.
    console.error('❌ Audio proxy error:', error, 'URL:', audioUrl);
    return NextResponse.json({ error: 'Failed to proxy audio file' }, { status: 500 });
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

