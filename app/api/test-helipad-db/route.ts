import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET() {
  try {
    const results: any = {
      postgres_url_configured: !!process.env.POSTGRES_URL,
      postgres_url_length: process.env.POSTGRES_URL?.length || 0,
      tests: []
    };

    // Test 1: Basic connection
    try {
      const connectionTest = await sql`SELECT NOW() as current_time, 1 as test`;
      results.tests.push({
        name: 'Database Connection',
        success: true,
        message: 'Connection successful',
        timestamp: connectionTest.rows[0]?.current_time
      });
    } catch (error) {
      results.tests.push({
        name: 'Database Connection',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return NextResponse.json(results, { status: 500 });
    }

    // Test 2: Check if table exists
    try {
      const tableCheck = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'helipad_boosts'
        ) as table_exists
      `;
      const tableExists = tableCheck.rows[0]?.table_exists;
      results.tests.push({
        name: 'Table Exists',
        success: true,
        table_exists: tableExists
      });

      // Test 3: Get table info if it exists
      if (tableExists) {
        const tableInfo = await sql`
          SELECT 
            COUNT(*) as row_count,
            MAX(timestamp) as latest_timestamp,
            MIN(timestamp) as earliest_timestamp
          FROM helipad_boosts
        `;
        results.tests.push({
          name: 'Table Data',
          success: true,
          row_count: parseInt(tableInfo.rows[0]?.row_count || '0', 10),
          latest_timestamp: tableInfo.rows[0]?.latest_timestamp,
          earliest_timestamp: tableInfo.rows[0]?.earliest_timestamp
        });

        // Test 4: Get sample rows
        const sampleRows = await sql`
          SELECT 
            id, boost_index, boost_uuid, value_msat, 
            podcast, episode, message, timestamp
          FROM helipad_boosts
          ORDER BY timestamp DESC
          LIMIT 5
        `;
        results.tests.push({
          name: 'Sample Rows',
          success: true,
          count: sampleRows.rows.length,
          rows: sampleRows.rows
        });
      }
    } catch (error) {
      results.tests.push({
        name: 'Table Check',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      postgres_url_configured: !!process.env.POSTGRES_URL
    }, { status: 500 });
  }
}

