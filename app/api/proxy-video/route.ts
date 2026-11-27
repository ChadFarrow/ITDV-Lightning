import { NextRequest, NextResponse } from 'next/server';
import {
  validateProxyTarget,
  fetchProxyTarget,
  forwardableLength,
  isAllowedMediaType,
  readProxyText,
  MEDIA_LIMITS,
} from '@/lib/proxy-guard';
import { rewriteHlsPlaylist } from '@/lib/hls-rewrite';

/**
 * What this route will serve. It is same-origin, so an upstream that answers
 * with HTML (an allowed host can redirect anywhere) must not pass through.
 * Playlists come as application/vnd.apple.mpegurl (or the x- form, or
 * audio/mpegurl), segments as video/* or audio/*.
 */
const VIDEO_MEDIA_TYPES = ['video/', 'audio/', 'application/vnd.apple.mpegurl', 'application/x-mpegurl'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  let videoUrl = searchParams.get('url');

  if (!videoUrl) {
    return NextResponse.json({ error: 'Video URL parameter required' }, { status: 400 });
  }

  try {
    // If the URL is already proxied (contains /api/proxy-video), extract the actual URL
    if (videoUrl.includes('/api/proxy-video')) {
      try {
        const proxiedUrl = new URL(videoUrl, 'http://localhost');
        videoUrl = proxiedUrl.searchParams.get('url') || videoUrl;
        if (!videoUrl || videoUrl === proxiedUrl.href) {
          // Try alternative extraction
          const match = videoUrl.match(/url=([^&]+)/);
          if (match) {
            videoUrl = decodeURIComponent(match[1]);
          }
        }
      } catch (e) {
        // If parsing fails, try to extract URL from the query string
        const match = videoUrl.match(/url=([^&]+)/);
        if (match) {
          videoUrl = decodeURIComponent(match[1]);
        } else {
          console.error('❌ Failed to extract URL from proxied URL:', videoUrl);
          return NextResponse.json({ error: 'Invalid proxied URL format' }, { status: 400 });
        }
      }
    }
    
    // Handle op3.dev proxy URLs - extract the actual video URL
    let actualVideoUrl = videoUrl;
    if (videoUrl.includes('op3.dev/e/')) {
      // op3.dev URLs are in format: https://op3.dev/e/{actual_url}
      // Extract the actual URL after /e/
      const match = videoUrl.match(/op3\.dev\/e\/(.+)/);
      if (match) {
        actualVideoUrl = decodeURIComponent(match[1]);
        console.log(`📺 Extracted URL from op3.dev: ${actualVideoUrl}`);
      }
    }
    
    // Validate URL: HTTPS and a public address as written (the shared guard).
    // The fetches below check again after DNS and on every redirect.
    const target = validateProxyTarget(actualVideoUrl);
    if (!target.ok) {
      return NextResponse.json({ error: target.error }, { status: target.status });
    }
    const url = target.url;
    
    // Allow Cloudflare Stream and SplitKit domains (including through op3.dev)
    const allowedDomains = [
      'customer-dlnbepb8zpz7h846.cloudflarestream.com',
      'www.thesplitkit.com',
      'thesplitkit.com',
      'op3.dev' // Allow op3.dev as it proxies to Cloudflare Stream
    ];
    
    // Check both the original URL (if op3.dev) and the extracted URL
    const originalUrl = new URL(videoUrl);
    const isOp3Dev = originalUrl.hostname === 'op3.dev';
    const isAllowedDomain = allowedDomains.includes(url.hostname) || (isOp3Dev && allowedDomains.includes(url.hostname));
    
    if (!isAllowedDomain) {
      console.error('❌ Domain not allowed:', url.hostname, '(original:', originalUrl.hostname, ')');
      return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 });
    }
    
    // Use the actual video URL for fetching (not the op3.dev wrapper)
    videoUrl = actualVideoUrl;

    // Log for manifests and SplitKit URLs to help debug
    if (videoUrl.includes('.m3u8') || videoUrl.includes('thesplitkit.com') || videoUrl.includes('op3.dev')) {
      console.log(`📺 Proxying ${videoUrl.includes('.m3u8') ? 'manifest' : videoUrl.includes('op3.dev') ? 'op3.dev URL' : 'SplitKit URL'}: ${videoUrl}`);
    }

    // For SplitKit URLs, we need to extract the actual video stream URL from the HTML page
    // SplitKit returns HTML with a video element that loads the stream dynamically
    if (videoUrl.includes('thesplitkit.com') && !videoUrl.includes('.m3u8')) {
      try {
        // Fetch the HTML page (15 s, 2 MB, through the shared guard, which
        // also sets the User-Agent)
        const page = await fetchProxyTarget(videoUrl, MEDIA_LIMITS.page);
        
        if (page.ok && !page.response.ok) {
          await page.body?.cancel().catch(() => {});
        }
        if (page.ok && page.response.ok) {
          const html = await readProxyText(page.body);
          
          // Try to find video source URLs in the HTML
          // Look for common patterns: data-src, src, video-url, etc.
          const videoUrlPatterns = [
            /(?:src|data-src|video-url|videoUrl)="([^"]*\.m3u8[^"]*)"/gi,
            /(?:src|data-src|video-url|videoUrl)='([^']*\.m3u8[^']*)'/gi,
            /https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi,
          ];
          
          for (const pattern of videoUrlPatterns) {
            const matches = html.match(pattern);
            if (matches && matches.length > 0) {
              // Extract the URL from the match
              const extractedUrl = matches[0].replace(/^(?:src|data-src|video-url|videoUrl)=["']?/, '').replace(/["']$/, '');
              if (extractedUrl.includes('.m3u8')) {
                videoUrl = extractedUrl.startsWith('http') ? extractedUrl : new URL(extractedUrl, videoUrl).toString();
                console.log(`✅ Extracted SplitKit video URL from HTML: ${videoUrl}`);
                break;
              }
            }
          }
          
          // If no m3u8 found, try to find the video ID and construct the stream URL
          // SplitKit might use a pattern like /live/{id}/stream.m3u8 or similar
          if (!videoUrl.includes('.m3u8')) {
            const idMatch = videoUrl.match(/\/live\/([^\/]+)/);
            if (idMatch) {
              const streamId = idMatch[1];
              const possibleStreamUrls = [
                `https://www.thesplitkit.com/live/${streamId}/stream.m3u8`,
                `https://www.thesplitkit.com/live/${streamId}/video.m3u8`,
                `https://www.thesplitkit.com/live/${streamId}/manifest.m3u8`,
                `https://www.thesplitkit.com/api/live/${streamId}/stream.m3u8`,
              ];
              
              // Test each URL
              for (const testUrl of possibleStreamUrls) {
                try {
                  const probe = await fetchProxyTarget(testUrl, MEDIA_LIMITS.probe, { method: 'HEAD' });
                  if (!probe.ok) continue;
                  await probe.body?.cancel().catch(() => {});
                  const testResponse = probe.response;
                  if (testResponse.ok && testResponse.headers.get('content-type')?.includes('mpegurl')) {
                    videoUrl = testUrl;
                    console.log(`✅ Found SplitKit stream URL: ${videoUrl}`);
                    break;
                  }
                } catch (e) {
                  // Continue to next URL
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('❌ Error extracting video URL from SplitKit HTML:', e);
        // Continue with original URL - will return HTML which we can't use
      }
    }

    // Fetch the video/manifest file
    // Forward Range header if present (for partial content requests)
    const rangeHeader = request.headers.get('range');
    // fetchProxyTarget adds the User-Agent.
    const fetchHeaders: Record<string, string> = {
      'Accept': 'application/vnd.apple.mpegurl, video/*, */*',
      'Origin': 'https://re.podtards.com',
      'Referer': 'https://re.podtards.com/',
    };
    
    if (rangeHeader) {
      fetchHeaders['Range'] = rangeHeader;
    }
    
    // Through the shared guard: 30 s over connection, redirects and body; a
    // playlist is read whole to rewrite it, so it gets its own 8 MB limit.
    const isPlaylist = videoUrl.includes('.m3u8');
    const fetched = await fetchProxyTarget(
      videoUrl,
      isPlaylist ? MEDIA_LIMITS.playlist : MEDIA_LIMITS.video,
      { headers: fetchHeaders }
    );
    if (!fetched.ok) {
      console.error('❌ Video fetch error:', fetched.error, 'URL:', videoUrl);
      return NextResponse.json({ error: fetched.error }, { status: fetched.status });
    }
    const response = fetched.response;

    if (!response.ok) {
      await fetched.body?.cancel().catch(() => {});
      console.error(`❌ Video fetch failed: ${response.status} ${response.statusText} for ${videoUrl}`);
      return NextResponse.json({ 
        error: 'Failed to fetch video file',
        status: response.status 
      }, { status: response.status });
    }

    // Determine content type - use response header if available, otherwise infer from URL
    let contentType = response.headers.get('Content-Type');

    // Same-origin response: refuse anything a browser would execute or render.
    if (!isAllowedMediaType(contentType, VIDEO_MEDIA_TYPES, { allowOctetStream: true })) {
      await fetched.body?.cancel().catch(() => {});
      return NextResponse.json({ error: 'Upstream response is not a video file' }, { status: 415 });
    }
    
    // If content-type is not set, infer from URL
    if (!contentType) {
      if (videoUrl.includes('.m3u8')) {
        contentType = 'application/vnd.apple.mpegurl';
      } else if (videoUrl.includes('.ts')) {
        contentType = 'video/mp2t'; // MPEG-TS format for HLS fragments
      } else {
        contentType = 'application/vnd.apple.mpegurl'; // Default fallback
      }
    }
    
    // Handle HLS manifest files
    if (isPlaylist) {
      contentType = 'application/vnd.apple.mpegurl';
      
      let manifestText: string;
      try {
        manifestText = await readProxyText(fetched.body);
      } catch {
        return NextResponse.json({ error: 'Upstream playlist too large or too slow' }, { status: 502 });
      }
      // Every link (segments, init segments, keys, variant and rendition
      // playlists) goes back through this route and its guard. Links resolve
      // against the URL of the final response, after any redirect.
      const rewrittenManifest = rewriteHlsPlaylist(manifestText, response.url || videoUrl);
      
      // Create response with rewritten manifest
      const proxyResponse = new NextResponse(rewrittenManifest, {
        status: response.status,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600', // 1 hour for video
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD',
          'Access-Control-Allow-Headers': 'Range, Accept',
          'Accept-Ranges': 'bytes',
          'X-Content-Type-Options': 'nosniff',
        },
      });
      
      console.log(`✅ HLS manifest rewritten with proxied segment URLs`);
      return proxyResponse;
    }
    
    const contentLength = forwardableLength(response);
    
    // Create response with proper headers for video streaming (non-manifest files).
    // The body is counted on the way through and stops at the size limit.
    const proxyResponse = new NextResponse(fetched.body, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600', // 1 hour for video
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': 'Range, Accept',
        'Accept-Ranges': 'bytes',
        'X-Content-Type-Options': 'nosniff',
      },
    });

    // Copy relevant headers from original response
    if (contentLength) {
      proxyResponse.headers.set('Content-Length', contentLength);
    }
    
    const contentRange = response.headers.get('Content-Range');
    if (contentRange) {
      proxyResponse.headers.set('Content-Range', contentRange);
    }

    // Only log for manifests to reduce noise
    if (videoUrl.includes('.m3u8')) {
      console.log(`✅ Video streamed successfully: ${videoUrl} (${contentLength || 'unknown'} bytes)`);
    }
    return proxyResponse;

  } catch (error) {
    // Fetch failures are answered above. Do not echo the message: it can name
    // the upstream host.
    console.error('❌ Video proxy error:', error, 'URL:', videoUrl);
    return NextResponse.json({ error: 'Failed to proxy video file' }, { status: 500 });
  }
}

// Handle OPTIONS requests for CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
      'Access-Control-Max-Age': '86400', // 24 hours
    },
  });
}