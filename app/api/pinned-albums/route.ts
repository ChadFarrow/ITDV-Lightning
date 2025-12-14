import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const PINNED_ALBUMS_FILE = path.join(process.cwd(), 'data', 'pinned-albums.json');

// Default pinned items as fallback
const DEFAULT_PINNED_ALBUMS = [
  "Disco Swag - The Album",
  "Bloodshot Lies - The Album",
  "Music From The Doerfel-Verse",
  "Autumn Rust",
  "Ben Doerfel",
  "Jam with Nate",
  "Beware of Banjo"
];

const DEFAULT_PINNED_EPS = [
  "Think EP",
  "Think EP LIVE!"
];

// GET - Get pinned albums and EPs (public, read-only)
export async function GET() {
  try {
    const data = fs.readFileSync(PINNED_ALBUMS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return NextResponse.json({
      pinnedAlbums: parsed.pinnedAlbums || DEFAULT_PINNED_ALBUMS,
      pinnedEPs: parsed.pinnedEPs || DEFAULT_PINNED_EPS,
    });
  } catch {
    // Return defaults if file doesn't exist or can't be read
    return NextResponse.json({
      pinnedAlbums: DEFAULT_PINNED_ALBUMS,
      pinnedEPs: DEFAULT_PINNED_EPS,
    });
  }
}
