import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const OPTIMIZED_DIR = path.join(process.cwd(), 'data', 'optimized-images');

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

/**
 * Resolve a caller-supplied filename to a path inside OPTIMIZED_DIR, or null if
 * it escapes.
 *
 * Next.js hands `[filename]` over already percent-decoded, so a request for
 * `..%2F..%2F.env.local` arrives here as the literal `../../.env.local` — which
 * `path.join` will happily resolve outside the directory. Reject separators and
 * `..` outright, then re-check containment on the resolved path so a symlink or
 * an encoding we did not anticipate cannot get through either.
 */
function resolveSafePath(filename: string): string | null {
  if (!filename) return null;

  // No traversal, no separators, no NUL, no dotfiles.
  if (
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0') ||
    filename.startsWith('.')
  ) {
    return null;
  }

  // Only ever serve known image extensions from this endpoint.
  const ext = path.extname(filename).toLowerCase();
  if (!(ext in CONTENT_TYPES)) return null;

  const resolved = path.resolve(OPTIMIZED_DIR, filename);
  if (resolved !== path.join(OPTIMIZED_DIR, filename)) return null;
  if (!resolved.startsWith(OPTIMIZED_DIR + path.sep)) return null;

  return resolved;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    const filePath = resolveSafePath(filename);

    // Same 404 for "escaped the directory" and "not there", so this endpoint
    // can't be used to probe which paths exist on the filesystem.
    if (!filePath || !fs.existsSync(filePath)) {
      return NextResponse.json(
        { success: false, error: 'Optimized image not found' },
        { status: 404 }
      );
    }

    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return NextResponse.json(
        { success: false, error: 'Optimized image not found' },
        { status: 404 }
      );
    }

    const fileBuffer = fs.readFileSync(filePath);
    const contentType = CONTENT_TYPES[path.extname(filename).toLowerCase()];

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Content-Length', fileBuffer.length.toString());
    headers.set('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year, immutable
    headers.set('ETag', `"${stats.mtime.getTime()}"`);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD');
    headers.set('X-Optimized-By', 're.podtards.com');
    headers.set('Vary', 'Accept-Encoding');

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('Error serving optimized image:', error);
    // Don't echo the error message — it leaks filesystem paths.
    return NextResponse.json(
      { success: false, error: 'Failed to serve image' },
      { status: 500 }
    );
  }
}
