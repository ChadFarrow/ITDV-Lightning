import { NextRequest, NextResponse } from 'next/server';
import { getHelipadBoosts, clearHelipadBoosts, getHelipadBoostsCount } from '@/lib/helipad-storage';

// GET endpoint to retrieve stored Helipad boosts
export async function GET(request: NextRequest) {
  try {
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50');
    
    // Return the most recent boosts
    const recentBoosts = getHelipadBoosts(limit);
    
    return NextResponse.json({
      success: true,
      boosts: recentBoosts,
      count: recentBoosts.length,
      total: getHelipadBoostsCount()
    });
  } catch (error) {
    console.error('Error retrieving Helipad boosts:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve boosts' },
      { status: 500 }
    );
  }
}

// DELETE endpoint to clear all stored Helipad boosts
export async function DELETE() {
  try {
    clearHelipadBoosts();
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
