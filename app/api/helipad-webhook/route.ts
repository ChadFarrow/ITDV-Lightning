import { NextRequest, NextResponse } from 'next/server';
import { getBoostToNostrService, type TrackMetadata } from '@/lib/boost-to-nostr-service';
import { addHelipadBoost } from '@/lib/helipad-storage';
import crypto from 'crypto';

// Helipad webhook payload interface
interface HelipadBoostPayload {
  index?: number;
  uuid?: string;
  value_msat?: number;
  value_msat_total?: number;
  action?: number;
  sender?: string;
  app?: string;
  message?: string;
  podcast?: string;
  episode?: string;
  time?: number;
  remote_podcast?: string;
  remote_episode?: string;
  tlv?: string;
  reply_sent?: boolean;
  custom_key?: string | null;
  custom_value?: string | null;
  payment_info?: any;
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
    title: boost.episode || boost.podcast || 'Unknown Episode',
    artist: boost.podcast || 'Unknown Podcast',
    album: boost.podcast || 'Unknown Album',
    url: `https://zaps.podtards.com/album/${encodeURIComponent(boost.podcast || '')}`,
    imageUrl: undefined,
    timestamp: boost.time || Math.floor(Date.now() / 1000),
    senderName: boost.sender || 'Helipad User',
    guid: boost.uuid,
    podcastGuid: boost.uuid,
    feedGuid: undefined,
    feedUrl: undefined,
    publisherGuid: undefined,
    publisherUrl: undefined,
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
    const mappedBoostData: HelipadBoostPayload = {
      index: boostData.index,
      uuid: boostData.uuid,
      value_msat: boostData.value_msat,
      value_msat_total: boostData.value_msat_total,
      action: boostData.action,
      sender: boostData.sender,
      app: boostData.app,
      message: boostData.message,
      podcast: boostData.podcast,
      episode: boostData.episode,
      time: boostData.time,
      remote_podcast: boostData.remote_podcast,
      remote_episode: boostData.remote_episode,
      tlv: boostData.tlv,
      reply_sent: boostData.reply_sent,
      custom_key: boostData.custom_key,
      custom_value: boostData.custom_value,
      payment_info: boostData.payment_info
    };

    console.log('📊 Helipad boost data (mapped):', {
      id: mappedBoostData.index || mappedBoostData.uuid,
      amount: mappedBoostData.value_msat,
      sender: mappedBoostData.sender,
      podcast: mappedBoostData.podcast,
      episode: mappedBoostData.episode,
      message: mappedBoostData.message,
      app: mappedBoostData.app
    });
    
    // Validate required fields
    if ((!mappedBoostData.index && !mappedBoostData.uuid) || !mappedBoostData.value_msat) {
      console.error('❌ Missing required fields in boost data');
      return NextResponse.json(
        { error: 'Missing required fields: id or amount' },
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
      const storedBoostData: StoredHelipadBoost = {
        ...mappedBoostData,
        platform: 'helipad' as const,
        timestamp: Date.now(),
        storedAt: new Date().toISOString()
      };
      addHelipadBoost(storedBoostData);
      
      return NextResponse.json({
        success: true,
        message: 'Boost received and stored (no Nostr posting due to missing keys)',
        boostId: mappedBoostData.index || mappedBoostData.uuid,
        amount: mappedBoostData.value_msat
      });
    }
    
    // Post the boost to Nostr
    console.log('🚀 Posting Helipad boost to Nostr...');
    const boostResult = await boostService.postBoost({
      amount: mappedBoostData.value_msat,
      track: trackMetadata,
      comment: mappedBoostData.message,
      tags: ['#helipad', '#boost', '#podcast']
    });
    
    if (boostResult.success) {
      console.log('✅ Helipad boost posted to Nostr successfully:', boostResult.eventId);
      
      // Store the boost data for display purposes
      const storedBoostData: StoredHelipadBoost = {
        ...mappedBoostData,
        platform: 'helipad' as const,
        timestamp: Date.now(),
        storedAt: new Date().toISOString(),
        nostrEventId: boostResult.eventId,
        nevent: boostResult.nevent
      };
      addHelipadBoost(storedBoostData);
      
      return NextResponse.json({
        success: true,
        message: 'Boost posted to Nostr successfully',
        nostrEventId: boostResult.eventId,
        nevent: boostResult.nevent,
        boostId: mappedBoostData.index || mappedBoostData.uuid,
        amount: mappedBoostData.value_msat
      });
    } else {
      console.error('❌ Failed to post boost to Nostr:', boostResult.error);
      
      // Store the boost data even if Nostr posting failed
      const storedBoostData: StoredHelipadBoost = {
        ...mappedBoostData,
        platform: 'helipad' as const,
        timestamp: Date.now(),
        storedAt: new Date().toISOString(),
        nostrError: boostResult.error
      };
      addHelipadBoost(storedBoostData);
      
      // Still return success for the webhook, but log the error
      return NextResponse.json({
        success: true,
        message: 'Boost received but failed to post to Nostr',
        error: boostResult.error,
        boostId: mappedBoostData.index || mappedBoostData.uuid,
        amount: mappedBoostData.value_msat
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
