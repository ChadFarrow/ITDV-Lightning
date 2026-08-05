import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedRequest } from '@/lib/admin-auth';
import { commitFiles, isGitHubConfigured } from '@/lib/github';
import fs from 'fs';
import path from 'path';

const PINNED_ALBUMS_PATH = 'data/pinned-albums.json';
const PINNED_ALBUMS_FILE = path.join(process.cwd(), PINNED_ALBUMS_PATH);

// On Vercel the project filesystem is read-only — writes must go through a
// GitHub commit so the next auto-deploy ships the new file.
const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_URL);

// Helper function to verify authentication

// Helper function to read pinned data
function readPinnedData(): { pinnedAlbums: string[]; pinnedEPs: string[]; lastUpdated: string } {
  try {
    const data = fs.readFileSync(PINNED_ALBUMS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { pinnedAlbums: [], pinnedEPs: [], lastUpdated: new Date().toISOString() };
  }
}

// Helper function to write pinned data — Vercel-aware (mirrors manage-feeds writeFiles).
async function writePinnedData(
  pinnedAlbums: string[],
  pinnedEPs: string[]
): Promise<{ success: boolean; error?: string; deployed?: boolean }> {
  const data = {
    pinnedAlbums,
    pinnedEPs,
    lastUpdated: new Date().toISOString(),
  };
  const content = JSON.stringify(data, null, 2);

  if (IS_VERCEL) {
    if (!isGitHubConfigured()) {
      return { success: false, error: 'GITHUB_TOKEN not configured on Vercel' };
    }
    const result = await commitFiles(
      [{ path: PINNED_ALBUMS_PATH, content }],
      'Update pinned albums order via admin UI'
    );
    if (result.success) {
      return { success: true, deployed: true };
    }
    return { success: false, error: result.error };
  }

  try {
    fs.writeFileSync(PINNED_ALBUMS_FILE, content);
    return { success: true, deployed: false };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// GET - Get pinned albums and EPs (authenticated)
export async function GET(request: NextRequest) {
  if (!(await isAuthenticatedRequest(request))) {
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
  if (!(await isAuthenticatedRequest(request))) {
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

    const result = await writePinnedData(pinnedAlbums, pinnedEPs);
    if (!result.success) {
      console.error('Error updating pinned data:', result.error);
      return NextResponse.json(
        { error: 'Failed to update pinned data: ' + (result.error ?? 'unknown error') },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      pinnedAlbums,
      pinnedEPs,
      lastUpdated: new Date().toISOString(),
      deployed: result.deployed,
    });
  } catch (error) {
    console.error('Error updating pinned data:', error);
    return NextResponse.json(
      { error: 'Failed to update pinned data: ' + String(error) },
      { status: 500 }
    );
  }
}
