'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { getBoostToNostrService, type TrackMetadata, type BoostResult } from '@/lib/boost-to-nostr-service';
import type { Event } from 'nostr-tools';
import { getPublicKey, nip19 } from 'nostr-tools';
import { safeLocalStorage } from '@/lib/safe-storage';
// Minimal subscription interface for type safety
interface MinimalSubscription {
  close(): void;
}

export interface UseBoostToNostrOptions {
  relays?: string[];
  autoGenerateKeys?: boolean;
  secretKey?: Uint8Array;
}

export interface UseBoostToNostrReturn {
  postBoost: (amount: number, track: TrackMetadata, comment?: string) => Promise<BoostResult>;
  boostHistory: Event[];
  isPosting: boolean;
  error: string | null;
  publicKey: string | null;
  generateKeys: () => void;
  setSecretKey: (key: Uint8Array) => void;
  subscribeToBoosts: (trackTitle?: string, artist?: string) => void;
  unsubscribe: () => void;
  isSubscribed: boolean;
}

export function useBoostToNostr(options: UseBoostToNostrOptions = {}): UseBoostToNostrReturn {
  const [boostHistory, setBoostHistory] = useState<Event[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  
  const serviceRef = useRef<ReturnType<typeof getBoostToNostrService>>();
  const subscriptionRef = useRef<MinimalSubscription | null>(null);

  // Initialize service
  useEffect(() => {
    serviceRef.current = getBoostToNostrService(options.relays, options.secretKey);
    
    // Try to get site's permanent Nostr keys from environment
    const siteNsec = process.env.NEXT_PUBLIC_SITE_NOSTR_NSEC;
    const siteNpub = process.env.NEXT_PUBLIC_SITE_NOSTR_NPUB;


    if (siteNsec && siteNpub) {
      try {
        // Decode the nsec to get the secret key
        const { data: secretKey } = nip19.decode(siteNsec);
        if (secretKey instanceof Uint8Array) {
          serviceRef.current.setKeys(secretKey);
          setPublicKey(siteNpub.replace('npub', ''));
        }
      } catch (error) {
        console.error('Failed to decode site Nostr keys:', error);
        // Fall back to auto-generation or provided keys
        fallbackToUserKeys();
      }
    } else {
      // Fall back to user-provided keys or auto-generation
      fallbackToUserKeys();
    }
    
    function fallbackToUserKeys() {
      // Auto-generate keys if requested
      if (options.autoGenerateKeys && !options.secretKey) {
        const { publicKey: pubKey } = serviceRef.current!.generateKeys();
        setPublicKey(pubKey);
        
        // Store keys in localStorage for persistence
        const keys = safeLocalStorage.getItem('nostr_keys');
        if (!keys) {
          safeLocalStorage.setItem('nostr_keys', JSON.stringify({ publicKey: pubKey }));
        }
      } else if (options.secretKey) {
        // Use provided secret key
        serviceRef.current!.setKeys(options.secretKey);
      }
    }

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.close();
      }
    };
  }, [options.relays, options.secretKey, options.autoGenerateKeys]);

  // Generate new keys
  const generateKeys = useCallback(() => {
    if (!serviceRef.current) return;
    
    const { publicKey: pubKey, secretKey } = serviceRef.current.generateKeys();
    setPublicKey(pubKey);
    
    // Store in localStorage
    safeLocalStorage.setItem('nostr_keys', JSON.stringify({ 
      publicKey: pubKey,
      // Note: In production, you'd want to encrypt the secret key
      // or use a proper key management solution
      secretKey: Array.from(secretKey)
    }));
  }, []);

  // Set secret key
  const setSecretKey = useCallback((key: Uint8Array) => {
    if (!serviceRef.current) return;
    
    serviceRef.current.setKeys(key);
    // Use getPublicKey from nostr-tools to get the public key
    const pubKey = getPublicKey(key);
    setPublicKey(pubKey);
  }, []);

  // Post a boost
  const postBoost = useCallback(async (
    amount: number,
    track: TrackMetadata,
    comment?: string
  ): Promise<BoostResult> => {
    if (!serviceRef.current) {
      return {
        event: {} as Event,
        eventId: '',
        success: false,
        error: 'Service not initialized'
      };
    }

    setIsPosting(true);
    setError(null);

    try {
      const result = await serviceRef.current.postBoost({
        amount,
        track,
        comment,
        tags: track.artist ? [`#${track.artist.replace(/\s+/g, '')}`, `#nowplaying`] : [`#nowplaying`]
      });

      if (result.success) {
        // Add to history
        setBoostHistory(prev => [result.event, ...prev]);
        
        // Store in localStorage for persistence
        const stored = safeLocalStorage.getItem('boost_history');
        const history = stored ? JSON.parse(stored) : [];
        history.unshift(result.event);
        // Keep only last 50 boosts
        safeLocalStorage.setItem('boost_history', JSON.stringify(history.slice(0, 50)));
        
        // Trigger a custom event for other components to listen to
        window.dispatchEvent(new CustomEvent('newBoost', { 
          detail: { event: result.event, track, amount, comment } 
        }));
      } else {
        setError(result.error || 'Failed to post boost');
      }

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to post boost';
      setError(errorMsg);
      return {
        event: {} as Event,
        eventId: '',
        success: false,
        error: errorMsg
      };
    } finally {
      setIsPosting(false);
    }
  }, []);

  // Subscribe to live boosts
  const subscribeToBoosts = useCallback((trackTitle?: string, artist?: string) => {
    if (!serviceRef.current) return;
    
    if (subscriptionRef.current) {
      subscriptionRef.current.close();
    }

    const filters: Parameters<typeof serviceRef.current.subscribeToBoosts>[0] = {};
    
    if (trackTitle) {
      filters.tracks = [{ title: trackTitle, artist }];
    }

    subscriptionRef.current = serviceRef.current.subscribeToBoosts(filters, {
      onBoost: (event) => {
        setBoostHistory(prev => {
          // Check if event already exists
          const exists = prev.some(e => e.id === event.id);
          if (exists) return prev;
          
          // Add new boost to the beginning
          return [event, ...prev];
        });
      },
      onError: (err) => {
        console.error('Boost subscription error:', err);
        setError(err.message);
      }
    });

    setIsSubscribed(true);
  }, []);

  // Unsubscribe from live boosts
  const unsubscribe = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.close();
      subscriptionRef.current = null;
      setIsSubscribed(false);
    }
  }, []);

  // Load boost history from localStorage on mount
  useEffect(() => {
    const stored = safeLocalStorage.getItem('boost_history');
    if (stored) {
      try {
        const history = JSON.parse(stored);
        setBoostHistory(history);
      } catch (err) {
        console.error('Failed to load boost history:', err);
      }
    }
  }, []);

  return {
    postBoost,
    boostHistory,
    isPosting,
    error,
    publicKey,
    generateKeys,
    setSecretKey,
    subscribeToBoosts,
    unsubscribe,
    isSubscribed
  };
}