/**
 * Utility functions for Lightning payments
 */

interface PaymentRecipient {
  address: string;
  split: number;
  name?: string;
  fee?: boolean;
  type?: string;
  fixedAmount?: number;
}

interface BoostMetadata {
  title?: string;
  artist?: string;
  album?: string;
  imageUrl?: string;
  podcastFeedGuid?: string;
  podcastGuid?: string;
  episode?: string;
  feedUrl?: string;
  itemGuid?: string;
  timestamp?: number;
  senderName?: string;
  appName?: string;
  url?: string;
  publisherGuid?: string;
  publisherUrl?: string;
  message?: string;
}

/**
 * Create TLV records for Lightning boost payments (matching manual boost format)
 */
function createBoostTLVRecords(metadata: BoostMetadata, recipientName?: string, amount?: number) {
  const tlvRecords = [];

  // Use the same format as manual boosts from BitcoinConnect component
  // 7629169 - Podcast metadata JSON (bLIP-10 standard - Breez/Fountain compatible)
  const podcastMetadata = {
    podcast: metadata.artist || 'Unknown Artist',
    episode: metadata.title || 'Unknown Title',
    action: 'boost',
    app_name: metadata.appName || 'ITDV App',
    // Use actual feed URL from metadata, fallback to main podcast feed
    feed: metadata.feedUrl || 'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml',
    url: metadata.feedUrl || 'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml',
    message: metadata.message || '',
    ...(metadata.timestamp && { ts: metadata.timestamp }),
    // Use proper feedId (lowercase 'd') for Helipad compatibility - it expects feedId not feedID
    feedId: metadata.feedUrl === 'https://www.doerfelverse.com/feeds/bloodshot-lies-album.xml' ? "6590183" : "6590182",
    // Add Helipad-specific GUID fields
    ...(metadata.itemGuid && { episode_guid: metadata.itemGuid }),
    ...(metadata.itemGuid && { remote_item_guid: metadata.itemGuid }),
    ...(metadata.podcastFeedGuid && { remote_feed_guid: metadata.podcastFeedGuid }),
    ...(metadata.album && { album: metadata.album }),
    ...(amount && { value_msat_total: amount * 1000 }),
    sender_name: metadata.senderName || 'Anonymous',
    uuid: `boost-${Date.now()}-${Math.floor(Math.random() * 1000)}`, // Unique identifier
    app_version: '1.0.0', // App version
    ...(amount && { value_msat: amount * 1000 }), // Individual payment amount
    name: recipientName || 'ITDV App' // Recipient name for split payments, app name for single payments
  };
  
  tlvRecords.push({
    type: 7629169,
    value: Buffer.from(JSON.stringify(podcastMetadata), 'utf8').toString('hex')
  });
  
  // 7629171 - Tip note/message (Lightning spec compliant) - only if custom message provided
  if (metadata.message) {
    tlvRecords.push({
      type: 7629171,
      value: Buffer.from(metadata.message, 'utf8').toString('hex')
    });
  }
  
  // 133773310 - Sphinx compatibility (JSON encoded data)
  const sphinxData = {
    podcast: metadata.artist || 'Unknown Artist',
    episode: metadata.title || 'Unknown Title', 
    action: 'boost',
    app: metadata.appName || 'ITDV App',
    message: metadata.message || '',
    ...(amount && { amount: amount }),
    sender: metadata.senderName || 'Anonymous',
    ...(metadata.timestamp && { timestamp: metadata.timestamp })
  };
  
  tlvRecords.push({
    type: 133773310,
    value: Buffer.from(JSON.stringify(sphinxData), 'utf8').toString('hex')
  });

  return tlvRecords;
}

/**
 * Create simplified TLV records for WebLN auto boost (smaller, more compatible)
 */
