import { AppError, ErrorCodes, withRetry, createErrorLogger } from './error-utils';
import { RSSCache } from './rss-cache';

export interface RSSTrack {
  title: string;
  duration: string;
  url?: string;
  videoUrl?: string; // Video enclosure URL (HLS .m3u8 files)
  trackNumber?: number;
  subtitle?: string;
  summary?: string;
  image?: string;
  explicit?: boolean;
  keywords?: string[];
  startTime?: number; // Add time segment support
  value?: RSSValue; // Track-level podcast:value data
  endTime?: number;   // Add time segment support
  paymentRecipients?: Array<{ address: string; split: number; name?: string; fee?: boolean }>; // Pre-processed track payment recipients
  // Podcast GUIDs for Nostr boost tagging
  guid?: string; // Item GUID from RSS <guid> element  
  podcastGuid?: string; // podcast:guid at item level
  feedGuid?: string; // Feed GUID from podcast namespace
  feedUrl?: string; // Feed URL for this track
  publisherGuid?: string; // Publisher GUID
  publisherUrl?: string; // Publisher URL
  imageUrl?: string; // Track artwork URL
}

export interface RSSFunding {
  url: string;
  message?: string;
}

export interface RSSValueRecipient {
  type: string;
  address: string;
  split: number;
  name?: string;
  customKey?: string;
  customValue?: string;
  fee?: boolean;
}

export interface RSSValue {
  type: string;
  method: string;
  suggested?: string;
  recipients: RSSValueRecipient[];
}

export interface RSSPodRoll {
  url: string;
  title?: string;
  description?: string;
}

export interface RSSPublisher {
  feedGuid: string;
  feedUrl: string;
  medium: string;
}

export interface RSSPublisherItem {
  feedGuid: string;
  feedUrl: string;
  medium: string;
  title?: string;
}

export interface RSSAlbum {
  title: string;
  artist: string;
  description: string;
  coverArt: string | null;
  tracks: RSSTrack[];
  releaseDate: string;
  duration?: string;
  link?: string;
  funding?: RSSFunding[];
  value?: RSSValue;
  subtitle?: string;
  summary?: string;
  keywords?: string[];
  categories?: string[];
  explicit?: boolean;
  language?: string;
  copyright?: string;
  owner?: {
    name?: string;
    email?: string;
  };
  podroll?: RSSPodRoll[];
  publisher?: RSSPublisher;
  feedId?: string;
  feedUrl?: string;
  lastUpdated?: string;
  paymentRecipients?: Array<{ address: string; split: number; name?: string; fee?: boolean }>;
  // Podcast GUIDs for Nostr boost tagging
  feedGuid?: string; // Feed-level GUID
  publisherGuid?: string; // Publisher GUID
  publisherUrl?: string; // Publisher URL
  imageUrl?: string; // Album artwork URL
}

// Development logging utility
const isDev = process.env.NODE_ENV === 'development';
const isVerbose = process.env.NEXT_PUBLIC_LOG_LEVEL === 'verbose';

const devLog = (...args: any[]) => {
  if (isDev) console.log(...args);
};

const verboseLog = (...args: any[]) => {
  if (isVerbose) console.log(...args);
};

export class RSSParser {
  private static readonly logger = createErrorLogger('RSSParser');
  
