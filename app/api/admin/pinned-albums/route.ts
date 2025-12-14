import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/admin-auth';
import fs from 'fs';
import path from 'path';

const PINNED_ALBUMS_FILE = path.join(process.cwd(), 'data', 'pinned-albums.json');

// Helper function to verify authentication
function verifyAuth(request: NextRequest): boolean {
  const token = request.cookies.get('admin-token')?.value;
  return validateSession(token);
}

// Helper function to read pinned data
function readPinnedData(): { pinnedAlbums: string[]; pinnedEPs: string[]; lastUpdated: string } {
  try {
    const data = fs.readFileSync(PINNED_ALBUMS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { pinnedAlbums: [], pinnedEPs: [], lastUpdated: new Date().toISOString() };
  }
}

// Helper function to write pinned data
function writePinnedData(pinnedAlbums: string[], pinnedEPs: string[]): void {
  const data = {
    pinnedAlbums,
    pinnedEPs,
    lastUpdated: new Date().toISOString(),
  };
  fs.writeFileSync(PINNED_ALBUMS_FILE, JSON.stringify(data, null, 2));
}

// GET - Get pinned albums and EPs (authenticated)
export async function GET(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = readPinnedData();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to read pinned data' },
      { status: 500 }
    );
  }
}

// POST - Update pinned albums and EPs (authenticated)
export async function POST(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { pinnedAlbums, pinnedEPs } = body;

    if (!Array.isArray(pinnedAlbums) || !Array.isArray(pinnedEPs)) {
      return NextResponse.json(
        { error: 'pinnedAlbums and pinnedEPs must be arrays' },
        { status: 400 }
      );
    }

    // Validate all items are strings
    if (!pinnedAlbums.every(item => typeof item === 'string') ||
        !pinnedEPs.every(item => typeof item === 'string')) {
      return NextResponse.json(
        { error: 'All items must be strings' },
        { status: 400 }
      );
    }

    writePinnedData(pinnedAlbums, pinnedEPs);

    return NextResponse.json({
      success: true,
      pinnedAlbums,
      pinnedEPs,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error updating pinned data:', error);
    return NextResponse.json(
      { error: 'Failed to update pinned data: ' + String(error) },
      { status: 500 }
    );
  }
}