function createSimpleWebLNTLVRecords(metadata: BoostMetadata, recipientName?: string, amount?: number) {
  const customRecords: Record<number, string> = {};

  // Simple boost message (7629171 - Lightning spec compliant)
  const message = `Auto boost: ${metadata.title || 'Unknown Track'} by ${metadata.artist || 'Unknown Artist'}`;
  customRecords[7629171] = Buffer.from(message, 'utf8').toString('hex');

  // Minimal podcast metadata (7629169 - bLIP-10 standard)
  const podcastMetadata = {
    podcast: metadata.artist || 'Unknown Artist',
    episode: metadata.title || 'Unknown Title',
    action: 'boost',
    app_name: 'ITDV App',
    message: '',
    ...(amount && { value_msat: amount * 1000 }),
    sender_name: 'Auto Boost'
  };
  
  customRecords[7629169] = Buffer.from(JSON.stringify(podcastMetadata), 'utf8').toString('hex');

  return customRecords;
}

/**
 * Make a Lightning payment using WebLN for auto boost
 */
export async function makeAutoBoostPayment({
  amount,
  description,
  recipients,
  fallbackRecipient,
  boostMetadata,
}: {
  amount: number;
  description: string;
  recipients?: PaymentRecipient[];
  fallbackRecipient: string;
  boostMetadata?: BoostMetadata;
}): Promise<{ success: boolean; results?: any[]; error?: string }> {
  try {
    // Check connection state
    const weblnExists = !!(window as any).webln;
    const weblnEnabled = weblnExists && !!(window as any).webln?.enabled;

    // Auto boost requires WebLN wallet connection
    if (!weblnExists) {
      return {
        success: false,
        error: 'Auto boost requires a WebLN wallet connection. Please connect your wallet to enable auto boost.'
      };
    }

    // Determine payments to make
    let paymentsToMake: PaymentRecipient[] = [];

    if (recipients && recipients.length > 0) {
      paymentsToMake = recipients.filter(r => r.address && (r.split > 0 || r.fixedAmount));
    }

    // Fallback to single recipient if no valid recipients
    if (paymentsToMake.length === 0) {
      paymentsToMake = [{
        address: fallbackRecipient,
        split: 100,
        name: 'Default',
        type: 'node'
      }];
    }

    const totalSplit = paymentsToMake.reduce((sum, r) => sum + r.split, 0);
    const results: any[] = [];

    // Use WebLN for payments
    if (weblnExists) {
      const webln = (window as any).webln;

      // Ensure WebLN is enabled
      if (!weblnEnabled) {
        await webln.enable();
      }

      // Check if we can use keysend (for node addresses)
      const hasKeysend = typeof webln.keysend === 'function';
      
      if (hasKeysend) {
        const paymentPromises = paymentsToMake.map(async (recipientData) => {
          const recipientAmount = (recipientData as any).fixedAmount || Math.floor((amount * recipientData.split) / totalSplit);
          
          // Create TLV records for boost metadata - use simplified version for WebLN
          const customRecords = boostMetadata ? createSimpleWebLNTLVRecords(boostMetadata, recipientData.name, recipientAmount) : {};
          
          const response = await webln.keysend({
            destination: recipientData.address,
            amount: recipientAmount,
            customRecords
          });
          
          return { recipient: recipientData.name || recipientData.address, amount: recipientAmount, response };
        });

        const paymentResults = await Promise.allSettled(paymentPromises);
        
        paymentResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            const recipientName = paymentsToMake[index].name || paymentsToMake[index].address;
            console.error(`❌ WebLN auto boost payment failed to ${recipientName}:`, result.reason);
          }
        });

        if (results.length > 0) {
          return { success: true, results };
        } else {
          throw new Error('All WebLN auto boost payments failed');
        }
      } else {
        throw new Error('Keysend not available for auto boost payments');
      }
    } else {
      throw new Error('No payment method available for auto boost');
    }

  } catch (error) {
    console.error('Auto boost payment failed:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Auto boost payment failed'
    };
  }
}