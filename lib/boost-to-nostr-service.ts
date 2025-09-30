import { 
  SimplePool, 
  finalizeEvent, 
  type Event,
  type EventTemplate,
  type Filter,
  generateSecretKey,
  getPublicKey,
  nip19
} from 'nostr-tools';
import { getZapReceiptService, type ZapReceipt } from './zap-receipt-service';
import { LNURLService } from './lnurl-service';
import { WebLNService } from './webln-service';

/**
 * Service for posting track boosts to Nostr
 * Creates Kind 1 notes with track metadata and zap information
 */

export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  url?: string;
  imageUrl?: string;
  timestamp?: number; // Current playback position in seconds
  duration?: number; // Total track duration in seconds
  senderName?: string; // Name of the person sending the boost
  // Podcast-specific metadata (matching RSS parser property names)
  guid?: string; // Standard item GUID
  podcastGuid?: string; // podcast:guid at item level
  feedGuid?: string; // Feed-level GUID
  feedUrl?: string;
  publisherGuid?: string;
  publisherUrl?: string;
  // Nostr announcement reference
  announcementEventId?: string; // Reference to track/album announcement event
}

export interface BoostOptions {
  amount: number; // Amount in sats
  comment?: string;
  track: TrackMetadata;
  zapReceipt?: ZapReceipt;
  tags?: string[]; // Additional hashtags
}

export interface BoostResult {
  event: Event;
  eventId: string;
  success: boolean;
  error?: string;
  nevent?: string; // Include nevent for sharing
}

export interface ZapRequestOptions {
  amount: number; // Amount in millisats
  recipientPubkey: string;
  comment?: string;
  relays: string[];
  track?: TrackMetadata;
  lnurl?: string; // Optional LNURL for recipient
}

export interface ZapRequest {
  event: Event;
  eventId: string;
  invoice?: string; // Lightning invoice from LNURL endpoint
}

export class BoostToNostrService {
  private pool: SimplePool;
  private relays: string[];
  private secretKey: Uint8Array | null = null;
  private publicKey: string | null = null;

  constructor(
    relays: string[] = [],
    secretKey?: Uint8Array
  ) {
    // Temporarily create a minimal pool that doesn't actually connect
    this.pool = new SimplePool();
    this.relays = relays.length > 0 ? relays : [
      'wss://relay.primal.net',
      'wss://relay.snort.social',
      'wss://relay.nostr.band',
      'wss://relay.fountain.fm',
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://chadf.nostr1.com'
    ];

    if (secretKey) {
      this.setKeys(secretKey);
    }
  }

  /**
   * Set the keys for signing events
   */
  setKeys(secretKey: Uint8Array) {
    this.secretKey = secretKey;
    this.publicKey = getPublicKey(secretKey);
  }

  /**
   * Generate new keys if needed
   */
  generateKeys(): { secretKey: Uint8Array; publicKey: string; npub: string } {
    const secretKey = generateSecretKey();
    const publicKey = getPublicKey(secretKey);
    this.setKeys(secretKey);
    const npub = nip19.npubEncode(publicKey);
    return { secretKey, publicKey, npub };
  }

  /**
   * Check if keys are configured
   */
  hasKeys(): boolean {
    return !!(this.secretKey && this.publicKey);
  }

  /**
   * Format the boost amount for display
   */
  private formatAmount(sats: number): string {
    if (sats >= 1000000) {
      return `${(sats / 1000000).toFixed(2)}M`;
    } else if (sats >= 1000) {
      return `${(sats / 1000).toFixed(1)}k`;
    }
    return sats.toString();
  }

  /**
   * Format timestamp for display
   */
  private formatTimestamp(seconds?: number): string {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Generate HPM site URL for track/album
   */
  private generateHPMUrl(track: TrackMetadata): string | null {
    const baseUrl = 'https://zaps.podtards.com';
    
    // Special case for LNURL Testing Podcast - use GitHub repo
    if (track.album && track.album.toLowerCase().includes('lnurl testing')) {
      return 'https://github.com/ChadFarrow/lnurl-test-feed';
    }
    
    // For albums, use album title to create album URL with optional track hash
    if (track.album) {
      // Create album slug from title
      const albumSlug = track.album
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
      
      let url = `${baseUrl}/album/${albumSlug}`;
      
      // Only add track identifier as hash if we have a track title that's different from album
      if (track.title && track.title !== track.album) {
        const trackSlug = track.title
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-+|-+$/g, '');
        url += `#${trackSlug}`;
      }
      
      return url;
    }
    
    // For publishers, use artist name
    if (track.artist) {
      const publisherSlug = track.artist
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
      
      return `${baseUrl}/publisher/${publisherSlug}`;
    }
    
    return null;
  }

