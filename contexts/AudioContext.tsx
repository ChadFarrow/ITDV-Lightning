'use client';

import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { toast } from '@/components/Toast';
import { makeAutoBoostPayment } from '@/utils/payment-utils';
import { useBoostToNostr } from '@/hooks/useBoostToNostr';

interface Track {
  title: string;
  duration: string;
  url: string;
  videoUrl?: string; // Video enclosure URL (HLS .m3u8 files)
  trackNumber: number;
  image?: string;
  artist?: string;
  album?: string;
  website?: string;
  value?: {
    type: string;
    method: string;
    suggested?: string;
    recipients: Array<{
      type: string;
      address: string;
      split: number;
      name?: string;
      fee?: boolean;
      customKey?: string;
      customValue?: string;
    }>;
  };
  // Podcast GUIDs for Nostr boost tagging
  guid?: string;
  podcastGuid?: string; // podcast:guid at item level
  feedGuid?: string;
  feedUrl?: string;
  publisherGuid?: string;
  publisherUrl?: string;
  imageUrl?: string;
}

interface AudioContextType {
  // Current track info
  currentTrack: Track | null;
  currentAlbum: string | null;
  
  // Playback state
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  
  // Playlist
  playlist: Track[];
  currentTrackIndex: number;
  isShuffling: boolean;
  isRepeating: boolean;
  
  // Auto Boost
  isAutoBoostEnabled: boolean;
  autoBoostAmount: number;
  toggleAutoBoost: () => void;
  setAutoBoostAmount: (amount: number) => void;
  
  // Now Playing Screen
  isNowPlayingOpen: boolean;
  openNowPlaying: () => void;
  closeNowPlaying: () => void;
  
  // Actions
  playTrack: (track: Track, album?: string) => void;
  playAlbum: (tracks: Track[], startIndex?: number, album?: string) => void;
  playAlbumAndOpenNowPlaying: (tracks: Track[], startIndex?: number, album?: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  nextTrack: () => void;
  previousTrack: () => void;
  seekTo: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
}

const AudioContext = createContext<AudioContextType | undefined>(undefined);

export const useAudio = () => {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error('useAudio must be used within an AudioProvider');
  }
  return context;
};

