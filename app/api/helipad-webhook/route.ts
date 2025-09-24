import { NextRequest, NextResponse } from 'next/server';
import { getBoostToNostrService, type TrackMetadata } from '@/lib/boost-to-nostr-service';
import crypto from 'crypto';

// Helipad webhook payload interface
interface HelipadBoostPayload {
  id: string;
  amount: number; // Amount in sats
  message?: string;
  sender?: {
    name?: string;
    pubkey?: string;
    npub?: string;
  };
  recipient?: {
    name?: string;
    pubkey?: string;
    npub?: string;
  };
  podcast?: {
    title?: string;
    artist?: string;
    album?: string;
    episode?: string;
    guid?: string;
    feedGuid?: string;
    publisherGuid?: string;
    feedUrl?: string;
    publisherUrl?: string;
    imageUrl?: string;
  };
  timestamp: number;
  // Additional Helipad-specific fields
  platform?: string;
  boostType?: string;
  metadata?: Record<string, any>;
}

// Verify webhook signature
function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    // Compare signatures (constant-time comparison)
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
}

// Verify Authorization token
function verifyAuthToken(authHeader: string | null, expectedToken: string): boolean {
  if (!authHeader || !expectedToken) {
    return false;
  }
  
  try {
    // Support both "Bearer token" and "token" formats
    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;
    
    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(token, 'utf8'),
      Buffer.from(expectedToken, 'utf8')
    );
  } catch (error) {
    console.error('Error verifying auth token:', error);
    return false;
  }
}

// Convert Helipad boost to TrackMetadata format
function convertHelipadBoostToTrackMetadata(boost: HelipadBoostPayload): TrackMetadata {
  return {
    title: boost.podcast?.episode || boost.podcast?.title,
    artist: boost.podcast?.artist,
    album: boost.podcast?.album || boost.podcast?.title,
    url: `https://zaps.podtards.com/album/${encodeURIComponent(boost.podcast?.album || '')}`,
    imageUrl: boost.podcast?.imageUrl,
    timestamp: Math.floor(Date.now() / 1000), // Current timestamp
    senderName: boost.sender?.name || 'Helipad User',
    guid: boost.podcast?.guid,
    podcastGuid: boost.podcast?.guid,
    feedGuid: boost.podcast?.feedGuid,
    feedUrl: boost.podcast?.feedUrl,
    publisherGuid: boost.podcast?.publisherGuid,
    publisherUrl: boost.podcast?.publisherUrl,
  };
}

export async function POST(request: NextRequest) {
  try {
    console.log('🎯 Helipad webhook received');
    
    // Get the raw body for signature verification
    const body = await request.text();
    const signature = request.headers.get('x-helipad-signature') || 
                     request.headers.get('x-signature') || 
                     request.headers.get('signature');
    const authHeader = request.headers.get('authorization');
    
    // Verify Authorization token if configured
    const authToken = process.env.HELIPAD_AUTH_TOKEN;
    if (authToken) {
      const isValidAuth = verifyAuthToken(authHeader, authToken);
      if (!isValidAuth) {
        console.error('❌ Invalid authorization token');
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      console.log('✅ Authorization token verified');
    } else {
      console.warn('⚠️ No authorization token configured');
    }
    
    // Verify webhook signature if secret is configured
    const webhookSecret = process.env.HELIPAD_WEBHOOK_SECRET;
    if (webhookSecret && signature) {
      const isValid = verifyWebhookSignature(body, signature, webhookSecret);
      if (!isValid) {
        console.error('❌ Invalid webhook signature');
        return NextResponse.json(
          { error: 'Invalid signature' },
          { status: 401 }
        );
      }
      console.log('✅ Webhook signature verified');
    } else {
      console.warn('⚠️ No webhook secret configured or signature missing');
    }
    
    // Parse the payload
    let boostData: HelipadBoostPayload;
    try {
      boostData = JSON.parse(body);
      console.log('🔍 Raw payload from Helipad:', JSON.stringify(boostData, null, 2));
    } catch (error) {
      console.error('❌ Failed to parse webhook payload:', error);
      console.error('🔍 Raw body that failed to parse:', body);
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }
    
    // Map Helipad fields to our expected format
    const mappedBoostData = {
      id: boostData.index?.toString() || boostData.uuid || `helipad-${Date.now()}`,
      amount: boostData.value_msat || 0,
      sender: boostData.sender ? { name: boostData.sender } : undefined,
      podcast: boostData.podcast ? { title: boostData.podcast } : undefined,
      episode: boostData.episode ? { title: boostData.episode } : undefined,
      message: boostData.message,
      app: boostData.app,
      time: boostData.time,
      value_msat_total: boostData.value_msat_total,
      action: boostData.action,
      remote_podcast: boostData.remote_podcast,
      remote_episode: boostData.remote_episode
    };

    console.log('📊 Helipad boost data (mapped):', {
      id: mappedBoostData.id,
      amount: mappedBoostData.amount,
      sender: mappedBoostData.sender?.name,
      podcast: mappedBoostData.podcast?.title,
      episode: mappedBoostData.episode?.title,
      message: mappedBoostData.message,
      app: mappedBoostData.app
    });
    
    // Validate required fields
    if (!mappedBoostData.id || !mappedBoostData.amount) {
      console.error('❌ Missing required fields in boost data');
      return NextResponse.json(
        { error: 'Missing required fields: id, amount' },
        { status: 400 }
      );
    }
    
    // Convert to TrackMetadata format
    const trackMetadata = convertHelipadBoostToTrackMetadata(mappedBoostData);
    
    // Get the boost service
    const boostService = getBoostToNostrService();
    
    // Check if we have keys configured for posting boosts
    if (!boostService.hasKeys()) {
      console.warn('⚠️ No Nostr keys configured - boost will be stored but not posted to Nostr');
      
      // Store the boost data for later processing or display
      // You could save this to a database or cache here
      return NextResponse.json({
        success: true,
        message: 'Boost received and stored (no Nostr posting due to missing keys)',
        boostId: boostData.id,
        amount: boostData.amount
      });
    }
    
    // Post the boost to Nostr
    console.log('🚀 Posting Helipad boost to Nostr...');
    const boostResult = await boostService.postBoost({
      amount: boostData.amount,
      track: trackMetadata,
      comment: boostData.message,
      tags: ['#helipad', '#boost', '#podcast']
    });
    
    if (boostResult.success) {
      console.log('✅ Helipad boost posted to Nostr successfully:', boostResult.eventId);
      
      // You could also store this in a database for additional tracking
      // await storeBoostInDatabase(boostData, boostResult);
      
      return NextResponse.json({
        success: true,
        message: 'Boost posted to Nostr successfully',
        nostrEventId: boostResult.eventId,
        nevent: boostResult.nevent,
        boostId: boostData.id,
        amount: boostData.amount
      });
    } else {
      console.error('❌ Failed to post boost to Nostr:', boostResult.error);
      
      // Still return success for the webhook, but log the error
      return NextResponse.json({
        success: true,
        message: 'Boost received but failed to post to Nostr',
        error: boostResult.error,
        boostId: boostData.id,
        amount: boostData.amount
      });
    }
    
  } catch (error) {
    console.error('❌ Helipad webhook error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Handle GET requests for webhook verification or health checks
export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: 'Helipad webhook endpoint is active',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
}
