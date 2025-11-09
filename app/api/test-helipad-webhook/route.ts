import { NextRequest, NextResponse } from 'next/server';

// Test endpoint to simulate Helipad webhook payloads
export async function POST(request: NextRequest) {
  try {
    console.log('🧪 Test webhook endpoint called');
    
    const body = await request.text();
    let testData;
    
    try {
      testData = JSON.parse(body);
    } catch (error) {
      // If no JSON provided, create a sample test payload
      testData = {
        id: `test-${Date.now()}`,
        amount: 1000,
        message: 'Test boost from Helipad!',
        sender: {
          name: 'Test User',
          npub: 'npub1test123456789'
        },
        podcast: {
          title: 'Test Podcast',
          artist: 'Test Artist',
          album: 'Test Album',
          episode: 'Test Episode',
          guid: 'test-episode-guid',
          feedGuid: 'test-feed-guid',
          publisherGuid: 'test-publisher-guid',
          feedUrl: 'https://example.com/feed.xml',
          publisherUrl: 'https://example.com',
          imageUrl: 'https://example.com/image.jpg'
        },
        timestamp: Math.floor(Date.now() / 1000),
        platform: 'helipad',
        boostType: 'test'
      };
    }
    
    console.log('📊 Test payload:', testData);
    
    // Forward to the actual webhook endpoint
    const webhookUrl = `${request.nextUrl.origin}/api/helipad-webhook`;
    
    // Get auth token from environment or use test token
    const authToken = process.env.HELIPAD_AUTH_TOKEN || 'test-auth-token';
    
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'x-helipad-signature': 'test-signature' // This will be ignored if no secret is configured
        },
        body: JSON.stringify(testData)
      });
      
      const result = await response.json();
      
      return NextResponse.json({
        success: true,
        message: 'Test webhook processed',
        testData,
        webhookResult: result
      });
    } catch (webhookError) {
      console.error('Webhook forwarding failed:', webhookError);
      return NextResponse.json({
        success: false,
        message: 'Test webhook failed',
        error: webhookError instanceof Error ? webhookError.message : 'Unknown error',
        testData
      });
    }
    
  } catch (error) {
    console.error('❌ Test webhook error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: 'Helipad webhook test endpoint',
    usage: 'POST a JSON payload to test the webhook, or POST empty to use sample data',
    samplePayload: {
      id: 'test-123',
      amount: 1000,
      message: 'Test boost message',
      sender: {
        name: 'Test User',
        npub: 'npub1test123456789'
      },
      podcast: {
        title: 'Test Podcast',
        artist: 'Test Artist',
        episode: 'Test Episode',
        guid: 'test-episode-guid'
      },
      timestamp: Math.floor(Date.now() / 1000)
    },
    timestamp: new Date().toISOString()
  });
}