  /**
   * Publish boost note to Nostr relays asynchronously
   */
  private async publishBoostNoteAsync(event: Event, nevent: string): Promise<void> {
    try {
      const publishPromises = this.pool.publish(this.relays, event);
      
      // Wait for publish results with detailed logging
      const results = await Promise.allSettled(publishPromises);
      
      let successCount = 0;
      let failureCount = 0;
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          console.log(`✅ Published to ${this.relays[index]}`);
          successCount++;
        } else {
          console.warn(`❌ Failed to publish to ${this.relays[index]}:`, result.reason);
          failureCount++;
        }
      });
      
      console.log(`📊 Publish results: ${successCount} successful, ${failureCount} failed`);
      
      if (successCount > 0) {
        console.log('🎵 Boost note published successfully to Nostr relays');
        console.log(`🔗 View your boost: https://primal.net/e/${event.id}`);
        console.log(`🔗 Alternative: https://snort.social/e/${event.id}`);
        console.log(`🔗 Nostr reference: nostr:${nevent}`);
        console.log(`👤 Your Nostr profile: https://primal.net/p/${getPublicKey(this.secretKey!)}`);
      } else {
        console.error('❌ Failed to publish to any relays');
      }
    } catch (publishError) {
      console.warn('⚠️ Failed to publish boost note:', publishError);
      throw publishError;
    }
  }

  /**
   * Create a boost post for Nostr with detailed track info
   */
  private createBoostContent(options: BoostOptions): string {
    const { amount, comment, track } = options;
    
    // Get HPM site URL
    const hpmUrl = this.generateHPMUrl(track);
    
    let content = '';
    
    // Start with boost amount
    content = `⚡ ${amount} sats`;
    
    // Add track title in quotes
    if (track.title) {
      content += ` • "${track.title}"`;
    }
    
    // Add artist
    if (track.artist) {
      content += ` by ${track.artist}`;
    }
    
    // Add album on new line if different from title (skip for auto boosts)
    if (track.album && track.album !== track.title && track.senderName !== 'Auto Boost') {
      content += `\nFrom: ${track.album}`;
    }
    
    // Add sender name if provided (skip for auto boosts)
    if (track.senderName && track.senderName !== 'Auto Boost') {
      content += `\n\nSent by: ${track.senderName}`;
    }
    
    // Add user comment if provided
    if (comment) {
      content += `\n\n${comment}`;
    }
    
    // Add HPM site URL
    if (hpmUrl) {
      content += `\n\n🎧 ${hpmUrl}`;
    }
    
    // Add nevent reference to announcement if available (like Fountain does)
    if (track.announcementEventId) {
      // Create nevent from the announcement event ID
      const announcementNevent = nip19.neventEncode({
        id: track.announcementEventId,
        relays: this.relays.slice(0, 2),
        kind: 1
      });
      
      content += `\n\nnostr:${announcementNevent}`;
    }

    // Structured metadata is included in the Nostr tags, not in the content
    
    return content;
  }

  /**
   * Post a boost to Nostr
   */
  async postBoost(options: BoostOptions): Promise<BoostResult> {
    console.log('🚀 postBoost called directly with options:', {
      amount: options.amount,
      trackTitle: options.track?.title,
      trackArtist: options.track?.artist,
      guid: options.track?.guid,
      feedGuid: options.track?.feedGuid,
      publisherGuid: options.track?.publisherGuid
    });
    
    if (!this.secretKey || !this.publicKey) {
      console.log('❌ postBoost failed: No keys configured');
      return {
        event: {} as Event,
        eventId: '',
        success: false,
        error: 'No keys configured. Call setKeys() or generateKeys() first.'
      };
    }

    try {
      // Create initial content without nevent (we'll add it after we have the event ID)
      let content = this.createBoostContent(options);

      // Create event template
      const eventTemplate: EventTemplate = {
        kind: 1, // Text note
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content
      };

      // Add Fountain-style podcast tags in k/i pairs with HPM URLs
      const hpmUrl = this.generateHPMUrl(options.track);
      
      console.log('🏷️ Debug track metadata for tags:', {
        guid: options.track.guid,
        podcastGuid: options.track.podcastGuid,
        feedGuid: options.track.feedGuid,
        publisherGuid: options.track.publisherGuid,
        feedUrl: options.track.feedUrl
      });
      
      if (options.track.guid) {
        console.log('🏷️ Adding item GUID tags:', options.track.guid);
        // k tag declares the identifier type
        eventTemplate.tags.push(['k', 'podcast:item:guid']);
        // i tag contains the actual identifier with URL hint
        const itemTag = ['i', `podcast:item:guid:${options.track.guid}`];
        if (itdvUrl) {
          itemTag.push(itdvUrl);
        }
        eventTemplate.tags.push(itemTag);
      }

      if (options.track.feedGuid) {
        console.log('🏷️ Adding podcast GUID tags:', options.track.feedGuid);
        // k tag declares the identifier type
        eventTemplate.tags.push(['k', 'podcast:guid']);
        // i tag contains the actual identifier with URL hint
        const feedTag = ['i', `podcast:guid:${options.track.feedGuid}`];
        if (itdvUrl) {
          feedTag.push(itdvUrl);
        }
        eventTemplate.tags.push(feedTag);
      }

      if (options.track.publisherGuid) {
        // k tag declares the identifier type
        eventTemplate.tags.push(['k', 'podcast:publisher:guid']);
        // i tag contains the actual identifier with URL hint
        const publisherTag = ['i', `podcast:publisher:guid:${options.track.publisherGuid}`];
        if (itdvUrl) {
          publisherTag.push(itdvUrl);
        }
        eventTemplate.tags.push(publisherTag);
      }

      // Add album art image if available
      if (options.track.imageUrl) {
        eventTemplate.tags.push(['image', options.track.imageUrl]);
      }

      // Debug: Log final event template with all tags before signing
      console.log('🏷️ Final Nostr event template with all tags:', {
        kind: eventTemplate.kind,
        tagsCount: eventTemplate.tags.length,
        tags: eventTemplate.tags,
        hasGuidTags: eventTemplate.tags.some(tag => tag[0] === 'k' && tag[1] === 'podcast:item:guid'),
        hasFeedGuidTags: eventTemplate.tags.some(tag => tag[0] === 'k' && tag[1] === 'podcast:guid'),
        hasPublisherGuidTags: eventTemplate.tags.some(tag => tag[0] === 'k' && tag[1] === 'podcast:publisher:guid')
      });

      // Sign the event
      const event = finalizeEvent(eventTemplate, this.secretKey);
      
      // Debug: Log the signed event's tags
      console.log('🏷️ Signed Nostr event tags:', {
        eventId: event.id,
        finalTagsCount: event.tags.length,
        finalTags: event.tags
      });
      
      // Create the nevent identifier for this event
      const neventData = {
        id: event.id,
        relays: this.relays.slice(0, 2), // Include first 2 relays as hints  
        author: event.pubkey,
        kind: 1
      };
      
      // Encode as nevent
      const nevent = nip19.neventEncode(neventData);
      
      // Verify event is properly formatted
      console.log('🔍 Event validation:', {
        hasId: !!event.id,
        hasValidId: event.id && event.id.length === 64,
        hasPubkey: !!event.pubkey,
        hasValidPubkey: event.pubkey && event.pubkey.length === 64,
        hasSignature: !!event.sig,
        hasValidSignature: event.sig && event.sig.length === 128,
        kind: event.kind,
        tagsCount: event.tags.length
      });

      // Publish to relays asynchronously to avoid blocking payment flow
      console.log('📡 Publishing boost note to relays asynchronously:', this.relays);
      console.log('📝 Event details:', {
        id: event.id,
        kind: event.kind,
        created_at: event.created_at,
        tags: event.tags,
        content: event.content.substring(0, 100) + '...',
        nevent: `nostr:${nevent}`
      });
      
      // Don't await - publish in background to avoid blocking payment response
      this.publishBoostNoteAsync(event, nevent).catch(error => {
        console.warn('⚠️ Background Nostr publishing failed:', error);
      });

      return {
        event,
        eventId: event.id,
        success: true,
        nevent: `nostr:${nevent}` // Include nevent for sharing
      };
    } catch (error) {
      console.error('Error posting boost to Nostr:', error);
      return {
        event: {} as Event,
        eventId: '',
        success: false,
        error: error instanceof Error ? error.message : 'Failed to post boost'
      };
    }
  }

  /**
   * Create a NIP-57/NIP-73 zap request (Kind 9734)
   */
  async createZapRequest(options: ZapRequestOptions): Promise<ZapRequest | null> {
    if (!this.secretKey || !this.publicKey) {
      console.error('No keys configured for zap request');
      return null;
    }

    try {
      // Create the zap request event template
      const eventTemplate: EventTemplate = {
        kind: 9734, // Zap request kind
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: options.comment || ''
      };

      // Add required tags for NIP-57
      eventTemplate.tags.push(['relays', ...options.relays]);
      eventTemplate.tags.push(['amount', options.amount.toString()]);
      eventTemplate.tags.push(['p', options.recipientPubkey]);

      // Add NIP-73 podcast metadata if provided
      if (options.track) {
        // Add podcast guid tags
        if (options.track.feedGuid) {
          eventTemplate.tags.push(['k', 'podcast:guid']);
          eventTemplate.tags.push([
            'i',
            `podcast:guid:${options.track.feedGuid}`,
            options.track.feedUrl || ''
          ]);
        }

        // Add episode/item guid tags
        if (options.track.guid) {
          eventTemplate.tags.push(['k', 'podcast:item:guid']);
          const itemTag = [
            'i',
            `podcast:item:guid:${options.track.guid}`
          ];
          
          // Add URL hint if available
          const hpmUrl = this.generateHPMUrl(options.track);
          if (hpmUrl) {
            itemTag.push(hpmUrl);
          }
          eventTemplate.tags.push(itemTag);
        }

        // Add publisher guid if available
        if (options.track.publisherGuid) {
          eventTemplate.tags.push(['k', 'podcast:publisher:guid']);
          eventTemplate.tags.push([
            'i',
            `podcast:publisher:guid:${options.track.publisherGuid}`,
            options.track.publisherUrl || ''
          ]);
        }
      }

      // Add lnurl tag if provided
      if (options.lnurl) {
        eventTemplate.tags.push(['lnurl', options.lnurl]);
      }

      // Sign the event
      const event = finalizeEvent(eventTemplate, this.secretKey);

      console.log('✅ Created zap request:', {
        eventId: event.id,
        kind: event.kind,
        tags: event.tags,
        amount: options.amount
      });

      return {
        event,
        eventId: event.id
      };
    } catch (error) {
      console.error('Failed to create zap request:', error);
      return null;
    }
  }

  /**
   * Execute a full zap flow with payment
   */
  async executeZap(
    lnurlOrAddress: string,
    options: ZapRequestOptions
  ): Promise<{ zapRequest: ZapRequest; invoice: string; paymentPreimage?: string; receipt?: ZapReceipt }> {
    try {
      // 1. Create the zap request
      console.log('1. Creating zap request...');
      const zapRequest = await this.createZapRequest(options);
      if (!zapRequest) {
        throw new Error('Failed to create zap request');
      }

      // 2. Get Lightning invoice from LNURL
      console.log('2. Fetching Lightning invoice from LNURL...');
      const invoice = await LNURLService.getZapInvoice(
        lnurlOrAddress,
        options.amount,
        zapRequest.event,
        options.comment
      );
      zapRequest.invoice = invoice;

      // 3. Pay the invoice via WebLN
      console.log('3. Paying invoice via WebLN...');
      let paymentPreimage: string | undefined;
      try {
        const paymentResponse = await WebLNService.payInvoice(invoice);
        paymentPreimage = paymentResponse.preimage;
        console.log('✓ Payment successful! Preimage:', paymentPreimage);
      } catch (payError) {
        console.warn('WebLN payment failed or was cancelled:', payError);
        // Return without payment - user can still see the invoice
        return { zapRequest, invoice };
      }

      // 4. Wait for zap receipt
      console.log('4. Waiting for zap receipt...');
      const receipt = await this.waitForZapReceipt(
        zapRequest.eventId,
        options.recipientPubkey,
        30000 // 30 second timeout
      );

      if (receipt) {
        console.log('✓ Zap receipt received:', receipt);
      } else {
        console.warn('⚠ Zap sent but receipt not found (may still arrive)');
      }

      return { zapRequest, invoice, paymentPreimage, receipt: receipt || undefined };
    } catch (error) {
      console.error('Zap execution failed:', error);
      throw error;
    }
  }

  /**
   * Wait for a zap receipt to appear on relays
   */
  async waitForZapReceipt(
    zapRequestId: string,
    recipientPubkey: string,
    timeoutMs: number = 30000
  ): Promise<ZapReceipt | null> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let subscription: any;

      const checkForReceipt = async () => {
        try {
          // Query for zap receipts
          const filter: Filter = {
            kinds: [9735],
            '#p': [recipientPubkey],
            since: Math.floor(startTime / 1000) - 60 // Look back 1 minute
          };

          const events = await this.pool.querySync(this.relays, filter);
          
          // Look for a receipt that references our zap request
          for (const event of events) {
            const descriptionTag = event.tags.find(tag => tag[0] === 'description');
            if (descriptionTag && descriptionTag[1]) {
              try {
                const zapRequestInReceipt = JSON.parse(descriptionTag[1]);
                if (zapRequestInReceipt.id === zapRequestId) {
                  // Found our receipt!
                  const zapService = getZapReceiptService(this.relays);
                  const receipt = zapService.parseZapReceipt(event);
                  resolve(receipt);
                  return;
                }
              } catch (e) {
                // Invalid description, skip
              }
            }
          }

          // Check if timeout reached
          if (Date.now() - startTime > timeoutMs) {
            console.warn('Zap receipt timeout reached');
            resolve(null);
            return;
          }

          // Check again in 2 seconds
          setTimeout(checkForReceipt, 2000);
        } catch (error) {
          console.error('Error checking for zap receipt:', error);
          resolve(null);
        }
      };

      // Start checking
      checkForReceipt();
    });
  }

  /**
   * Post a boost with automatic zap (full flow)
   */
  async postBoostWithZap(
    options: BoostOptions & { 
      recipientPubkey: string;
      lnurlOrAddress: string;
    }
  ): Promise<BoostResult & { 
    zapRequest?: ZapRequest;
    paymentPreimage?: string;
    zapReceipt?: ZapReceipt;
  }> {
    try {
      // Execute the full zap flow
      const zapResult = await this.executeZap(options.lnurlOrAddress, {
        amount: options.amount * 1000, // Convert sats to millisats
        recipientPubkey: options.recipientPubkey,
        comment: options.comment,
        relays: this.relays,
        track: options.track,
        lnurl: options.lnurlOrAddress
      });

      // Update options with the zap receipt if we got one
      if (zapResult.receipt) {
        options.zapReceipt = zapResult.receipt;
      }

      // Post the boost note with zap info
      const boostResult = await this.postBoost(options);

      return {
        ...boostResult,
        zapRequest: zapResult.zapRequest,
        paymentPreimage: zapResult.paymentPreimage,
        zapReceipt: zapResult.receipt
      };
    } catch (error) {
      console.error('Failed to post boost with zap:', error);
      return {
        event: {} as Event,
        eventId: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Fetch recent boosts from a user
   */
  async fetchUserBoosts(
    pubkey: string,
    limit: number = 20
  ): Promise<Event[]> {
    try {
      const filter: Filter = {
        kinds: [1], // Text notes
        authors: [pubkey],
        limit
        // Remove hashtag filter as it may be too restrictive
      };

      const events = await this.pool.querySync(this.relays, filter);

      // Filter for events that look like boosts (contain ⚡ and sats)
      const boostEvents = events.filter(event =>
        event.content.includes('⚡') && event.content.includes('sats')
      );

      // Sort by timestamp, newest first
      boostEvents.sort((a, b) => b.created_at - a.created_at);

      return boostEvents;
    } catch (error) {
      console.error('Error fetching user boosts:', error);
      return [];
    }
  }

  /**
   * Fetch all recent boosts from relays
   */
  async fetchRecentBoosts(
    limit: number = 50,
    since?: number
  ): Promise<Event[]> {
    try {
      const filter: Filter = {
        kinds: [1], // Text notes
        limit,
        since: since || Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60, // Last 7 days by default
      };

      const events = await this.pool.querySync(this.relays, filter);

      // Filter for events that look like boosts
      const boostEvents = events.filter(event => {
        // Check if it's a boost by content pattern
        const hasBoostPattern = event.content.includes('⚡') && event.content.includes('sats');

        // Also check for podcast-related tags, but be more specific
        const hasPodcastTags = event.tags.some(tag =>
          (tag[0] === 'k' && tag[1]?.includes('podcast')) ||
          (tag[0] === 'i' && tag[1]?.includes('podcast'))
        );


        // Accept events with boost pattern OR podcast tags (original logic)
        return hasBoostPattern || hasPodcastTags;
      });

      // Sort by timestamp, newest first
      boostEvents.sort((a, b) => b.created_at - a.created_at);

      return boostEvents;
    } catch (error) {
      console.error('Error fetching recent boosts:', error);
      return [];
    }
  }

  /**
   * Fetch boosts for a specific track
   */
  async fetchTrackBoosts(
    trackTitle: string,
    artist?: string,
    limit: number = 20
  ): Promise<Event[]> {
    try {
      // Fetch recent boosts and filter by track
      const allBoosts = await this.fetchRecentBoosts(limit * 2);

      const trackBoosts = allBoosts.filter(event => {
        const content = event.content.toLowerCase();
        const hasTrack = trackTitle && content.includes(trackTitle.toLowerCase());
        const hasArtist = !artist || content.includes(artist.toLowerCase());

        return hasTrack && hasArtist;
      });

      return trackBoosts.slice(0, limit);
    } catch (error) {
      console.error('Error fetching track boosts:', error);
      return [];
    }
  }

  /**
   * Fetch replies to a specific event
   */
  async fetchReplies(
    eventId: string,
    limit: number = 20
  ): Promise<Event[]> {
    try {
      const filter: Filter = {
        kinds: [1], // Text notes
        '#e': [eventId], // Events that reference this event
        limit
      };

      const events = await this.pool.querySync(this.relays, filter);

      // Filter for actual replies (those with 'reply' or 'root' markers, or direct references)
      const replies = events.filter(event => {
        // Check if this is a reply by looking at e tags
        const eTags = event.tags.filter(tag => tag[0] === 'e');

        // If it references our event, it's likely a reply
        const referencesEvent = eTags.some(tag => tag[1] === eventId);

        return referencesEvent;
      });

      // Sort by timestamp, oldest first (chronological order for replies)
      replies.sort((a, b) => a.created_at - b.created_at);

      return replies;
    } catch (error) {
      console.error('Error fetching replies:', error);
      return [];
    }
  }

  /**
   * Fetch threaded replies with nested structure
   */
  async fetchThreadedReplies(
    eventId: string,
    maxDepth: number = 3,
    limit: number = 20
  ): Promise<Event[]> {
    try {
      const allReplies: Event[] = [];
      const processedIds = new Set<string>();

      // Recursive function to fetch replies at each depth level
      const fetchRepliesRecursive = async (parentId: string, currentDepth: number): Promise<void> => {
        if (currentDepth >= maxDepth) return;

        const filter: Filter = {
          kinds: [1], // Text notes
          '#e': [parentId], // Events that reference this event
          limit
        };

        const events = await this.pool.querySync(this.relays, filter);

        // Filter for actual replies and avoid duplicates
        const replies = events.filter(event => {
          if (processedIds.has(event.id)) return false;

          const eTags = event.tags.filter(tag => tag[0] === 'e');
          const referencesEvent = eTags.some(tag => tag[1] === parentId);

          if (referencesEvent) {
            processedIds.add(event.id);
            allReplies.push(event);
            return true;
          }
          return false;
        });

        // Recursively fetch replies to these replies
        for (const reply of replies) {
          await fetchRepliesRecursive(reply.id, currentDepth + 1);
        }
      };

      // Start with the original event
      await fetchRepliesRecursive(eventId, 0);

      // Sort by timestamp for consistent ordering
      allReplies.sort((a, b) => a.created_at - b.created_at);

      return allReplies;
    } catch (error) {
      console.error('Error fetching threaded replies:', error);
      return [];
    }
  }

  /**
   * Fetch multiple events with their replies
   */
  async fetchBoostsWithReplies(
    limit: number = 20
  ): Promise<Map<string, { boost: Event; replies: Event[] }>> {
    try {
      // First fetch the boosts
      const boosts = await this.fetchRecentBoosts(limit);

      // Create a map to store boosts with their replies
      const boostsWithReplies = new Map<string, { boost: Event; replies: Event[] }>();

      // Fetch replies for each boost
      const replyPromises = boosts.map(async (boost) => {
        const replies = await this.fetchReplies(boost.id, 10); // Limit replies per boost
        return { boost, replies };
      });

      const results = await Promise.all(replyPromises);

      // Populate the map
      results.forEach(({ boost, replies }) => {
        boostsWithReplies.set(boost.id, { boost, replies });
      });

      return boostsWithReplies;
    } catch (error) {
      console.error('Error fetching boosts with replies:', error);
      return new Map();
    }
  }

  /**
   * Subscribe to live boosts
   */
  subscribeToBoosts(
    filters: {
      tracks?: Array<{ title: string; artist?: string }>;
      users?: string[];
      authors?: string[];
    },
    callbacks: {
      onBoost: (event: Event) => void;
      onError?: (error: Error) => void;
    }
  ) {
    console.log('🔍 Setting up real-time boost subscription');

    const pool = new SimplePool();

    // Create filter for real-time events
    const subscriptionFilter: Filter = {
      kinds: [1], // Text notes
      since: Math.floor(Date.now() / 1000), // Only new events from now
      limit: 50
    };

    // Add author filter if specified
    if (filters.authors && filters.authors.length > 0) {
      subscriptionFilter.authors = filters.authors;
    }

    console.log('🔍 Subscription filter:', subscriptionFilter);

    try {
      const subscription = pool.subscribeMany(
        this.relays,
        [subscriptionFilter],
        {
          onevent(event) {
            console.log('📡 Received real-time event:', event.id);

            // Check if this looks like a boost event
            if (event.content.includes('⚡') && event.content.includes('sats')) {
              console.log('⚡ Detected boost event in real-time:', event.id);
              callbacks.onBoost(event);
            }
          },
          oneose() {
            console.log('🔍 Real-time subscription established');
          },
          onclose() {
            console.log('🔍 Real-time subscription closed');
          }
        }
      );

      return {
        close: () => {
          console.log('🔍 Closing real-time subscription');
          subscription.close();
          pool.close(this.relays);
        }
      };
    } catch (error) {
      console.error('🔍 Failed to create real-time subscription:', error);
      if (callbacks.onError) {
        callbacks.onError(error as Error);
      }
      return {
        close: () => {}
      };
    }
  }

  /**
   * Parse boost data from an event
   */
  parseBoostEvent(event: Event): {
    amount?: number;
    trackTitle?: string;
    trackArtist?: string;
    trackAlbum?: string;
    comment?: string;
    timestamp: number;
  } | null {
    try {
      const amountTag = event.tags.find(tag => tag[0] === 'amount');
      const titleTag = event.tags.find(tag => tag[0] === 'track_title');
      const artistTag = event.tags.find(tag => tag[0] === 'track_artist');
      const albumTag = event.tags.find(tag => tag[0] === 'track_album');

      // Extract comment from content
      const contentLines = event.content.split('\n');
      const commentLine = contentLines.find(line => line.startsWith('💬'));
      const comment = commentLine ? commentLine.replace('💬 "', '').replace('"', '') : undefined;

      return {
        amount: amountTag ? parseInt(amountTag[1]) : undefined,
        trackTitle: titleTag?.[1],
        trackArtist: artistTag?.[1],
        trackAlbum: albumTag?.[1],
        comment,
        timestamp: event.created_at
      };
    } catch (error) {
      console.error('Error parsing boost event:', error);
      return null;
    }
  }

  /**
   * Close all connections
   */
  close() {
    this.pool.close(this.relays);
  }
}

// Singleton instance
let boostService: BoostToNostrService | null = null;

export function getBoostToNostrService(
  relays?: string[],
  secretKey?: Uint8Array
): BoostToNostrService {
  if (!boostService) {
    boostService = new BoostToNostrService(relays, secretKey);
  }
  return boostService;
}