  static async parseAlbumFeed(feedUrl: string, trackFilter?: string): Promise<RSSAlbum | null> {
    // Check cache first (only on server-side for performance)
    const isServer = typeof window === 'undefined';
    if (isServer) {
      const cached = RSSCache.get(feedUrl);
      if (cached) {
        let result = cached.data;
        // Apply track filter if specified
        if (trackFilter && cached.data) {
          const filteredTracks = cached.data.tracks.filter((track: RSSTrack) => {
            const titleLower = track.title.toLowerCase();
            const filterLower = trackFilter.toLowerCase();
            // Include tracks matching the filter (including [Raw Set] videos)
            return titleLower.includes(filterLower);
          });
          result = {
            ...cached.data,
            tracks: filteredTracks
          };
        }

        return result;
      }
    }
    
    return withRetry(async () => {
      verboseLog('[RSSParser] Parsing RSS feed', { feedUrl });
      
      // For server-side fetching, always use direct URLs  
      // For client-side fetching, use the proxy
      const isServer = typeof window === 'undefined';
      
      let response;
      try {
        if (isServer) {
          // Server-side: fetch directly
          response = await fetch(feedUrl);
        } else {
          // Client-side: use proxy or direct API routes
          const isApiRoute = feedUrl.startsWith('/api/');
          const isAlreadyProxied = feedUrl.startsWith('/api/fetch-rss');
          
          let proxyUrl: string;
          if (isApiRoute && !isAlreadyProxied) {
            // Direct API route (e.g., /api/podcastindex)
            proxyUrl = feedUrl;
          } else if (isAlreadyProxied) {
            // Already proxied through fetch-rss
            proxyUrl = feedUrl;
          } else {
            // External URL, proxy through fetch-rss
            proxyUrl = `/api/fetch-rss?url=${encodeURIComponent(feedUrl)}`;
          }
          
          response = await fetch(proxyUrl);
        }
      } catch (error) {
        throw new AppError(
          'Failed to fetch RSS feed',
          ErrorCodes.RSS_FETCH_ERROR,
          500,
          true,
          { feedUrl, error }
        );
      }
      
      if (!response.ok) {
        if (response.status === 429) {
          throw new AppError(
            'Rate limited while fetching RSS feed',
            ErrorCodes.RATE_LIMIT_ERROR,
            429,
            true,
            { feedUrl, status: response.status }
          );
        }
        throw new AppError(
          `Failed to fetch RSS feed: ${response.status}`,
          ErrorCodes.RSS_FETCH_ERROR,
          response.status,
          response.status >= 500,
          { feedUrl, status: response.status }
        );
      }
      
      const xmlText = await response.text();
      
      // Validate response content
      if (!xmlText || xmlText.trim().length === 0) {
        throw new AppError(
          'Empty response from RSS feed',
          ErrorCodes.RSS_INVALID_FORMAT,
          400,
          false,
          { feedUrl }
        );
      }
      
      // Ensure xmlText is a string before calling includes
      if (typeof xmlText !== 'string') {
        this.logger.error('Response is not a string', null, { 
          feedUrl, 
          responseType: typeof xmlText,
          responsePreview: String(xmlText).substring(0, 200) 
        });
        throw new AppError(
          'Response is not a string',
          ErrorCodes.RSS_INVALID_FORMAT,
          400,
          false,
          { feedUrl }
        );
      }
      
      if (!xmlText.includes('<') || !xmlText.includes('>')) {
        this.logger.error('Invalid XML response', null, { 
          feedUrl, 
          responsePreview: xmlText.substring(0, 200) 
        });
        throw new AppError(
          'Response is not valid XML',
          ErrorCodes.RSS_INVALID_FORMAT,
          400,
          false,
          { feedUrl }
        );
      }
      
      // Parse XML content
      let xmlDoc: any;
      try {
        if (typeof window !== 'undefined') {
          // Browser environment
          const parser = new DOMParser();
          xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        } else {
          // Server environment - use xmldom
          const { DOMParser } = await import('@xmldom/xmldom');
          const parser = new DOMParser();
          xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        }
        
        // Check for parsing errors
        const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
        if (parserError) {
          throw new AppError(
            'Invalid XML format in RSS feed',
            ErrorCodes.RSS_PARSE_ERROR,
            400,
            false,
            { feedUrl, parserError: parserError.textContent }
          );
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          'Failed to parse XML content',
          ErrorCodes.RSS_PARSE_ERROR,
          400,
          false,
          { feedUrl, error }
        );
      }
      
      // Extract channel info
      const channels = xmlDoc.getElementsByTagName('channel');
      if (!channels || channels.length === 0) {
        throw new AppError(
          'Invalid RSS feed: no channel found',
          ErrorCodes.RSS_INVALID_FORMAT,
          400,
          false,
          { feedUrl }
        );
      }
      const channel = channels[0];
      
      const titleElement = channel.getElementsByTagName('title')[0];
      const title = titleElement?.textContent?.trim() || 'Unknown Album';
      const descriptionElement = channel.getElementsByTagName('description')[0];
      const description = descriptionElement?.textContent?.trim() || '';
      const linkElement = channel.getElementsByTagName('link')[0];
      const link = linkElement?.textContent?.trim() || '';
      
      // Helper function to clean HTML content
      const cleanHtmlContent = (content: string | null | undefined): string | undefined => {
        if (!content) return undefined;
        // Remove HTML tags and decode HTML entities
        return content
          .replace(/<[^>]*>/g, '') // Remove HTML tags
          .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
          .replace(/&amp;/g, '&') // Replace &amp; with &
          .replace(/&lt;/g, '<') // Replace &lt; with <
          .replace(/&gt;/g, '>') // Replace &gt; with >
          .replace(/&quot;/g, '"') // Replace &quot; with "
          .replace(/&#39;/g, "'") // Replace &#39; with '
          .trim();
      };
      
      // Extract artist from title or author
      let artist = 'Unknown Artist';
      const authorElements = channel.getElementsByTagName('itunes:author');
      const authorElement = authorElements.length > 0 ? authorElements[0] : channel.getElementsByTagName('author')[0];
      if (authorElement) {
        artist = authorElement.textContent?.trim() || artist;
      } else {
        // Try to extract artist from title (format: "Artist - Album")
        const titleParts = title.split(' - ');
        if (titleParts.length > 1) {
          artist = titleParts[0].trim();
        }
      }
      
      // Extract tracks from items first (needed for cover art fallback)
      const items = xmlDoc.getElementsByTagName('item');
      
      // Extract cover art with prioritized methods (most reliable first)
      let coverArt: string | null = null;
      
      // Method 1: Channel-level itunes:image (most reliable)
      let imageElement: Element | null = channel.getElementsByTagName('itunes:image')[0] || null;
      if (!imageElement) {
        imageElement = channel.querySelector('itunes\\:image');
      }
      if (imageElement) {
        coverArt = imageElement.getAttribute('href') || null;
      }
      
      // Method 2: Channel-level image url (RSS standard)
      if (!coverArt) {
        const imageUrl = channel.querySelector('image url');
        if (imageUrl) {
          coverArt = imageUrl.textContent?.trim() || null;
        }
      }
      
      // Method 3: First item itunes:image (common fallback)
      if (!coverArt && items.length > 0) {
        const firstItem = items[0];
        const itemImageElement = firstItem.getElementsByTagName('itunes:image')[0];
        if (itemImageElement) {
          coverArt = itemImageElement.getAttribute('href') || null;
        }
      }
      
      // Validate and clean cover art URL
      if (coverArt) {
        try {
          const url = new URL(coverArt);
          // Security check for potentially unsafe URLs
          if (typeof url.href === 'string' && (url.href.includes('javascript:') || url.href.includes('data:'))) {
            console.warn('Potentially unsafe cover art URL detected:', coverArt);
            coverArt = null;
          }
        } catch (error) {
          // If URL parsing fails, only keep valid HTTP(S) URLs
          if (coverArt && typeof coverArt === 'string' && !coverArt.startsWith('http')) {
            verboseLog('Invalid cover art URL format:', coverArt);
            coverArt = null;
          }
        }
      }
      
      // Only warn about missing cover art in development
      if (!coverArt && process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ No cover art found for "${title}"`);
      }
      
      // Extract additional channel metadata
      const subtitle = channel.getElementsByTagName('itunes:subtitle')[0]?.textContent?.trim();
      const summary = channel.getElementsByTagName('itunes:summary')[0]?.textContent?.trim();
      const languageEl = channel.getElementsByTagName('language')[0];
      const language = languageEl?.textContent?.trim();
      const copyrightEl = channel.getElementsByTagName('copyright')[0];
      const copyright = copyrightEl?.textContent?.trim();
      
      // Extract explicit rating
      const explicitEl = channel.getElementsByTagName('itunes:explicit')[0];
      const explicit = explicitEl?.textContent?.trim().toLowerCase() === 'true';
      
      // Extract keywords
      const keywordsEl = channel.getElementsByTagName('itunes:keywords')[0];
      const keywords = keywordsEl?.textContent?.trim().split(',').map((k: string) => k.trim()).filter((k: string) => k) || [];
      
      // Extract categories
      const categoryElements = channel.getElementsByTagName('itunes:category');
      const categories = Array.from(categoryElements).map((cat: unknown) => (cat as Element).getAttribute('text')).filter(Boolean) as string[];
      
      // Extract owner info
      const ownerEl = channel.getElementsByTagName('itunes:owner')[0];
      const owner = ownerEl ? {
        name: ownerEl.getElementsByTagName('itunes:name')[0]?.textContent?.trim(),
        email: ownerEl.getElementsByTagName('itunes:email')[0]?.textContent?.trim()
      } : undefined;

      // Extract tracks from items
      // Extract main feed GUID from podcast:guid element before processing tracks
      const feedGuidElement = channel.getElementsByTagName('podcast:guid')[0];
      const mainFeedGuid = feedGuidElement?.textContent?.trim();
      
      // Debug feed GUID extraction
      if (mainFeedGuid) {
        console.log(`🏷️ Feed GUID extraction for "${title}":`, {
          feedGuid: mainFeedGuid
        });
      }

      const tracks: RSSTrack[] = [];
      
      // Less verbose: only log for large feeds or unusual cases
      if (items.length > 10 || items.length === 0) {
        devLog(`🎵 Found ${items.length} items in RSS feed`);
      }
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const trackTitle = item.getElementsByTagName('title')[0]?.textContent?.trim() || `Track ${i + 1}`;
        
        // Explicitly log "Sprouting Symphonies" item to debug parsing
        if (trackTitle.toLowerCase().includes('sprouting symphonies')) {
          console.log(`🎬 Found "Sprouting Symphonies" item at index ${i}, processing...`);
        }
        // Try multiple duration formats with better parsing
        let duration = '0:00';
        const itunesDuration = item.getElementsByTagName('itunes:duration')[0];
        const durationElement = item.getElementsByTagName('duration')[0];
        
        if (itunesDuration?.textContent?.trim()) {
          duration = itunesDuration.textContent.trim();
        } else if (durationElement?.textContent?.trim()) {
          duration = durationElement.textContent.trim();
        }
        
        // If duration is empty or just whitespace, use default
        if (!duration || duration.trim() === '') {
          duration = '0:00';
          verboseLog(`⚠️ No duration found for track "${trackTitle}", using default`);
        } else {
          // Convert seconds to MM:SS format if needed
          const durationStr = duration.trim();
          if (/^\d+$/.test(durationStr)) {
            // It's just seconds, convert to MM:SS
            const seconds = parseInt(durationStr);
            if (!isNaN(seconds) && seconds > 0) {
              const mins = Math.floor(seconds / 60);
              const secs = seconds % 60;
              duration = `${mins}:${secs.toString().padStart(2, '0')}`;
            } else {
              // Invalid seconds value, use default
              duration = '0:00';
              verboseLog(`⚠️ Invalid duration seconds "${durationStr}" for track "${trackTitle}", using default`);
            }
          } else if (typeof durationStr === 'string' && durationStr.includes(':')) {
            const parts = durationStr.split(':');
            if (parts.length === 2) {
              // MM:SS format
              const mins = parseInt(parts[0]);
              const secs = parseInt(parts[1]);
              if (!isNaN(mins) && !isNaN(secs) && mins >= 0 && secs >= 0 && secs < 60) {
                duration = `${mins}:${secs.toString().padStart(2, '0')}`;
              } else {
                // Invalid MM:SS format, use default
                duration = '0:00';
                verboseLog(`⚠️ Invalid MM:SS duration "${durationStr}" for track "${trackTitle}", using default`);
              }
            } else if (parts.length === 3) {
              // HH:MM:SS format (like Wavlake uses)
              const hours = parseInt(parts[0]);
              const mins = parseInt(parts[1]);
              const secs = parseInt(parts[2]);
              if (!isNaN(hours) && !isNaN(mins) && !isNaN(secs) && 
                  hours >= 0 && mins >= 0 && mins < 60 && secs >= 0 && secs < 60) {
                const totalMinutes = hours * 60 + mins;
                const originalDuration = duration;
                duration = `${totalMinutes}:${secs.toString().padStart(2, '0')}`;
                if (hours > 0) {
                  verboseLog(`🔄 Converted HH:MM:SS "${originalDuration}" to MM:SS "${duration}" for "${trackTitle}"`);
                }
              } else {
                // Invalid HH:MM:SS format, use default
                duration = '0:00';
                verboseLog(`⚠️ Invalid HH:MM:SS duration "${durationStr}" for track "${trackTitle}", using default`);
              }
            } else {
              // Unknown format with colons, use default
              duration = '0:00';
              verboseLog(`⚠️ Unknown duration format "${durationStr}" for track "${trackTitle}", using default`);
            }
          } else {
            // Unknown format, use default
            duration = '0:00';
            verboseLog(`⚠️ Cannot parse duration "${durationStr}" for track "${trackTitle}", using default`);
          }
        }
        
        // Final validation - check for NaN values
        if (typeof duration === 'string' && duration.includes('NaN')) {
          duration = '0:00';
          verboseLog(`⚠️ Duration contained NaN for track "${trackTitle}", using default`);
        }
        // Try multiple ways to get the track URL
        let url: string | undefined = undefined;
        let videoUrl: string | undefined = undefined;
        
        // Method 1: Try enclosure tag (standard RSS)
        const enclosureElement = item.getElementsByTagName('enclosure')[0];
        if (enclosureElement) {
          const enclosureUrl = enclosureElement.getAttribute('url') || undefined;
          const enclosureType = enclosureElement.getAttribute('type') || '';

          // Check if this is a video enclosure
          // HLS videos: application/x-mpegURL, application/vnd.apple.mpegurl
          // Other videos: video/* types, or .mp4/.m3u8 URL extension
          const isVideo = enclosureType.includes('mpegURL') ||
                         enclosureType.includes('mpegurl') ||
                         enclosureType.startsWith('video/') ||
                         (enclosureUrl && (enclosureUrl.endsWith('.mp4') || enclosureUrl.endsWith('.m3u8')));

          if (isVideo && enclosureUrl) {
            videoUrl = enclosureUrl;
            console.log(`📺 Video enclosure detected for "${trackTitle}": ${enclosureUrl} (type: ${enclosureType})`);
            // Explicitly log video tracks to ensure they're being parsed
            if (trackTitle.toLowerCase().includes('sprouting')) {
              console.log(`🎬 Parsing Sprouting Symphonies video track: ${trackTitle}, videoUrl: ${videoUrl}`);
            }

            // When main enclosure is video, look for audio in podcast:alternateEnclosure
            const alternateEnclosures = item.getElementsByTagName('podcast:alternateEnclosure');
            console.log(`🔍 Found ${alternateEnclosures.length} alternateEnclosure elements for "${trackTitle}"`);
            for (let j = 0; j < alternateEnclosures.length; j++) {
              const altEnclosure = alternateEnclosures[j];
              const altType = altEnclosure.getAttribute('type') || '';
              console.log(`  altEnclosure[${j}] type="${altType}"`);
              // Look for audio types (mp3, m4a, audio/*)
              if (altType.includes('mp3') || altType.includes('audio') || altType.includes('m4a')) {
                // Get the source URL from nested podcast:source element
                const sourceEl = altEnclosure.getElementsByTagName('podcast:source')[0];
                if (sourceEl) {
                  const altUrl = sourceEl.getAttribute('uri') || sourceEl.getAttribute('url');
                  if (altUrl) {
                    url = altUrl;
                    console.log(`🎵 Found audio alternate enclosure for "${trackTitle}": ${altUrl}`);
                    break;
                  }
                }
              }
            }
          } else if (enclosureUrl) {
            url = enclosureUrl;
          }
        }
        
        // Method 2: Try link tag (Wavlake format)
        if (!url && !videoUrl) {
          const linkElement = item.getElementsByTagName('link')[0];
          if (linkElement) {
            url = linkElement.textContent?.trim() || undefined;
          }
        }
        
        // Method 3: Try media:content tag
        if (!url && !videoUrl) {
          const mediaContent = item.getElementsByTagName('media:content')[0];
          if (mediaContent) {
            const mediaUrl = mediaContent.getAttribute('url') || undefined;
            const mediaType = mediaContent.getAttribute('type') || '';
            
            // Check if this is a video
            const isVideo = mediaType.includes('mpegURL') || 
                           mediaType.includes('mpegurl') || 
                           mediaType.startsWith('video/');
            
            if (isVideo && mediaUrl) {
              videoUrl = mediaUrl;
            } else if (mediaUrl) {
              url = mediaUrl;
            }
          }
        }
        
        // Extract track-specific metadata
        const trackSubtitle = item.getElementsByTagName('itunes:subtitle')[0]?.textContent?.trim();
        const trackSummary = item.getElementsByTagName('itunes:summary')[0]?.textContent?.trim();
        
        // Helper function to clean HTML content
        const cleanHtmlContent = (content: string | null | undefined): string | undefined => {
          if (!content) return undefined;
          // Remove HTML tags and decode HTML entities
          return content
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
            .replace(/&amp;/g, '&') // Replace &amp; with &
            .replace(/&lt;/g, '<') // Replace &lt; with <
            .replace(/&gt;/g, '>') // Replace &gt; with >
            .replace(/&quot;/g, '"') // Replace &quot; with "
            .replace(/&#39;/g, "'") // Replace &#39; with '
            .trim();
        };
        const trackImageEl = item.getElementsByTagName('itunes:image')[0];
        const trackImage = trackImageEl?.getAttribute('href') || trackImageEl?.getAttribute('url');
        const trackExplicitEl = item.getElementsByTagName('itunes:explicit')[0];
        const trackExplicit = trackExplicitEl?.textContent?.trim().toLowerCase() === 'true';
        const trackKeywordsEl = item.getElementsByTagName('itunes:keywords')[0];
        const trackKeywords = trackKeywordsEl?.textContent?.trim().split(',').map((k: string) => k.trim()).filter((k: string) => k) || [];
        
        // Extract track-level podcast:value information
        let trackValue: RSSValue | undefined;
        
        // Try both namespaced and non-namespaced versions for track value
        const trackValueElements1 = Array.from(item.getElementsByTagName('podcast:value'));
        const trackValueElements2 = Array.from(item.getElementsByTagName('value'));
        const allTrackValueElements = [...trackValueElements1, ...trackValueElements2];
        
        console.log(`🔍 Track "${trackTitle}": Found ${trackValueElements1.length} podcast:value and ${trackValueElements2.length} value elements`);
        
        if (allTrackValueElements.length > 0) {
          const trackValueElement = allTrackValueElements[0] as Element;
          const trackValueType = trackValueElement.getAttribute('type');
          const trackValueMethod = trackValueElement.getAttribute('method');
          const trackValueSuggested = trackValueElement.getAttribute('suggested');
          
          if (trackValueType && trackValueMethod) {
            // Extract track value recipients
            const trackRecipients: RSSValueRecipient[] = [];
            const trackRecipientElements1 = Array.from(trackValueElement.getElementsByTagName('podcast:valueRecipient'));
            const trackRecipientElements2 = Array.from(trackValueElement.getElementsByTagName('valueRecipient'));
            const allTrackRecipientElements = [...trackRecipientElements1, ...trackRecipientElements2];
            
            allTrackRecipientElements.forEach((recipientElement: unknown) => {
              const element = recipientElement as Element;
              const recipientType = element.getAttribute('type');
              const address = element.getAttribute('address');
              const splitStr = element.getAttribute('split');
              const name = element.getAttribute('name');
              const customKey = element.getAttribute('customKey');
              const customValue = element.getAttribute('customValue');
              const feeStr = element.getAttribute('fee');
              
              if (recipientType && address && splitStr) {
                trackRecipients.push({
                  type: recipientType as 'node' | 'lnaddress',
                  address,
                  split: parseInt(splitStr, 10),
                  name: name || undefined,
                  customKey: customKey || undefined,
                  customValue: customValue || undefined,
                  fee: feeStr === 'true'
                });
              }
            });
            
            if (trackRecipients.length > 0) {
              trackValue = {
                type: trackValueType as 'lightning',
                method: trackValueMethod as 'keysend',
                suggested: trackValueSuggested || undefined,
                recipients: trackRecipients
              };
            }
          }
        }
        
        // Process track-level podcast:value data server-side to create paymentRecipients
        let trackPaymentRecipients: Array<{ address: string; split: number; name?: string; fee?: boolean }> | undefined;
        
        if (trackValue && trackValue.type === 'lightning' && trackValue.method === 'keysend' && trackValue.recipients && trackValue.recipients.length > 0) {
          trackPaymentRecipients = trackValue.recipients
            .filter(r => r.type === 'node' || r.type === 'lnaddress') // Include both node and lnaddress recipients
            .map(r => ({
              address: r.address,
              split: r.split,
              name: r.name,
              fee: r.fee,
              type: r.type // Preserve the original type for payment routing
            }));
          
          if (trackPaymentRecipients.length > 0) {
            verboseLog(`💰 Processed ${trackPaymentRecipients.length} payment recipients for track "${trackTitle}"`);
          }
        }
        
        // Extract GUID information for Nostr boost tagging
        // Get the standard item guid (serves as item:guid)
        const guidElement = item.getElementsByTagName('guid')[0];
        const itemGuid = guidElement?.textContent?.trim();
        
        // Get the podcast:guid at item level if it exists
        const podcastGuidElement = item.getElementsByTagName('podcast:guid')[0];
        const itemPodcastGuid = podcastGuidElement?.textContent?.trim();
        
        // Debug GUID extraction
        if (itemGuid || itemPodcastGuid) {
          console.log(`🏷️ GUID extraction for "${trackTitle}":`, {
            itemGuid: itemGuid || 'NOT FOUND',
            podcastGuid: itemPodcastGuid || 'NOT FOUND'
          });
        }
        
        // Extract podcast namespace GUIDs from remote items
        let itemFeedGuid: string | undefined;
        let itemFeedUrl: string | undefined;
        let itemPublisherGuid: string | undefined;
        let itemPublisherUrl: string | undefined;
        
        // Look for remote items in this track
        const remoteItems = Array.from(item.getElementsByTagName('podcast:remoteItem'));
        remoteItems.forEach((remoteItemEl: unknown) => {
          const element = remoteItemEl as Element;
          const medium = element.getAttribute('medium');
          const feedGuid = element.getAttribute('feedGuid');
          const feedUrl = element.getAttribute('feedUrl');
          
          if (medium === 'podcast' && feedGuid) {
            itemFeedGuid = feedGuid;
            if (feedUrl) itemFeedUrl = feedUrl;
          } else if (medium === 'publisher' && feedGuid) {
            itemPublisherGuid = feedGuid;
            if (feedUrl) itemPublisherUrl = feedUrl;
          }
        });
        
        // Always create track, even if it only has videoUrl (no audio URL)
        // This ensures video-only tracks like "Sprouting Symphonies" are included
        // Set default duration for CityBeach [Raw Set] if not in feed
        let finalDuration = duration;
        if (videoUrl && trackTitle.toLowerCase().includes('citybeach') && trackTitle.toLowerCase().includes('raw set')) {
          if (!duration || duration === '0:00' || duration.trim() === '') {
            finalDuration = '51:36'; // Default duration for CityBeach [Raw Set]
          }
        }
        
        const track = {
          title: trackTitle,
          duration: finalDuration,
          url: url,
          videoUrl: videoUrl,
          trackNumber: i + 1,
          subtitle: cleanHtmlContent(trackSubtitle),
          summary: cleanHtmlContent(trackSummary),
          image: trackImage || undefined,
          explicit: trackExplicit,
          keywords: trackKeywords.length > 0 ? trackKeywords : undefined,
          value: trackValue,
          paymentRecipients: trackPaymentRecipients,
          // Add GUID fields for Nostr boost tagging
          guid: itemGuid, // Standard item guid
          podcastGuid: itemPodcastGuid, // podcast:guid at item level
          feedGuid: itemFeedGuid || mainFeedGuid,
          feedUrl: itemFeedUrl,
          publisherGuid: itemPublisherGuid,
          publisherUrl: itemPublisherUrl,
          imageUrl: trackImage
        };
        
        // Debug logging for Autumn Rust tracks
        if (title.toLowerCase().includes('autumn rust') && trackTitle.toLowerCase().includes('doerfel')) {
          console.log(`🎵 Created track: "${trackTitle}"`);
          console.log(`   url: ${url ? 'YES' : 'NO'}`);
          console.log(`   videoUrl: ${videoUrl || 'NO'}`);
        }
        
        tracks.push(track);
        
        // Explicitly log video tracks to ensure they're being created
        if (videoUrl && trackTitle.toLowerCase().includes('sprouting')) {
          console.log(`✅ Created Sprouting Symphonies video track: ${trackTitle}, videoUrl: ${videoUrl}, trackNumber: ${track.trackNumber}`);
        }
        
        // Always log video-only tracks (no audio URL) to debug parsing
        if (videoUrl && !url) {
          console.log(`📺 Created video-only track: "${trackTitle}" (no audio URL)`);
        }
        
        // Check for podcast:chapters tag and create chapter tracks for video items
        if (videoUrl) {
          const chaptersElement1 = item.getElementsByTagName('podcast:chapters')[0];
          const chaptersElement2 = item.getElementsByTagName('chapters')[0];
          const chaptersElement = chaptersElement1 || chaptersElement2;
          
          if (chaptersElement) {
            const chaptersUrl = chaptersElement.getAttribute('url');
            const chaptersType = chaptersElement.getAttribute('type') || 'application/json';
            
            if (chaptersUrl && chaptersType === 'application/json') {
              try {
                // Fetch chapters JSON (same domain as RSS feed, should be accessible)
                const chaptersResponse = await fetch(chaptersUrl);
                
                if (chaptersResponse.ok) {
                  const chaptersData = await chaptersResponse.json();
                  
                  if (chaptersData.chapters && Array.isArray(chaptersData.chapters)) {
                    verboseLog(`📖 Found ${chaptersData.chapters.length} chapters for "${trackTitle}"`);
                    
                    // Create chapter tracks - only CityBeach
                    chaptersData.chapters.forEach((chapter: any, chapterIndex: number) => {
                      // Only create chapter track for CityBeach
                      const chapterTitle = chapter.title || `Chapter ${chapterIndex + 1}`;
                      if (!chapterTitle.toLowerCase().includes('citybeach')) {
                        return; // Skip non-CityBeach chapters
                      }
                      
                      const chapterStartTime = chapter.startTime || 0;
                      const nextChapter = chaptersData.chapters[chapterIndex + 1];
                      const chapterEndTime = nextChapter ? nextChapter.startTime : undefined;
                      
                      // Skip chapters with very short or zero duration
                      if (chapterEndTime && chapterEndTime - chapterStartTime < 1) {
                        return;
                      }
                      
                      // Calculate chapter duration for display
                      let chapterDuration = '0:00';
                      if (chapterEndTime) {
                        const durationSeconds = Math.floor(chapterEndTime - chapterStartTime);
                        const mins = Math.floor(durationSeconds / 60);
                        const secs = durationSeconds % 60;
                        chapterDuration = `${mins}:${secs.toString().padStart(2, '0')}`;
                      }
                      
                      // Create chapter track
                      const chapterTrack: RSSTrack = {
                        title: chapterTitle,
                        duration: chapterDuration,
                        videoUrl: videoUrl, // Same video URL as parent
                        startTime: chapterStartTime,
                        endTime: chapterEndTime,
                        trackNumber: tracks.length + 1,
                        image: chapter.img || trackImage || undefined,
                        value: trackValue, // Inherit value from parent track
                        paymentRecipients: trackPaymentRecipients, // Inherit payment recipients
                        guid: itemGuid,
                        podcastGuid: itemPodcastGuid,
                        feedGuid: itemFeedGuid || mainFeedGuid,
                        feedUrl: itemFeedUrl,
                        publisherGuid: itemPublisherGuid,
                        publisherUrl: itemPublisherUrl,
                        imageUrl: chapter.img || trackImage
                      };
                      
                      tracks.push(chapterTrack);
                      console.log(`✅ Created CityBeach chapter track (item-level): "${chapterTrack.title}" (${chapterStartTime}s - ${chapterEndTime || 'end'}s)`);
                      verboseLog(`📖 Created chapter track: "${chapterTrack.title}" (${chapterStartTime}s - ${chapterEndTime || 'end'}s)`);
                    });
                  }
                } else {
                  verboseLog(`⚠️ Failed to fetch chapters JSON: ${chaptersResponse.status}`);
                }
              } catch (error) {
                verboseLog(`⚠️ Error fetching/parsing chapters for "${trackTitle}":`, error);
              }
            }
          }
        }
        
        // Reduced verbosity - only log missing URLs as warnings in dev
        if (!url) {
          verboseLog(`⚠️ Track missing URL: "${trackTitle}" (${duration})`);
        }
      }
      
      // Extract release date
      const pubDateElement = channel.getElementsByTagName('pubDate')[0] || channel.getElementsByTagName('lastBuildDate')[0];
      const releaseDate = pubDateElement?.textContent?.trim() || new Date().toISOString();
      
      // Extract funding information (deduplicated by URL)
      const funding: RSSFunding[] = [];
      const seenFundingUrls = new Set<string>();

      // Try both namespaced and non-namespaced versions for funding
      const fundingElements1 = Array.from(channel.getElementsByTagName('podcast:funding'));
      const fundingElements2 = Array.from(channel.getElementsByTagName('funding'));
      const allFundingElements = [...fundingElements1, ...fundingElements2];

      allFundingElements.forEach((fundingElement: unknown) => {
        const element = fundingElement as Element;
        const url = element.getAttribute('url') || element.textContent?.trim();
        const message = element.textContent?.trim() || element.getAttribute('message');

        // Deduplicate by URL - only add if we haven't seen this URL before
        if (url && !seenFundingUrls.has(url)) {
          seenFundingUrls.add(url);
          funding.push({
            url: url,
            message: message || undefined
          });
        }
      });
      
      // Extract value information (podcast:value)
      let value: RSSValue | undefined;
      
      // Try both namespaced and non-namespaced versions for value
      const valueElements1 = Array.from(channel.getElementsByTagName('podcast:value'));
      const valueElements2 = Array.from(channel.getElementsByTagName('value'));
      const allValueElements = [...valueElements1, ...valueElements2];
      
      console.log(`🔍 Album "${title}": Found ${valueElements1.length} podcast:value and ${valueElements2.length} value elements`);
      
      if (allValueElements.length > 0) {
        const valueElement = allValueElements[0] as Element;
        const type = valueElement.getAttribute('type');
        const method = valueElement.getAttribute('method');
        const suggested = valueElement.getAttribute('suggested');
        
        if (type && method) {
          // Extract value recipients
          const recipients: RSSValueRecipient[] = [];
          const recipientElements1 = Array.from(valueElement.getElementsByTagName('podcast:valueRecipient'));
          const recipientElements2 = Array.from(valueElement.getElementsByTagName('valueRecipient'));
          const allRecipientElements = [...recipientElements1, ...recipientElements2];
          
          allRecipientElements.forEach((recipientElement: unknown) => {
            const element = recipientElement as Element;
            const recipientType = element.getAttribute('type');
            const address = element.getAttribute('address');
            const splitStr = element.getAttribute('split');
            const split = splitStr ? parseInt(splitStr, 10) : 0;
            const name = element.getAttribute('name');
            const customKey = element.getAttribute('customKey');
            const customValue = element.getAttribute('customValue');
            const feeStr = element.getAttribute('fee');
            const fee = feeStr ? feeStr.toLowerCase() === 'true' : false;
            
            if (recipientType && address && split > 0) {
              recipients.push({
                type: recipientType,
                address: address,
                split: split,
                name: name || undefined,
                customKey: customKey || undefined,
                customValue: customValue || undefined,
                fee: fee
              });
            }
          });
          
          if (recipients.length > 0) {
            value = {
              type: type,
              method: method,
              suggested: suggested || undefined,
              recipients: recipients
            };
          }
        }
      }
      
      // Extract PodRoll information  
      const podroll: RSSPodRoll[] = [];
      
      // Try both namespaced and non-namespaced versions for podroll containers
      const podrollElements1 = Array.from(channel.getElementsByTagName('podcast:podroll'));
      const podrollElements2 = Array.from(channel.getElementsByTagName('podroll'));
      const allPodrollElements = [...podrollElements1, ...podrollElements2];
      
      allPodrollElements.forEach((podrollElement: unknown) => {
        const podrollEl = podrollElement as Element;
        // Look for podcast:remoteItem children within the podroll
        const remoteItems1 = Array.from(podrollEl.getElementsByTagName('podcast:remoteItem'));
        const remoteItems2 = Array.from(podrollEl.getElementsByTagName('remoteItem'));
        const allRemoteItems = [...remoteItems1, ...remoteItems2];
        
        allRemoteItems.forEach((remoteItem: unknown) => {
          const remoteEl = remoteItem as Element;
          const feedUrl = remoteEl.getAttribute('feedUrl');
          const feedGuid = remoteEl.getAttribute('feedGuid');
          const title = remoteEl.getAttribute('title') || remoteEl.textContent?.trim();
          const description = remoteEl.getAttribute('description');
          
          if (feedUrl) {
            podroll.push({
              url: feedUrl,
              title: title || `Feed ${feedGuid ? feedGuid.substring(0, 8) + '...' : 'Unknown'}`,
              description: description || undefined
            });
          }
        });
        
        // Also check for direct url attributes on the podroll element (legacy format)
        const directUrl = podrollEl.getAttribute('url');
        const directTitle = podrollEl.getAttribute('title') || podrollEl.textContent?.trim();
        const directDescription = podrollEl.getAttribute('description');
        
        if (directUrl) {
          podroll.push({
            url: directUrl,
            title: directTitle || undefined,
            description: directDescription || undefined
          });
        }
      });
      
      // Extract Publisher information
      let publisher: RSSPublisher | undefined = undefined;
      
      // Look for podcast:publisher element first (Podcasting 2.0 spec)
      const publisherElements = Array.from(channel.getElementsByTagName('podcast:publisher'));
      
      if (publisherElements.length > 0) {
        const publisherElement = publisherElements[0] as Element;
        // According to spec, podcast:publisher must contain exactly one podcast:remoteItem with medium="publisher"
        const remoteItem = publisherElement.getElementsByTagName('podcast:remoteItem')[0];
        
        if (remoteItem && remoteItem.getAttribute('medium') === 'publisher') {
          const feedGuid = remoteItem.getAttribute('feedGuid');
          const feedUrl = remoteItem.getAttribute('feedUrl');
          const medium = remoteItem.getAttribute('medium');
          
          if (feedGuid && feedUrl && medium) {
            publisher = {
              feedGuid,
              feedUrl,
              medium
            };
          }
        }
      } else {
        // Fallback: Look for standalone podcast:remoteItem with medium="publisher" (legacy support)
        const remoteItems = Array.from(channel.getElementsByTagName('podcast:remoteItem'));
        const publisherRemoteItem = remoteItems.find((item: unknown) => {
          const element = item as Element;
          return element.getAttribute('medium') === 'publisher';
        });
        
        if (publisherRemoteItem) {
          const element = publisherRemoteItem as Element;
          const feedGuid = element.getAttribute('feedGuid');
          const feedUrl = element.getAttribute('feedUrl');
          const medium = element.getAttribute('medium');
          
          if (feedGuid && feedUrl && medium) {
            publisher = {
              feedGuid,
              feedUrl,
              medium
            };
          }
        }
      }
      
      // Process podcast:value data server-side to create paymentRecipients
      let paymentRecipients: Array<{ address: string; split: number; name?: string; fee?: boolean }> | undefined;
      
      if (value && value.type === 'lightning' && value.method === 'keysend' && value.recipients && value.recipients.length > 0) {
        paymentRecipients = value.recipients
          .filter(r => r.type === 'node' || r.type === 'lnaddress') // Include both node and lnaddress recipients
          .map(r => ({
            address: r.address,
            split: r.split,
            name: r.name,
            fee: r.fee,
            type: r.type // Preserve the original type for payment routing
          }));
        
        if (paymentRecipients.length > 0) {
          verboseLog(`💰 Processed ${paymentRecipients.length} payment recipients for "${title}"`);
        }
      }

      // Check if channel-level link is a video URL and create a separate video-only track
      // This must happen after all tracks are created and after value/paymentRecipients are declared, but before filtering
      // Skip for Autumn Rust if we have chapters (we'll create chapter tracks instead)
      const hasChapters = channel.getElementsByTagName('podcast:chapters')[0] || channel.getElementsByTagName('chapters')[0];
      const shouldCreateFullVideo = !(title.toLowerCase().includes('autumn rust') && hasChapters);
      
      if (link && (link.includes('/video') || link.toLowerCase().includes('video')) && shouldCreateFullVideo) {
        const channelVideoUrl = link;
        verboseLog(`📺 Found channel-level video URL: ${channelVideoUrl}`);
        
        // Create a separate video-only track (no audio URL) for the video tab
        // This ensures audio tracks stay in the audio tab and only one video appears in the video tab
        // Match The Satellite Spotlight pattern: use "[Raw Set]" for full video tracks
        const videoTrackTitle = title.toLowerCase().includes('autumn rust') 
          ? `${title} [Raw Set]`
          : `${title} - Full Video`;
        const videoTrack: RSSTrack = {
          title: videoTrackTitle,
          duration: '0:00', // Duration will be determined when video loads
          videoUrl: channelVideoUrl,
          trackNumber: tracks.length + 1,
          image: coverArt || undefined,
          explicit: false,
          value: value,
          paymentRecipients: paymentRecipients,
          feedGuid: mainFeedGuid,
          feedUrl: feedUrl,
          publisherGuid: publisher?.feedGuid,
          publisherUrl: publisher?.feedUrl,
          imageUrl: coverArt || undefined
        };
        
        tracks.push(videoTrack);
        verboseLog(`📺 Created separate video-only track: "${videoTrack.title}"`);
      }

      // Check for chapters at channel level and match to video items
      const channelChaptersElement1 = channel.getElementsByTagName('podcast:chapters')[0];
      const channelChaptersElement2 = channel.getElementsByTagName('chapters')[0];
      const channelChaptersElement = channelChaptersElement1 || channelChaptersElement2;
      
      if (channelChaptersElement) {
        // For Autumn Rust, there are multiple chapters files - use the one with "autumn rust chapters.json" in the URL
        // This has the correct chapter data with "The Doerfels" at 338s
        let chaptersUrl = channelChaptersElement.getAttribute('url');
        const chaptersType = channelChaptersElement.getAttribute('type') || 'application/json';
        
        // If there are multiple chapter elements, prefer the one with "autumn rust chapters.json" for Autumn Rust
        if (title.toLowerCase().includes('autumn rust')) {
          const allChaptersElements = channel.getElementsByTagName('podcast:chapters');
          for (let i = 0; i < allChaptersElements.length; i++) {
            const url = allChaptersElements[i].getAttribute('url');
            if (url && url.toLowerCase().includes('autumn%20rust%20chapters.json') || url.toLowerCase().includes('autumn rust chapters.json')) {
              chaptersUrl = url;
              console.log(`📖 Using correct chapters file for Autumn Rust: ${chaptersUrl}`);
              break;
            }
          }
        }
        
        if (chaptersUrl && chaptersType === 'application/json') {
          try {
            // Fetch chapters JSON
            const chaptersResponse = await fetch(chaptersUrl);
            
            if (chaptersResponse.ok) {
              const chaptersData = await chaptersResponse.json();
              
              if (chaptersData.chapters && Array.isArray(chaptersData.chapters)) {
                console.log(`📖 Found ${chaptersData.chapters.length} chapters at channel level`);
                verboseLog(`📖 Found ${chaptersData.chapters.length} chapters at channel level`);
                
                // Also check if we have a channel-level video URL that needs chapters
                // For Autumn Rust, we want to create chapter tracks instead of a full video track
                // First, try to find the actual video stream URL from an RSS item (Cloudflare Stream)
                // If not found, fall back to channel-level link (SplitKit)
                let channelVideoUrl: string | null = null;
                
                // Look for the "Autumn Rust" item with a video enclosure (Cloudflare Stream URL)
                if (title.toLowerCase().includes('autumn rust')) {
                  // Get items from channel (they should still be accessible here)
                  const channelItems = channel.getElementsByTagName('item');
                  console.log(`🔍 Looking for Autumn Rust item with video enclosure. Total items: ${channelItems.length}`);
                  
                  const autumnRustItem = (Array.from(channelItems) as Element[]).find((item: Element) => {
                    const itemTitle = item.getElementsByTagName('title')[0]?.textContent || '';
                    // Look for exact "Autumn Rust" title (not "Boost Recap" or "The Doerfels")
                    const isExactMatch = itemTitle.toLowerCase().trim() === 'autumn rust';
                    const hasAutumnRust = itemTitle.toLowerCase().includes('autumn rust');
                    const hasDoerfel = itemTitle.toLowerCase().includes('doerfel');
                    const hasBoostRecap = itemTitle.toLowerCase().includes('boost recap');
                    console.log(`  Checking item: "${itemTitle}" (exact: ${isExactMatch}, hasAutumnRust: ${hasAutumnRust}, hasDoerfel: ${hasDoerfel}, hasBoostRecap: ${hasBoostRecap})`);
                    // Prefer exact match, but also accept items with "autumn rust" that aren't Doerfels or Boost Recap
                    return (isExactMatch || (hasAutumnRust && !hasDoerfel && !hasBoostRecap));
                  });
                  
                  if (autumnRustItem) {
                    console.log(`✅ Found Autumn Rust item, checking for video enclosure...`);
                    const enclosure = autumnRustItem.getElementsByTagName('enclosure')[0] as Element | undefined;
                    if (enclosure) {
                      const enclosureUrl = enclosure.getAttribute('url');
                      const enclosureType = enclosure.getAttribute('type') || '';
                      console.log(`  Enclosure URL: ${enclosureUrl}, Type: ${enclosureType}`);
                      // Check if it's a video enclosure (HLS/m3u8)
                      if (enclosureUrl && (enclosureType.includes('mpegURL') || enclosureType.includes('mpegurl') || enclosureUrl.includes('.m3u8'))) {
                        channelVideoUrl = enclosureUrl;
                        console.log(`✅ Found Cloudflare Stream URL for Autumn Rust: ${channelVideoUrl}`);
                      } else {
                        console.log(`⚠️ Enclosure found but not a video (type: ${enclosureType})`);
                      }
                    } else {
                      console.log(`⚠️ Autumn Rust item found but no enclosure`);
                    }
                  } else {
                    console.log(`⚠️ No Autumn Rust item found (excluding Doerfels)`);
                  }
                }
                
                // Fall back to channel-level link if no item-level video found
                if (!channelVideoUrl) {
                  channelVideoUrl = link && (link.includes('/video') || link.toLowerCase().includes('video')) ? link : null;
                }
                
                let videoTracksWithChapters: RSSTrack[] = [];
                
                console.log(`🔍 Chapter processing check: title="${title}", channelVideoUrl=${!!channelVideoUrl}, channelVideoUrl value="${channelVideoUrl}", includes "autumn rust"=${title.toLowerCase().includes('autumn rust')}`);
                
                if (channelVideoUrl && title.toLowerCase().includes('autumn rust')) {
                  try {
                    console.log(`✅ Condition met! Creating tempVideoTrack for Autumn Rust`);
                    // Remove any existing video tracks from tracks array for Autumn Rust
                    // We only want the chapter track, not any existing video tracks from the RSS feed
                    const tracksBeforeRemoval = tracks.length;
                    console.log(`🔍 Before removal: ${tracksBeforeRemoval} tracks`);
                    // Filter tracks in place by modifying the array (tracks is const, so we can't reassign it)
                    // Remove tracks with videoUrl that aren't chapter tracks (don't have startTime/endTime)
                    let removedCount = 0;
                    for (let i = tracks.length - 1; i >= 0; i--) {
                      const track = tracks[i];
                      if (track.videoUrl && !track.startTime && !track.endTime) {
                        tracks.splice(i, 1);
                        removedCount++;
                      }
                    }
                    console.log(`🔍 After removal: ${tracks.length} tracks, removed ${removedCount}`);
                    if (removedCount > 0) {
                      console.log(`🗑️ Removed ${removedCount} existing video track(s) from Autumn Rust (keeping only chapter tracks)`);
                    }
                    
                    // Create a temporary video track for Autumn Rust to attach chapters to
                    // This track won't be added to tracks array, it's just used to create chapter tracks
                    // Use ONLY the channel-level video URL, not any RSS item video enclosures
                    console.log(`🔍 Creating tempVideoTrack with videoUrl: "${channelVideoUrl}"`);
                    const tempVideoTrack: RSSTrack = {
                      title: `${title} - Full Video`,
                      duration: '0:00',
                      videoUrl: channelVideoUrl, // Use channel-level URL, not RSS item video
                      trackNumber: tracks.length + 1,
                      image: coverArt || undefined,
                      explicit: false,
                      value: value,
                      paymentRecipients: paymentRecipients,
                      feedGuid: mainFeedGuid,
                      feedUrl: feedUrl,
                      publisherGuid: publisher?.feedGuid,
                      publisherUrl: publisher?.feedUrl,
                      imageUrl: coverArt || undefined
                    };
                    console.log(`🔍 tempVideoTrack created, pushing to videoTracksWithChapters (current length: ${videoTracksWithChapters.length})`);
                    videoTracksWithChapters.push(tempVideoTrack);
                    console.log(`📺 Created temporary video track for Autumn Rust chapters with URL: "${tempVideoTrack.videoUrl}"`);
                    console.log(`📺 videoTracksWithChapters now has ${videoTracksWithChapters.length} track(s)`);
                    verboseLog(`📺 Created temporary video track for Autumn Rust chapters: "${tempVideoTrack.videoUrl}"`);
                  } catch (error) {
                    console.error(`❌ Error creating tempVideoTrack for Autumn Rust:`, error);
                  }
                } else {
                  // For other albums (like Sprouting Symphonies), find video items that should have chapters
                  videoTracksWithChapters = tracks.filter(track => 
                    track.videoUrl && 
                    (track.title.toLowerCase().includes('sprouting symphonies') ||
                     track.title.toLowerCase().includes('sprouting'))
                  );
                }
                
                console.log(`📖 Found ${videoTracksWithChapters.length} video track(s) for chapters processing`);
                if (videoTracksWithChapters.length === 0) {
                  console.log(`⚠️ No video tracks found for chapters. Available video tracks:`, 
                    tracks.filter(t => t.videoUrl).map(t => t.title));
                }
                
                // Create chapter tracks for each video track that should have chapters
                console.log(`📖 Processing ${videoTracksWithChapters.length} video track(s) for ${chaptersData.chapters.length} chapters`);
                videoTracksWithChapters.forEach(videoTrack => {
                  console.log(`📖 Creating chapters for video track: "${videoTrack.title}"`);
                  verboseLog(`📖 Creating chapters for video track: "${videoTrack.title}"`);
                  
                  console.log(`📖 Iterating through ${chaptersData.chapters.length} chapters...`);
                  chaptersData.chapters.forEach((chapter: any, chapterIndex: number) => {
                    const chapterTitle = chapter.title || `Chapter ${chapterIndex + 1}`;
                    const titleLower = title.toLowerCase();
                    const chapterTitleLower = chapterTitle.toLowerCase();
                    
                    // Only create chapter track for CityBeach (Sprouting Symphonies) or The Doerfels (Autumn Rust)
                    if (titleLower.includes('autumn rust')) {
                      // For Autumn Rust, only create chapter track for "The Doerfels"
                      console.log(`🔍 Checking chapter: "${chapterTitle}" (lowercase: "${chapterTitleLower}"), includes "doerfel": ${chapterTitleLower.includes('doerfel')}`);
                      if (!chapterTitleLower.includes('doerfel')) {
                        console.log(`⏭️ Skipping chapter "${chapterTitle}" (not Doerfels)`);
                        return; // Skip non-Doerfels chapters
                      }
                      console.log(`✅ Will create chapter track for "${chapterTitle}"`);
                    } else {
                      // For Sprouting Symphonies, only create chapter track for CityBeach
                      if (!chapterTitleLower.includes('citybeach')) {
                        return; // Skip non-CityBeach chapters
                      }
                    }
                    
                    const chapterStartTime = chapter.startTime || 0;
                    const nextChapter = chaptersData.chapters[chapterIndex + 1];
                    const chapterEndTime = nextChapter ? nextChapter.startTime : undefined;
                    
                    // Skip chapters with very short or zero duration
                    if (chapterEndTime && chapterEndTime - chapterStartTime < 1) {
                      return;
                    }
                    
                    // Calculate chapter duration for display
                    let chapterDuration = '0:00';
                    if (chapterEndTime) {
                      const durationSeconds = Math.floor(chapterEndTime - chapterStartTime);
                      const mins = Math.floor(durationSeconds / 60);
                      const secs = durationSeconds % 60;
                      chapterDuration = `${mins}:${secs.toString().padStart(2, '0')}`;
                    }
                    
                    // For "The Doerfels" chapter track, use value/paymentRecipients from a "The Doerfels" audio track
                    // instead of the channel-level value (which has wrong splits)
                    let chapterValue = videoTrack.value;
                    let chapterPaymentRecipients = videoTrack.paymentRecipients;
                    
                    if (titleLower.includes('autumn rust') && chapterTitleLower.includes('doerfel')) {
                      // Find a "The Doerfels" audio track (has url but no videoUrl) with track-level value
                      const doerfelsAudioTrack = tracks.find(track => 
                        track.url && 
                        !track.videoUrl && 
                        track.title.toLowerCase().includes('doerfel') &&
                        (track.value || track.paymentRecipients)
                      );
                      
                      if (doerfelsAudioTrack) {
                        console.log(`💰 Using value/paymentRecipients from Doerfels audio track: "${doerfelsAudioTrack.title}"`);
                        chapterValue = doerfelsAudioTrack.value;
                        chapterPaymentRecipients = doerfelsAudioTrack.paymentRecipients;
                      } else {
                        console.log(`⚠️ Could not find Doerfels audio track with value, using channel-level value`);
                      }
                    }
                    
                    // Create chapter track
                    const chapterTrack: RSSTrack = {
                      title: chapterTitle,
                      duration: chapterDuration,
                      videoUrl: videoTrack.videoUrl, // Same video URL as parent
                      startTime: chapterStartTime,
                      endTime: chapterEndTime,
                      trackNumber: tracks.length + 1,
                      image: chapter.img || videoTrack.image || undefined,
                      value: chapterValue, // Use track-level value for Doerfels, otherwise inherit from parent
                      paymentRecipients: chapterPaymentRecipients, // Use track-level paymentRecipients for Doerfels
                      guid: videoTrack.guid,
                      podcastGuid: videoTrack.podcastGuid,
                      feedGuid: videoTrack.feedGuid,
                      feedUrl: videoTrack.feedUrl,
                      publisherGuid: videoTrack.publisherGuid,
                      publisherUrl: videoTrack.publisherUrl,
                      imageUrl: chapter.img || videoTrack.imageUrl
                    };
                    
                    tracks.push(chapterTrack);
                    const chapterType = titleLower.includes('autumn rust') ? 'Doerfels' : 'CityBeach';
                    console.log(`✅ Created ${chapterType} chapter track: "${chapterTrack.title}" (${chapterStartTime}s - ${chapterEndTime || 'end'}s)`);
                    verboseLog(`📖 Created chapter track: "${chapterTrack.title}" (${chapterStartTime}s - ${chapterEndTime || 'end'}s)`);
                  });
                });
              }
            } else {
              verboseLog(`⚠️ Failed to fetch chapters JSON: ${chaptersResponse.status}`);
            }
          } catch (error) {
            verboseLog(`⚠️ Error fetching/parsing chapters from channel level:`, error);
          }
        }
      }
      
      // For Autumn Rust with chapters, remove videoUrl from audio tracks
      // Only the chapter track should have videoUrl, not the audio tracks
      // Check if chapters element exists (hasChapters is a DOM element, so check if it's truthy)
      const hasChaptersElement = channel.getElementsByTagName('podcast:chapters')[0] || channel.getElementsByTagName('chapters')[0];
      const titleLower = title.toLowerCase();
      const isAutumnRust = titleLower.includes('autumn rust');
      
      console.log(`🔍 Autumn Rust videoUrl removal check:`);
      console.log(`  - Title: "${title}"`);
      console.log(`  - Title includes "autumn rust": ${isAutumnRust}`);
      console.log(`  - Has chapters element: ${!!hasChaptersElement}`);
      console.log(`  - Total tracks before removal: ${tracks.length}`);
      
      if (isAutumnRust && hasChaptersElement) {
        console.log(`🔍 Processing ${tracks.length} tracks to remove videoUrl from audio tracks`);
        
        // Debug: Check what tracks look like before removal
        const tracksWithUrl = tracks.filter(t => t.url);
        const tracksWithVideoUrl = tracks.filter(t => t.videoUrl);
        const tracksWithBoth = tracks.filter(t => t.url && t.videoUrl);
        const chapterTracks = tracks.filter(t => t.startTime !== undefined && t.endTime !== undefined);
        
        console.log(`🔍 Track analysis:`);
        console.log(`  - Tracks with url: ${tracksWithUrl.length}`);
        console.log(`  - Tracks with videoUrl: ${tracksWithVideoUrl.length}`);
        console.log(`  - Tracks with both url and videoUrl: ${tracksWithBoth.length}`);
        console.log(`  - Chapter tracks (startTime/endTime): ${chapterTracks.length}`);
        
        // Show sample tracks
        if (tracksWithBoth.length > 0) {
          console.log(`🔍 Sample tracks with both url and videoUrl:`);
          tracksWithBoth.slice(0, 3).forEach(t => {
            console.log(`  - "${t.title}": url=${!!t.url}, videoUrl=${t.videoUrl}, startTime=${t.startTime}, endTime=${t.endTime}`);
          });
        }
        
        let removedCount = 0;
        tracks.forEach((track: RSSTrack) => {
          // Remove videoUrl from audio tracks (tracks with url)
          // Keep videoUrl only for chapter tracks (tracks with startTime/endTime)
          if (track.url && track.videoUrl && !track.startTime && !track.endTime) {
            const oldVideoUrl = track.videoUrl;
            delete track.videoUrl; // Use delete to actually remove the property
            removedCount++;
            console.log(`✅ Removed videoUrl from track: "${track.title}" (was: ${oldVideoUrl})`);
            verboseLog(`📺 Removed videoUrl from audio track: "${track.title}"`);
          }
        });
        console.log(`✅ Removed videoUrl from ${removedCount} audio tracks`);
        
        // Verify removal worked
        const tracksWithVideoUrlAfter = tracks.filter(t => t.videoUrl && t.url && !t.startTime && !t.endTime);
        if (tracksWithVideoUrlAfter.length > 0) {
          console.error(`❌ ERROR: ${tracksWithVideoUrlAfter.length} audio tracks still have videoUrl after removal!`);
          tracksWithVideoUrlAfter.forEach(t => {
            console.error(`  - "${t.title}": videoUrl=${t.videoUrl}`);
          });
        }
      } else {
        console.log(`⚠️ Skipping videoUrl removal: isAutumnRust=${isAutumnRust}, hasChaptersElement=${!!hasChaptersElement}`);
      }
      
      // Apply track filter if specified
      // Video-only tracks (with videoUrl but no url) and chapter tracks should always be included regardless of filter
      // BUT: For Autumn Rust, exclude video-only tracks that aren't chapter tracks (we only want the chapter track)
      let filteredTracks = trackFilter
        ? tracks.filter((track: RSSTrack) => {
            // Always include chapter tracks (tracks with videoUrl, startTime, and endTime)
            if (track.videoUrl && track.startTime !== undefined && track.endTime !== undefined) {
              return true;
            }
            // For Autumn Rust, exclude video-only tracks that aren't chapter tracks
            if (title.toLowerCase().includes('autumn rust') && track.videoUrl && !track.url) {
              return false; // Exclude non-chapter video tracks for Autumn Rust
            }
            // For other albums, always include video-only tracks (tracks with videoUrl but no url)
            if (track.videoUrl && !track.url) {
              return true;
            }
            const titleLower = track.title.toLowerCase();
            const filterLower = trackFilter.toLowerCase();
            // Include tracks matching the filter (including [Raw Set] videos)
            return titleLower.includes(filterLower);
          })
        : tracks;
      
      // Keep all video tracks and CityBeach audio tracks
      // BUT: Only apply this filter for The Satellite Spotlight (Sprouting Symphonies)
      // For other albums like Autumn Rust, don't filter out audio tracks
      const isSatelliteSpotlight = title.toLowerCase().includes('satellite spotlight') || 
                                   title.toLowerCase().includes('sprouting symphonies');
      
      if (isSatelliteSpotlight) {
        // Keep:
        // - All video tracks (videos with videoUrl)
        // - All CityBeach audio tracks (non-video tracks with "CityBeach" in title)
        // Remove:
        // - All non-CityBeach audio tracks (to keep only CityBeach audio and all videos)
        filteredTracks = filteredTracks.filter((track: RSSTrack) => {
          const titleLower = track.title.toLowerCase();
          
          // Keep all video tracks (any track with videoUrl)
          if (track.videoUrl) {
            return true; // Keep all video tracks
          }
          
          // Keep all CityBeach audio tracks (non-video tracks with "CityBeach" in title)
          if (!track.videoUrl) {
            if (titleLower.includes('citybeach')) {
              return true; // Keep CityBeach audio tracks
            }
            // Remove all non-CityBeach audio tracks
            return false;
          }
          
          return false;
        });
      }
      // For other albums (like Autumn Rust), keep all filtered tracks as-is
      
      // Deduplicate CityBeach chapter tracks (remove duplicates with same startTime/endTime)
      const seenCityBeach = new Set<string>();
      filteredTracks = filteredTracks.filter((track: RSSTrack) => {
        if (track.videoUrl && track.startTime !== undefined && track.endTime !== undefined) {
          const titleLower = track.title.toLowerCase();
          if (titleLower.includes('citybeach')) {
            const key = `${track.startTime}-${track.endTime}`;
            if (seenCityBeach.has(key)) {
              return false; // Remove duplicate
            }
            seenCityBeach.add(key);
          }
        }
        return true;
      });
      
      // Move video tracks to the bottom of the list
      // Order: chapter tracks first, then [Raw Set] videos
      const chapterTracks: RSSTrack[] = [];
      const rawSetTracks: RSSTrack[] = [];
      const otherTracks: RSSTrack[] = [];
      
      filteredTracks.forEach((track: RSSTrack) => {
        const titleLower = track.title.toLowerCase();
        // Check if it's a video chapter track (has videoUrl, startTime, and endTime)
        if (track.videoUrl && track.startTime !== undefined && track.endTime !== undefined) {
          chapterTracks.push(track);
        } else if (track.videoUrl && track.startTime === undefined && titleLower.includes('raw set')) {
          rawSetTracks.push(track);
        } else {
          otherTracks.push(track);
        }
      });
      
      // Reorder: audio tracks first, then chapter tracks, then [Raw Set] videos at the bottom
      filteredTracks = [...otherTracks, ...chapterTracks, ...rawSetTracks];

      // Final debug check for Autumn Rust before returning
      if (title.toLowerCase().includes('autumn rust')) {
        const finalAudio = filteredTracks.filter(t => t.url && !t.videoUrl);
        const finalVideo = filteredTracks.filter(t => t.videoUrl);
        const finalBoth = filteredTracks.filter(t => t.url && t.videoUrl);
        console.log(`🔍 Final album state for "${title}":`);
        console.log(`  - Total filtered tracks: ${filteredTracks.length}`);
        console.log(`  - Audio tracks (url, no videoUrl): ${finalAudio.length}`);
        console.log(`  - Video tracks (videoUrl): ${finalVideo.length}`);
        console.log(`  - Tracks with both: ${finalBoth.length}`);
        if (finalBoth.length > 0) {
          console.log(`  ⚠️ WARNING: ${finalBoth.length} tracks still have both url and videoUrl!`);
          finalBoth.slice(0, 3).forEach(t => {
            console.log(`    - "${t.title}": videoUrl=${t.videoUrl}`);
          });
        }
      }
      
      const album = {
        title,
        artist,
        description: cleanHtmlContent(description) || '',
        coverArt,
        tracks: filteredTracks,
        releaseDate,
        link,
        funding: funding.length > 0 ? funding : undefined,
        value: value,
        subtitle: cleanHtmlContent(subtitle),
        summary: cleanHtmlContent(summary),
        keywords: keywords.length > 0 ? keywords : undefined,
        categories: categories.length > 0 ? categories : undefined,
        explicit,
        language,
        copyright,
        owner: owner && (owner.name || owner.email) ? owner : undefined,
        podroll: podroll.length > 0 ? podroll : undefined,
        publisher: publisher,
        paymentRecipients: paymentRecipients,
        // Add feed-level GUID fields for Nostr boost tagging
        feedGuid: mainFeedGuid || publisher?.feedGuid,
        feedUrl: publisher?.feedUrl || feedUrl,
        publisherGuid: publisher?.feedGuid,
        publisherUrl: publisher?.feedUrl,
        imageUrl: coverArt || undefined
      };

      verboseLog('[RSSParser] Successfully parsed RSS feed', {
        feedUrl,
        trackCount: tracks.length,
        filteredTrackCount: filteredTracks.length,
        trackFilter
      });

      // Cache the result (only on server-side)
      // Note: The cached album includes paymentRecipients for both album and tracks,
      // which are pre-processed during RSS parsing and stored in the cache for production use
      if (isServer) {
        RSSCache.set(feedUrl, album, response.headers.get('etag') || undefined);
      }

      return album;
      
    }, {
      maxRetries: 3,
      delay: 1000,
      onRetry: (attempt, error) => {
        this.logger.warn(`Retrying RSS feed parse (attempt ${attempt})`, { feedUrl, error });
      }
    }).catch(error => {
      this.logger.error('Failed to parse RSS feed after retries', error, { feedUrl });
      return null;
    });
  }
  
  static async parseMultipleFeeds(feedUrls: string[]): Promise<RSSAlbum[]> {
    // Only log for large batches to reduce noise
    if (feedUrls.length > 5) {
      devLog(`🔄 Parsing ${feedUrls.length} RSS feeds...`);
    }
    
    // Process feeds in larger batches for better performance
    const batchSize = 20; // Increased from 10
    const results: RSSAlbum[] = [];
    
    for (let i = 0; i < feedUrls.length; i += batchSize) {
      const batch = feedUrls.slice(i, i + batchSize);
      // Only log batches for large operations
      if (feedUrls.length > 10) {
        devLog(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(feedUrls.length / batchSize)} (${batch.length} feeds)`);
      }
      
      const promises = batch.map(async (url) => {
        try {
          // Use retry logic for each feed
          return await withRetry(
            () => this.parseAlbumFeed(url),
            {
              maxRetries: 2, // Use 2 retries for batch processing to avoid too much delay
              delay: 1000,
              onRetry: (attempt, error) => {
                this.logger.warn(`Retrying feed parse (attempt ${attempt})`, { url, error });
              }
            }
          );
        } catch (error) {
          // Enhanced error handling for NetworkError
          if (error instanceof TypeError && typeof error.message === 'string' && error.message.includes('NetworkError')) {
            console.error(`❌ NetworkError when attempting to fetch resource.`);
            console.log('🔍 Error details:', {
              message: error.message,
              stack: error.stack,
              feedUrl: url
            });
            return null;
          }
          console.error(`❌ Failed to parse feed ${url} after retries:`, error);
          return null;
        }
      });
      
      const batchResults = await Promise.allSettled(promises);
      
      const successful = batchResults.filter((result): result is PromiseFulfilledResult<RSSAlbum> => 
        result.status === 'fulfilled' && result.value !== null);
      
      const failed = batchResults.filter(result => result.status === 'rejected' || result.value === null);
      
      // Only log failures for large batches to reduce noise
      if (failed.length > 0 && feedUrls.length > 10) {
        console.warn(`⚠️ Failed to parse ${failed.length} feeds in batch ${Math.floor(i / batchSize) + 1}`);
        // Only log first few failures to avoid console spam
        failed.slice(0, 2).forEach((result, index) => {
          if (result.status === 'rejected') {
            console.error(`❌ Failed to parse feed ${batch[index]}: ${result.reason}`);
          } else if (result.status === 'fulfilled' && result.value === null) {
            console.error(`❌ Feed ${batch[index]} returned null`);
          }
        });
        if (failed.length > 2) {
          console.warn(`... and ${failed.length - 2} more failures`);
        }
      }
      
      results.push(...successful.map(result => result.value));
      
      // Reduced delay between batches for faster loading
      if (i + batchSize < feedUrls.length) {
        await new Promise(resolve => setTimeout(resolve, 50)); // Reduced from 100ms
      }
    }
    
    // Only log summary for large operations
    if (feedUrls.length > 5) {
      devLog(`✅ Successfully parsed ${results.length} albums from ${feedUrls.length} feeds`);
    }
    return results;
  }

  static async parsePublisherFeedInfo(feedUrl: string): Promise<{ title?: string; description?: string; artist?: string; coverArt?: string } | null> {
    try {
      // For server-side fetching, always use direct URLs
      // For client-side fetching, use the proxy
      const isServer = typeof window === 'undefined';
      
      let response;
      if (isServer) {
        // Server-side: fetch directly
        response = await fetch(feedUrl);
      } else {
        // Client-side: use proxy or direct API routes
        const isApiRoute = feedUrl.startsWith('/api/');
        const isAlreadyProxied = feedUrl.startsWith('/api/fetch-rss');
        
        let proxyUrl: string;
        if (isApiRoute && !isAlreadyProxied) {
          // Direct API route (e.g., /api/podcastindex)
          proxyUrl = feedUrl;
        } else if (isAlreadyProxied) {
          // Already proxied through fetch-rss
          proxyUrl = feedUrl;
        } else {
          // External URL, proxy through fetch-rss
          proxyUrl = `/api/fetch-rss?url=${encodeURIComponent(feedUrl)}`;
        }
        
        response = await fetch(proxyUrl);
      }
      
      if (!response.ok) {
        throw new Error(`Failed to fetch publisher feed: ${response.status}`);
      }
      
      const xmlText = await response.text();
      
      // Ensure xmlText is a string before calling includes
      if (typeof xmlText !== 'string') {
        console.error('parsePublisherFeedInfo: Response is not a string:', typeof xmlText);
        throw new Error('Response is not a string');
      }
      
      // Use different XML parsing based on environment
      let xmlDoc: any;
      if (typeof window !== 'undefined') {
        // Browser environment
        const parser = new DOMParser();
        xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      } else {
        // Server environment - use xmldom
        const { DOMParser } = await import('@xmldom/xmldom');
        const parser = new DOMParser();
        xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      }
      
      // Check for parsing errors
      const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
      if (parserError) {
        throw new Error('Invalid XML format');
      }
      
      // Extract channel info
      const channels = xmlDoc.getElementsByTagName('channel');
      if (!channels || channels.length === 0) {
        throw new Error('Invalid RSS feed: no channel found');
      }
      const channel = channels[0];
      
      const titleElement = channel.getElementsByTagName('title')[0];
      const title = titleElement?.textContent?.trim() || '';
      const descriptionElement = channel.getElementsByTagName('description')[0];
      const description = descriptionElement?.textContent?.trim() || '';
      
      // Extract artist from title or author
      let artist = title; // Use title as default artist name
      const authorElements = channel.getElementsByTagName('itunes:author');
      const authorElement = authorElements.length > 0 ? authorElements[0] : channel.getElementsByTagName('author')[0];
      if (authorElement) {
        artist = authorElement.textContent?.trim() || artist;
      }
      
      // Extract cover art
      let coverArt: string | null = null;
      let imageElement: Element | null = channel.getElementsByTagName('itunes:image')[0] || null;
      if (!imageElement) {
        // Fallback to querySelector with escaped namespace
        imageElement = channel.querySelector('itunes\\:image');
      }
      
      if (imageElement) {
        coverArt = imageElement.getAttribute('href') || null;
      }
      if (!coverArt) {
        const imageUrl = channel.querySelector('image url');
        if (imageUrl) {
          coverArt = imageUrl.textContent?.trim() || null;
        }
      }
      
      return {
        title,
        description,
        artist,
        coverArt: coverArt || undefined
      };
      
    } catch (error) {
      console.error('❌ Error parsing publisher feed info:', error);
      return null;
    }
  }

  static async parsePublisherFeed(feedUrl: string): Promise<RSSPublisherItem[]> {
    try {
      // Handle special cases
      if (feedUrl === 'iroh-aggregated') {
        console.log('🎵 Loading IROH aggregated feed from Wavlake...');
        // For IROH, we need to fetch the main artist feed and extract music items
        const isServer = typeof window === 'undefined';
        
        let response;
        if (isServer) {
          // Server-side: fetch directly
          response = await fetch('https://wavlake.com/feed/artist/8a9c2e54-785a-4128-9412-737610f5d00a');
        } else {
          // Client-side: use proxy
          const proxyUrl = `/api/fetch-rss?url=${encodeURIComponent('https://wavlake.com/feed/artist/8a9c2e54-785a-4128-9412-737610f5d00a')}`;
          response = await fetch(proxyUrl);
        }
        
        if (!response.ok) {
          throw new Error(`Failed to fetch IROH artist feed: ${response.status}`);
        }
        
        const xmlText = await response.text();
        
        // Use different XML parsing based on environment
        let xmlDoc: any;
        if (typeof window !== 'undefined') {
          // Browser environment
          const parser = new DOMParser();
          xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        } else {
          // Server environment - use xmldom
          const { DOMParser } = await import('@xmldom/xmldom');
          const parser = new DOMParser();
          xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        }
        
        // Check for parsing errors
        const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
        if (parserError) {
          throw new Error('Invalid XML format');
        }
        
        // Extract channel info
        const channels = xmlDoc.getElementsByTagName('channel');
        if (!channels || channels.length === 0) {
          throw new Error('Invalid RSS feed: no channel found');
        }
        const channel = channels[0];
        
        const publisherItems: RSSPublisherItem[] = [];
        
        // Look for podcast:remoteItem elements with medium="music"
        const remoteItems = Array.from(channel.getElementsByTagName('podcast:remoteItem'));
        
        remoteItems.forEach((item: unknown) => {
          const element = item as Element;
          const medium = element.getAttribute('medium');
          const feedGuid = element.getAttribute('feedGuid');
          const feedUrl = element.getAttribute('feedUrl');
          const title = element.getAttribute('title') || element.textContent?.trim();
          
          if (medium === 'music' && feedGuid && feedUrl) {
            publisherItems.push({
              feedGuid,
              feedUrl,
              medium,
              title
            });
          }
        });
        
        devLog(`🏢 Found ${publisherItems.length} music items in IROH aggregated feed`);
        return publisherItems;
      }
      // PATCH: Ensure feedUrl is a string before using .startsWith
      if (typeof feedUrl !== 'string') {
        console.error('parsePublisherFeed: feedUrl is not a string:', feedUrl);
        throw new TypeError('feedUrl must be a string (URL). Received: ' + typeof feedUrl);
      }
      // For regular feeds, use the original logic
      const isServer = typeof window === 'undefined';
      
      let response;
      if (isServer) {
        // Server-side: fetch directly
        response = await fetch(feedUrl);
      } else {
        // Client-side: use proxy or direct API routes
        const isApiRoute = feedUrl.startsWith('/api/');
        const isAlreadyProxied = feedUrl.startsWith('/api/fetch-rss');
        
        let proxyUrl: string;
        if (isApiRoute && !isAlreadyProxied) {
          // Direct API route (e.g., /api/podcastindex)
          proxyUrl = feedUrl;
        } else if (isAlreadyProxied) {
          // Already proxied through fetch-rss
          proxyUrl = feedUrl;
        } else {
          // External URL, proxy through fetch-rss
          proxyUrl = `/api/fetch-rss?url=${encodeURIComponent(feedUrl)}`;
        }
        
        response = await fetch(proxyUrl);
      }
      
      if (!response.ok) {
        throw new Error(`Failed to fetch publisher feed: ${response.status}`);
      }
      
      const xmlText = await response.text();
      
      // Ensure xmlText is a string before calling includes
      if (typeof xmlText !== 'string') {
        console.error('parsePublisherFeed: Response is not a string:', typeof xmlText);
        throw new Error('Response is not a string');
      }
      
      // Use different XML parsing based on environment
      let xmlDoc: any;
      if (typeof window !== 'undefined') {
        // Browser environment
        const parser = new DOMParser();
        xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      } else {
        // Server environment - use xmldom
        const { DOMParser } = await import('@xmldom/xmldom');
        const parser = new DOMParser();
        xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      }
      
      // Check for parsing errors
      const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
      if (parserError) {
        throw new Error('Invalid XML format');
      }
      
      // Extract channel info
      const channels = xmlDoc.getElementsByTagName('channel');
      if (!channels || channels.length === 0) {
        throw new Error('Invalid RSS feed: no channel found');
      }
      const channel = channels[0];
      
      const publisherItems: RSSPublisherItem[] = [];
      
      // Look for podcast:remoteItem elements with medium="music"
      const remoteItems = Array.from(channel.getElementsByTagName('podcast:remoteItem'));
      
      remoteItems.forEach((item: unknown) => {
        const element = item as Element;
        const medium = element.getAttribute('medium');
        const feedGuid = element.getAttribute('feedGuid');
        const feedUrl = element.getAttribute('feedUrl');
        const title = element.getAttribute('title') || element.textContent?.trim();
        
        if (medium === 'music' && feedGuid && feedUrl) {
          publisherItems.push({
            feedGuid,
            feedUrl,
            medium,
            title
          });
        }
      });
      
      devLog(`🏢 Found ${publisherItems.length} music items in publisher feed: ${feedUrl}`);
      return publisherItems;
      
    } catch (error) {
      console.error('❌ Error parsing publisher feed:', error);
      return [];
    }
  }

  static async parsePublisherFeedAlbums(feedUrl: string): Promise<RSSAlbum[]> {
    devLog(`🏢 Parsing publisher feed for albums: ${feedUrl}`);
    
    const publisherItems = await this.parsePublisherFeed(feedUrl);
    
    if (publisherItems.length === 0) {
      devLog(`📭 No music items found in publisher feed: ${feedUrl}`);
      return [];
    }
    
    const musicFeedUrls = publisherItems.map(item => item.feedUrl);
    devLog(`🎵 Loading ${musicFeedUrls.length} music feeds from publisher...`);
    
    // Optimize batch size based on number of feeds
    let batchSize = 5; // Default batch size
    let delayMs = 500; // Default delay
    
    // For large publisher feeds (like Doerfels with 36 feeds), use larger batches
    if (musicFeedUrls.length > 20) {
      batchSize = 8; // Larger batches for efficiency
      delayMs = 300; // Shorter delays
    }
    
    const allAlbums: RSSAlbum[] = [];
    
    for (let i = 0; i < musicFeedUrls.length; i += batchSize) {
      const batch = musicFeedUrls.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(musicFeedUrls.length / batchSize);
      
      devLog(`📦 Processing publisher batch ${batchNumber}/${totalBatches} (${batch.length} feeds)`);
      
      try {
        const batchAlbums = await this.parseMultipleFeeds(batch);
        allAlbums.push(...batchAlbums);
        devLog(`✅ Batch ${batchNumber}/${totalBatches} completed: ${batchAlbums.length} albums (${allAlbums.length}/${musicFeedUrls.length} total)`);
      } catch (error) {
        console.error(`❌ Error in publisher batch ${batchNumber}/${totalBatches}:`, error);
        // Continue with next batch instead of failing completely
      }
      
      // Reduced delay between batches for better performance
      if (i + batchSize < musicFeedUrls.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    devLog(`🎶 Loaded ${allAlbums.length} albums from publisher feed`);
    return allAlbums;
  }
}