export const AudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [currentAlbum, setCurrentAlbum] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isShuffling, setIsShuffling] = useState(false);
  const [isRepeating, setIsRepeating] = useState(false);
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  
  // Auto Boost state - hardcoded to 25 sats for testing
  const [isAutoBoostEnabled, setIsAutoBoostEnabled] = useState(false);
  const [autoBoostAmount, setAutoBoostAmount] = useState(25);

  // Initialize Nostr boost system for auto boosts
  const { postBoost, generateKeys, publicKey } = useBoostToNostr({ 
    autoGenerateKeys: typeof window !== 'undefined'
  });

  // Initialize audio element
  useEffect(() => {
    audioRef.current = new Audio();
    const audio = audioRef.current;

    // Set iOS-specific attributes for background playback
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    audio.setAttribute('preload', 'auto');
    // Removed crossorigin='anonymous' - causes CORS issues with external audio files
    // Only set if needed for specific CORS-enabled sources

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDurationChange = () => setDuration(audio.duration);
    const handleLoadStart = () => setCurrentTime(0);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('loadstart', handleLoadStart);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('loadstart', handleLoadStart);
    };
  }, []);

  // Helper function to get proxied URL for audio files that need CORS
  const getProxiedAudioUrl = (url: string): string => {
    // Proxy external audio files to avoid CORS issues
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      try {
        const urlObj = new URL(url);
        // Proxy external domains (not same origin)
        if (urlObj.hostname !== window.location.hostname) {
          return `/api/proxy-audio?url=${encodeURIComponent(url)}`;
        }
      } catch (e) {
        // Invalid URL, return as-is
      }
    }
    return url;
  };

  const playTrack = (track: Track, album?: string) => {
    if (!audioRef.current) return;

    setCurrentTrack(track);
    setCurrentAlbum(album || null);
    setPlaylist([track]);
    setCurrentTrackIndex(0);
    
    audioRef.current.src = getProxiedAudioUrl(track.url);
    audioRef.current.load();
    audioRef.current.play().catch(error => {
      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        console.log('Audio loading was cancelled (expected behavior)');
      } else {
        console.warn('Audio playback error:', error);
      }
    });
    setIsPlaying(true);

    // Update Media Session API
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist || 'Unknown Artist',
        album: album || undefined,
        artwork: track.image ? [
          { src: track.image, sizes: '512x512', type: 'image/png' }
        ] : []
      });
    }
  };

  const playAlbum = (tracks: Track[], startIndex = 0, album?: string) => {
    if (!audioRef.current || tracks.length === 0) return;

    const track = tracks[startIndex];
    setCurrentTrack(track);
    setCurrentAlbum(album || null);
    setPlaylist(tracks);
    setCurrentTrackIndex(startIndex);
    
    audioRef.current.src = getProxiedAudioUrl(track.url);
    audioRef.current.load();
    audioRef.current.play().catch(error => {
      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        console.log('Audio loading was cancelled (expected behavior)');
      } else {
        console.warn('Audio playback error:', error);
      }
    });
    setIsPlaying(true);

    // Update Media Session API
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist || 'Unknown Artist',
        album: album || undefined,
        artwork: track.image ? [
          { src: track.image, sizes: '512x512', type: 'image/png' }
        ] : []
      });
    }
  };

  const playAlbumAndOpenNowPlaying = (tracks: Track[], startIndex = 0, album?: string) => {
    playAlbum(tracks, startIndex, album);
    setIsNowPlayingOpen(true);
  };

  const openNowPlaying = () => {
    setIsNowPlayingOpen(true);
  };

  const closeNowPlaying = () => {
    setIsNowPlayingOpen(false);
  };

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const resume = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play().catch(error => {
        if (error.name === 'AbortError' || error.message.includes('aborted')) {
          console.log('Audio loading was cancelled (expected behavior)');
        } else {
          console.warn('Audio playback error:', error);
        }
      });
      setIsPlaying(true);
    }
  }, []);

  const stop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      setCurrentTime(0);
    }
  };

  const nextTrack = useCallback((forcePlay: boolean = false) => {
    if (playlist.length === 0) return;

    let nextIndex: number;
    
    if (isShuffling && playlist.length > 1) {
      // Get random track that's not the current one
      do {
        nextIndex = Math.floor(Math.random() * playlist.length);
      } while (nextIndex === currentTrackIndex);
    } else {
      nextIndex = currentTrackIndex + 1;
      if (nextIndex >= playlist.length) {
        nextIndex = 0; // Loop back to start
      }
    }

    const nextTrack = playlist[nextIndex];
    setCurrentTrack(nextTrack);
    setCurrentTrackIndex(nextIndex);
    
    if (audioRef.current) {
      audioRef.current.src = getProxiedAudioUrl(nextTrack.url);
      audioRef.current.load();
      // Always try to play if forcePlay is true (from ended handler) or if currently playing
      if (forcePlay || isPlaying) {
        // Use a small delay to ensure the audio element is ready, especially on iOS
        const playPromise = audioRef.current.play().catch(error => {
          // Silently handle expected audio loading errors (user navigation, network issues, etc.)
          if (error.name === 'AbortError' || error.message.includes('aborted')) {
            console.log('Audio loading was cancelled (expected behavior)');
          } else {
            console.warn('Audio playback error:', error);
          }
        });
        
        // Update playing state after play promise resolves
        if (forcePlay || isPlaying) {
          playPromise.then(() => {
            setIsPlaying(true);
          }).catch(() => {
            // If play fails, don't update state
          });
        }
      }
    }

    // Update Media Session API
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: nextTrack.title,
        artist: nextTrack.artist || 'Unknown Artist',
        album: nextTrack.album || currentAlbum || undefined,
        artwork: nextTrack.image ? [
          { src: nextTrack.image, sizes: '512x512', type: 'image/png' }
        ] : []
      });
      
      // Set playback state to playing when transitioning tracks
      if (forcePlay || isPlaying) {
        navigator.mediaSession.playbackState = 'playing';
      }
    }
  }, [playlist, currentTrackIndex, isShuffling, isPlaying, currentAlbum]);

  const previousTrack = useCallback(() => {
    if (playlist.length === 0) return;

    let prevIndex = currentTrackIndex - 1;
    if (prevIndex < 0) {
      prevIndex = playlist.length - 1; // Loop to end
    }

    const prevTrack = playlist[prevIndex];
    setCurrentTrack(prevTrack);
    setCurrentTrackIndex(prevIndex);
    
    if (audioRef.current) {
      audioRef.current.src = getProxiedAudioUrl(prevTrack.url);
      audioRef.current.load();
      if (isPlaying) {
        audioRef.current.play().catch(error => {
          if (error.name === 'AbortError' || error.message.includes('aborted')) {
            console.log('Audio loading was cancelled (expected behavior)');
          } else {
            console.warn('Audio playback error:', error);
          }
        });
      }
    }

    // Update Media Session API
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: prevTrack.title,
        artist: prevTrack.artist || 'Unknown Artist',
        album: prevTrack.album || currentAlbum || undefined,
        artwork: prevTrack.image ? [
          { src: prevTrack.image, sizes: '512x512', type: 'image/png' }
        ] : []
      });
    }
  }, [playlist, currentTrackIndex, isPlaying, currentAlbum]);

  // Make triggerAutoBoost a useCallback to avoid recreation
  const triggerAutoBoost = useCallback(async (track: Track) => {
    try {
      console.log('🚀 Auto boost triggered for:', track.title);
      
      // Get payment recipients from track or album data (same logic as manual boost)
      const getPaymentRecipients = () => {
        let recipients: any[] = [];
        
        // Check if current track has value data
        if (track.value && track.value.recipients && track.value.recipients.length > 0) {
          recipients = track.value.recipients
            .filter((r: any) => r.address && r.split > 0)
            .map((r: any) => ({
              address: r.address,
              split: r.split,
              name: r.name,
              fee: r.fee,
              type: 'node'
            }));
          console.log('✅ Using track-level podcast:value recipients for auto boost');
        }
        
        // Add your 2 sat fee to auto boost payments
        recipients.push({
          address: '03740ea02585ed87b83b2f76317a4562b616bd7b8ec3f925be6596932b2003fc9e',
          split: 0, // Will be overridden by fixedAmount
          fixedAmount: 2, // Fixed 2 sats
          name: 'ITDV Lightning Platform Fee',
          fee: true,
          type: 'node'
        });
        
        return recipients.length > 0 ? recipients : null;
      };

      // Get fallback recipient (same as manual boost)
      const getFallbackRecipient = () => {
        return '03740ea02585ed87b83b2f76317a4562b616bd7b8ec3f925be6596932b2003fc9e';
      };

      // Create boost metadata
      const boostMetadata = {
        title: track.title || 'Unknown Song',
        artist: track.artist || 'Unknown Artist',
        album: track.album || (currentAlbum !== 'Shuffle All' ? currentAlbum : undefined) || undefined, // Use track's actual album, avoid 'Shuffle All'
        episode: track.title,
        url: track.album ? `https://itdv.podtards.com/album/${encodeURIComponent(track.album)}#${encodeURIComponent(track.title || '')}` : 'https://itdv.podtards.com',
        appName: 'ITDV Lightning',
        timestamp: Math.floor(currentTime),
        senderName: 'Auto Boost', // Identify as auto boost
        // No message for auto boosts to keep TLVs clean
        itemGuid: track.guid,
        podcastGuid: track.podcastGuid,
        podcastFeedGuid: track.feedGuid,
        feedUrl: track.feedUrl,
        publisherGuid: track.publisherGuid,
        publisherUrl: track.publisherUrl,
        imageUrl: track.imageUrl
      };

      // Make the payment
      const paymentResult = await makeAutoBoostPayment({
        amount: autoBoostAmount,
        description: `Auto boost for ${track.title || 'Unknown Song'} by ${track.artist || 'Unknown Artist'}`,
        recipients: getPaymentRecipients() || undefined,
        fallbackRecipient: getFallbackRecipient(),
        boostMetadata
      });

      if (paymentResult.success) {
        // Post to Nostr after successful Lightning payment
        try {
          const trackMetadata = {
            title: track.title,
            artist: track.artist,
            album: track.album || (currentAlbum !== 'Shuffle All' ? currentAlbum : undefined) || undefined, // Use track's actual album, avoid 'Shuffle All'
            url: track.album ? `https://itdv.podtards.com/album/${encodeURIComponent(track.album)}#${encodeURIComponent(track.title || '')}` : 'https://itdv.podtards.com',
            imageUrl: track.imageUrl || track.image,
            timestamp: Math.floor(currentTime),
            duration: duration ? Math.floor(duration) : undefined,
            senderName: 'Auto Boost',
            guid: track.guid,
            podcastGuid: track.podcastGuid,
            feedGuid: track.feedGuid,
            feedUrl: track.feedUrl,
            publisherGuid: track.publisherGuid,
            publisherUrl: track.publisherUrl
          };

          const nostrResult = await postBoost(
            autoBoostAmount,
            trackMetadata,
            `Auto boost for "${track.title}"` // Identify auto boost in Nostr
          );

          if (nostrResult.success) {
            console.log('✅ Auto boost posted to Nostr:', nostrResult.eventId);
          } else {
            console.warn('⚠️ Auto boost Nostr post failed:', nostrResult.error);
          }
        } catch (nostrError) {
          console.warn('⚠️ Auto boost Nostr post failed:', nostrError);
        }

        toast.success(`⚡ Auto boosted "${track.title}" with ${autoBoostAmount} sats!`, 3000);
        console.log('✅ Auto boost payment successful:', paymentResult.results);
      } else {
        throw new Error(paymentResult.error || 'Auto boost payment failed');
      }
      
    } catch (error) {
      console.error('Auto boost failed:', error);
      toast.error(`Auto boost failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [autoBoostAmount, currentAlbum, currentTime, duration, postBoost]);

  // Handle track ended event - needs to be after nextTrack is declared
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => {
      // Trigger auto boost if enabled and we have a current track
      if (isAutoBoostEnabled && currentTrack) {
        triggerAutoBoost(currentTrack);
      }
      
      if (isRepeating) {
        audio.currentTime = 0;
        // Always try to play when repeating, even on iOS when locked
        const playPromise = audio.play().catch(error => {
          if (error.name === 'AbortError' || error.message.includes('aborted')) {
            console.log('Audio loading was cancelled (expected behavior)');
          } else {
            console.warn('Audio playback error on repeat:', error);
          }
        });
        playPromise.then(() => {
          setIsPlaying(true);
        }).catch(() => {
          // If play fails, don't update state
        });
      } else {
        // Force play the next track when current track ends (important for iOS locked screen)
        nextTrack(true);
      }
    };

    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('ended', handleEnded);
    };
  }, [isRepeating, nextTrack, isAutoBoostEnabled, currentTrack, triggerAutoBoost]);

  const seekTo = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const setVolume = (newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clampedVolume);
    if (audioRef.current) {
      audioRef.current.volume = clampedVolume;
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
    }
  };

  const toggleShuffle = () => {
    setIsShuffling(!isShuffling);
  };

  const toggleRepeat = () => {
    setIsRepeating(!isRepeating);
  };

  // Auto Boost functions
  const toggleAutoBoost = () => {
    setIsAutoBoostEnabled(!isAutoBoostEnabled);
    if (!isAutoBoostEnabled) {
      toast.success('🔥 Auto boost enabled! Songs will auto boost 25 sats when finished');
    } else {
      toast.info('Auto boost disabled');
    }
  };

  // Media Session API handlers - after all functions are declared
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        resume();
        navigator.mediaSession.playbackState = 'playing';
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        pause();
        navigator.mediaSession.playbackState = 'paused';
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => previousTrack());
      navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack(true));
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
          seekTo(details.seekTime);
        }
      });
    }
  }, [resume, pause, previousTrack, nextTrack, seekTo]);
  
  // Update Media Session playback state when isPlaying changes
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying]);

  const value: AudioContextType = {
    currentTrack,
    currentAlbum,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    playlist,
    currentTrackIndex,
    isShuffling,
    isRepeating,
    isNowPlayingOpen,
    openNowPlaying,
    closeNowPlaying,
    playTrack,
    playAlbum,
    playAlbumAndOpenNowPlaying,
    pause,
    resume,
    stop,
    nextTrack,
    previousTrack,
    seekTo,
    setVolume,
    toggleMute,
    toggleShuffle,
    toggleRepeat,
    isAutoBoostEnabled,
    autoBoostAmount,
    toggleAutoBoost,
    setAutoBoostAmount,
  };

  return (
    <AudioContext.Provider value={value}>
      {children}
    </AudioContext.Provider>
  );
};