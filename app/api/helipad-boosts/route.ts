import { NextRequest, NextResponse } from 'next/server';
import { getHelipadBoosts, clearHelipadBoosts, getHelipadBoostsCount, StoreUnavailableError } from '@/lib/helipad-storage';
import { isAuthenticatedRequest } from '@/lib/admin-auth';

// GET: the newest boosts (streams and auto boosts are on /api/streams). 503 when the store fails,
// so the page can tell "no boosts" from "store down".
export async function GET(request: NextRequest) {
  const requested = parseInt(request.nextUrl.searchParams.get('limit') || '', 10);
  const limit = Math.min(100, Math.max(1, isFinite(requested) ? requested : 50));
  try {
    const recentBoosts = await getHelipadBoosts(limit);
    const total = await getHelipadBoostsCount();
    return NextResponse.json({
      success: true,
      boosts: recentBoosts,
      count: recentBoosts.length,
      total,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof StoreUnavailableError) {
      return NextResponse.json({ success: false, error: 'store unavailable' }, { status: 503 });
    }
    throw error;
  }
}

// DELETE endpoint to clear all stored Helipad boosts. Admin only: this route is outside /api/admin,
// so middleware does not guard it, and until 2026-11-24 anyone could empty the store with one request.
export async function DELETE(request: NextRequest) {
  if (!(await isAuthenticatedRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await clearHelipadBoosts();
    return NextResponse.json({
      success: true,
      message: 'All Helipad boosts cleared from storage',
      total: 0
    });
  } catch (error) {
    console.error('Error clearing Helipad boosts from storage:', error);
    return NextResponse.json(
      { error: 'Failed to clear boosts', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
