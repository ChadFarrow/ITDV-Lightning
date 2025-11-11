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
 * Returns array format compatible with NWC bridge system
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
 * Make a Lightning payment using available payment methods (WebLN, NWC bridge, etc.)
 * This function replicates the payment logic from BitcoinConnect component for auto boost
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
    // Import NWC services dynamically
    const { getNWCService } = await import('@/lib/nwc-service');
    const { getKeysendBridge } = await import('@/lib/nwc-keysend-bridge');
    
    // Check connection state similar to BitcoinConnect
    const weblnExists = !!(window as any).webln;
    const weblnEnabled = weblnExists && !!(window as any).webln?.enabled;
    
    // Check for NWC connection (same logic as BitcoinConnect component)
    let bcConfig = null;
    let bcConnectorType = null;
    let nwcConnectionString = null;
    
    try {
      const bcConfigRaw = localStorage.getItem('bc:config');
      if (bcConfigRaw) {
        bcConfig = JSON.parse(bcConfigRaw);
        bcConnectorType = bcConfig.connectorType;
        nwcConnectionString = bcConfig.nwcUrl;
      }
    } catch (error) {
      // Fallback to individual keys if config is corrupted
      bcConnectorType = localStorage.getItem('bc:connectorType');
    }
    if (!nwcConnectionString) {
      nwcConnectionString = localStorage.getItem('nwc_connection_string');
    }
    
    const hasNWCConnection = !!nwcConnectionString;
    // Use NWC if we have a connection string, regardless of bcConnectorType
    // This matches how manual payments work in BitcoinConnect component
    const shouldUseNWC = hasNWCConnection;

    // CRITICAL: Auto boost should only work with user's wallet, not site wallet
    // If no user wallet is available, fail gracefully instead of using site wallet
    if (!weblnExists && !hasNWCConnection) {
      return { 
        success: false, 
        error: 'Auto boost requires user wallet connection. Please connect your wallet to enable auto boost.' 
      };
    }

    // CRITICAL: Auto boost should only work with wallets that support keysend natively
    // Bridge mode uses site wallet as intermediary, which is not appropriate for auto boost
    if (hasNWCConnection) {
      try {
        const bridge = getKeysendBridge();
        const capabilities = bridge.getCapabilities();
        
        // If bridge is needed (wallet doesn't support keysend), disable auto boost
        if (bridge.needsBridge()) {
          return { 
            success: false, 
            error: 'Auto boost requires a wallet with native keysend support. Please use a wallet like Alby, Zeus, or Phoenix for auto boost.' 
          };
        }
      } catch (error) {
        // Silently handle errors
      }
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

    // Use NWC if available and preferred (same logic as BitcoinConnect)
    if (shouldUseNWC && hasNWCConnection) {
      try {
        // Initialize keysend bridge (same logic as BitcoinConnect manual boost)
        const bridge = getKeysendBridge();
        
        // Check if bridge needs initialization (same check as manual boost)
        if (!bridge.getCapabilities().walletName || bridge.getCapabilities().walletName === 'Unknown') {
          await bridge.initialize({ userWalletConnection: nwcConnectionString });
        }
        
        // CRITICAL: Verify bridge is using user wallet, not site wallet
        const capabilities = bridge.getCapabilities();
        if (capabilities.walletName && capabilities.walletName.toLowerCase().includes('alby hub')) {
          throw new Error('Auto boost cannot use site wallet - user wallet required');
        }
        
        const paymentPromises = paymentsToMake.map(async (recipientData) => {
          const recipientAmount = (recipientData as any).fixedAmount || Math.floor((amount * recipientData.split) / totalSplit);
          
          // Create TLV records for boost metadata - all keysend payments should include TLVs
          const tlvRecords = boostMetadata ? createBoostTLVRecords(boostMetadata, recipientData.name, recipientAmount) : undefined;
          
          const result = await bridge.payKeysend({
            pubkey: recipientData.address,
            amount: recipientAmount,
            tlvRecords,
            description: `Auto boost to ${recipientData.name || 'recipient'}`
          });
          
          if (result.success) {
            return { recipient: recipientData.name || recipientData.address, amount: recipientAmount, preimage: result.preimage };
          } else {
            throw new Error(result.error || 'Payment failed');
          }
        });

        const paymentResults = await Promise.allSettled(paymentPromises);
        
        paymentResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            const recipientName = paymentsToMake[index].name || paymentsToMake[index].address;
            console.error(`❌ Auto boost payment failed to ${recipientName}:`, result.reason);
          }
        });

        if (results.length > 0) {
          return { success: true, results };
        } else {
          throw new Error('All NWC auto boost payments failed');
        }
        
      } catch (nwcError) {
        console.error('💡 AUTO BOOST: NWC auto boost failed, trying WebLN fallback:', nwcError);
        // Fall through to WebLN
      }
    }

    // WebLN fallback (same as original logic)
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