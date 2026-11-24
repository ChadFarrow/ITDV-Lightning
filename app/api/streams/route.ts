import { NextRequest, NextResponse } from 'next/server';
import { getStreamSummary, StoreUnavailableError } from '@/lib/helipad-storage';

// The /boosts Streams tab: one row per listener and episode, newest first. Public, like the boost
// list. The rows come from Helipad records that TJ's Helipad and BoostBot send to the webhook.
export const dynamic = 'force-dynamic';

function intParam(value: string | null, fallback: number): number {
  const n = parseInt(value || '', 10);
  return isFinite(n) ? n : fallback;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = Math.min(100, Math.max(1, intParam(params.get('limit'), 50)));
  const offset = Math.max(0, intParam(params.get('offset'), 0));
  try {
    const rows = await getStreamSummary({ limit, offset, nowSeconds: Math.floor(Date.now() / 1000) });
    return NextResponse.json({ success: true, rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof StoreUnavailableError) {
      return NextResponse.json({ success: false, error: 'store unavailable' }, { status: 503 });
    }
    throw error;
  }
}
