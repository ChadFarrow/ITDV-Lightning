import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const FEEDS_FILE = path.join(process.cwd(), 'data', 'feeds.json');

export async function GET() {
  try {
    const data = fs.readFileSync(FEEDS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return NextResponse.json({
      feeds: parsed.feeds || [],
    });
  } catch {
    return NextResponse.json({
      feeds: [],
    });
  }
}