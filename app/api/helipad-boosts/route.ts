import { NextRequest, NextResponse } from 'next/server';
import { getHelipadBoosts, clearHelipadBoosts, getHelipadBoostsCount } from '@/lib/helipad-storage';

// GET endpoint to retrieve stored Helipad boosts
export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Helipad boosts API called');
    console.log('🔍 POSTGRES_URL configured:', !!process.env.POSTGRES_URL);
    console.log('🔍 POSTGRES_URL length:', process.env.POSTGRES_URL?.length || 0);
    
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50');
    console.log(`🔍 Fetching ${limit} boosts...`);
    
    // Return the most recent boosts
    const recentBoosts = await getHelipadBoosts(limit);
    const total = await getHelipadBoostsCount();
    
    console.log(`✅ Returning ${recentBoosts.length} boosts (total: ${total})`);
    console.log('🔍 First boost sample:', recentBoosts[0] ? JSON.stringify(recentBoosts[0]).substring(0, 200) : 'none');
    
    return NextResponse.json({
      success: true,
      boosts: recentBoosts,
      count: recentBoosts.length,
      total: total,
      debug: {
        postgres_url_configured: !!process.env.POSTGRES_URL,
        postgres_url_length: process.env.POSTGRES_URL?.length || 0
      }
    });
  } catch (error) {
    console.error('❌ Error retrieving Helipad boosts:', error);
    if (error instanceof Error) {
      console.error('❌ Error message:', error.message);
      console.error('❌ Error stack:', error.stack);
    }
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to retrieve boosts',
        message: error instanceof Error ? error.message : 'Unknown error',
        postgres_url_configured: !!process.env.POSTGRES_URL,
        postgres_url_length: process.env.POSTGRES_URL?.length || 0
      },
      { status: 500 }
    );
  }
}

// DELETE endpoint to clear all stored Helipad boosts
export async function DELETE() {
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
