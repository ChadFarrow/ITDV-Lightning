import { NextRequest, NextResponse } from 'next/server';

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
    
    // Validate URL
    let url: URL;
    try {
      url = new URL(actualVideoUrl);
    } catch (e) {
      console.error('❌ Invalid URL format:', actualVideoUrl, e);
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }
    
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
        // Fetch the HTML page
        const htmlResponse = await fetch(videoUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; VideoProxy/1.0)',
          }
        });
        
        if (htmlResponse.ok) {
          const html = await htmlResponse.text();
          
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
                  const testResponse = await fetch(testUrl, { method: 'HEAD' });
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
    const fetchHeaders: HeadersInit = {
      'User-Agent': 'DoerfelVerse/1.0 (Video Proxy)',
      'Accept': 'application/vnd.apple.mpegurl, video/*, */*',
      'Origin': 'https://re.podtards.com',
      'Referer': 'https://re.podtards.com/',
    };
    
    if (rangeHeader) {
      fetchHeaders['Range'] = rangeHeader;
    }
    
    let response: Response;
    try {
      response = await fetch(videoUrl, {
        headers: fetchHeaders,
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });
    } catch (fetchError) {
      console.error('❌ Video fetch error:', fetchError, 'URL:', videoUrl);
      return NextResponse.json({ 
        error: 'Failed to fetch video file',
        details: fetchError instanceof Error ? fetchError.message : 'Unknown fetch error'
      }, { status: 500 });
    }

    if (!response.ok) {
      console.error(`❌ Video fetch failed: ${response.status} ${response.statusText} for ${videoUrl}`);
      return NextResponse.json({ 
        error: 'Failed to fetch video file',
        status: response.status 
      }, { status: response.status });
    }

    // Determine content type - use response header if available, otherwise infer from URL
    let contentType = response.headers.get('Content-Type');
    
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
    if (videoUrl.includes('.m3u8')) {
      contentType = 'application/vnd.apple.mpegurl';
      
      // For HLS manifests, rewrite relative URLs to absolute proxied URLs
      const manifestText = await response.text();
      const baseUrl = new URL(videoUrl);
      const basePath = baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1);
      
      // Get the request origin to create absolute proxied URLs
      const requestUrl = new URL(request.url);
      const origin = requestUrl.origin;
      
      // Track if this is a master playlist (contains variant playlists) or media playlist (contains segments)
      const isMasterPlaylist = manifestText.includes('#EXT-X-STREAM-INF') || manifestText.includes('#EXT-X-MEDIA');
      
      // Rewrite URLs in the manifest (lines that aren't comments and contain URLs)
      const rewrittenManifest = manifestText.split('\n').map(line => {
        const trimmedLine = line.trim();
        
        // Skip empty lines
        if (!trimmedLine) {
          return line;
        }
        
        // Skip if already proxied (absolute or relative)
        if (trimmedLine.includes('/api/proxy-video')) {
          return line;
        }
        
        // Handle URLs inside EXT-X-MEDIA tags (URI="...") - these are typically alternate audio tracks
        if (trimmedLine.includes('URI=')) {
          return line.replace(/URI="([^"]+)"/g, (match, url) => {
            if (url.includes('/api/proxy-video')) {
              return match; // Already proxied
            }
            let absoluteUrl: string;
            if (url.startsWith('http://') || url.startsWith('https://')) {
              absoluteUrl = url;
            } else {
              // Relative URL, convert to absolute
              try {
                absoluteUrl = new URL(url, baseUrl.origin + basePath).href;
              } catch (e) {
                return match; // If parsing fails, return original
              }
            }
            // Proxy audio track manifests and all segment URLs
            return `URI="${origin}/api/proxy-video?url=${encodeURIComponent(absoluteUrl)}"`;
          });
        }
        
        // Skip comment lines (but not EXT-X tags that might contain URLs)
        if (trimmedLine.startsWith('#') && !trimmedLine.includes('URI=')) {
          return line;
        }
        
        // This line should be a URL (standalone segment URL or variant playlist URL)
        // Check if it looks like a URL (contains .m3u8, .ts, or starts with http)
        // Also check for fragment patterns like stream_*.ts or segment_*.ts
        if (trimmedLine.includes('.m3u8') || trimmedLine.includes('.ts') || 
            trimmedLine.startsWith('http://') || trimmedLine.startsWith('https://') ||
            trimmedLine.startsWith('stream_') || trimmedLine.match(/^[a-f0-9]+\.ts$/i) ||
            trimmedLine.match(/^segment_\d+\.ts$/i) || trimmedLine.match(/^seg_\d+\.ts$/i)) {
          let segmentUrl = trimmedLine;
          
          // If it's already an absolute URL, proxy it with absolute URL
          if (segmentUrl.startsWith('http://') || segmentUrl.startsWith('https://')) {
            return `${origin}/api/proxy-video?url=${encodeURIComponent(segmentUrl)}`;
          }
          // If it's a relative URL, convert to absolute and proxy
          try {
            const absoluteUrl = new URL(segmentUrl, baseUrl.origin + basePath).href;
            return `${origin}/api/proxy-video?url=${encodeURIComponent(absoluteUrl)}`;
          } catch (e) {
            console.warn(`⚠️ Failed to parse segment URL: ${segmentUrl}`, e);
            // If URL parsing fails, return original line
            return line;
          }
        }
        
        // Return original line if it doesn't match any pattern
        return line;
      }).join('\n');
      
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
        },
      });
      
      console.log(`✅ HLS manifest rewritten with proxied segment URLs`);
      return proxyResponse;
    }
    
    const contentLength = response.headers.get('Content-Length');
    
    // Create response with proper headers for video streaming (non-manifest files)
    const proxyResponse = new NextResponse(response.body, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600', // 1 hour for video
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': 'Range, Accept',
        'Accept-Ranges': 'bytes',
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
    console.error('❌ Video proxy error:', error, 'URL:', videoUrl);
    return NextResponse.json({ 
      error: 'Failed to proxy video file',
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
      'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
      'Access-Control-Max-Age': '86400', // 24 hours
    },
  });
}