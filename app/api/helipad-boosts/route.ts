import { NextRequest, NextResponse } from 'next/server';

// In-memory storage for Helipad boosts (in production, use a database)
let helipadBoosts: any[] = [];

// Add a boost to storage
export function addHelipadBoost(boostData: any) {
  helipadBoosts.unshift(boostData); // Add to beginning for newest first
  // Keep only last 100 boosts to prevent memory issues
  if (helipadBoosts.length > 100) {
    helipadBoosts = helipadBoosts.slice(0, 100);
  }
}

// GET endpoint to retrieve stored Helipad boosts
export async function GET(request: NextRequest) {
  try {
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50');
    
    // Return the most recent boosts
    const recentBoosts = helipadBoosts.slice(0, limit);
    
    return NextResponse.json({
      success: true,
      boosts: recentBoosts,
      count: recentBoosts.length,
      total: helipadBoosts.length
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
    helipadBoosts = [];
    console.log('🗑️ Cleared all Helipad boosts from storage');
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
