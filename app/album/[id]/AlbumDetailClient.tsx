'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { ArrowLeft, Play, Pause, SkipBack, SkipForward, Volume2, Zap, Video, Info } from 'lucide-react';
import { useAudio } from '@/contexts/AudioContext';
import { useVideo } from '@/contexts/VideoContext';
import { useLightning } from '@/contexts/LightningContext';
import VideoPlayer from '@/components/VideoPlayer';
import { BitcoinConnectPayment } from '@/components/BitcoinConnect';
import type { RSSValue } from '@/lib/rss-parser';
import dynamic from 'next/dynamic';
import { filterPodrollItems } from '@/lib/podroll-utils';
import confetti from 'canvas-confetti';
import PerformanceMonitor from '@/components/PerformanceMonitor';

// Dynamic import for ControlsBar
const ControlsBar = dynamic(() => import('@/components/ControlsBar'), {
  loading: () => (
    <div className="mb-8 p-4 bg-gray-800/20 rounded-lg animate-pulse">
      <div className="flex items-center gap-4">
        <div className="h-8 bg-gray-700/50 rounded w-24"></div>
        <div className="h-8 bg-gray-700/50 rounded w-20"></div>
        <div className="h-8 bg-gray-700/50 rounded w-16"></div>
        <div className="h-8 bg-gray-700/50 rounded w-20"></div>
      </div>
    </div>
  ),
  ssr: true
});

interface Track {
  title: string;
  duration: string;
  url: string;
  videoUrl?: string; // Video enclosure URL (HLS .m3u8 files)
  trackNumber: number;
  image?: string;
  value?: RSSValue; // Track-level podcast:value data
  paymentRecipients?: Array<{ address: string; split: number; name?: string; fee?: boolean }>; // Pre-processed track payment recipients
  startTime?: number; // Chapter/segment start time in seconds
  endTime?: number; // Chapter/segment end time in seconds
  // Podcast GUIDs for Nostr boost tagging
  guid?: string; // Standard item GUID
  podcastGuid?: string; // podcast:guid at item level
  feedGuid?: string; // Feed-level GUID
  feedUrl?: string; // Feed URL for this track
  publisherGuid?: string; // Publisher GUID
  publisherUrl?: string; // Publisher URL
  imageUrl?: string; // Track artwork URL
}

interface RSSFunding {
  url: string;
  message?: string;
}

interface RSSPodRoll {
  url: string;
  title?: string;
  description?: string;
}

interface PodrollAlbum {
  title: string;
  artist: string;
  coverArt: string;
  url: string;
}

interface Album {
  title: string;
  artist: string;
  description: string;
  coverArt: string;
  tracks: Track[];
  releaseDate: string;
  feedId: string;
  feedUrl?: string;
  funding?: RSSFunding[];
  podroll?: RSSPodRoll[];
  value?: RSSValue;
  publisher?: {
    feedGuid: string;
    feedUrl: string;
    medium: string;
  };
  paymentRecipients?: Array<{ address: string; split: number; name?: string; fee?: boolean }>;
  // Podcast GUIDs for Nostr boost tagging
  feedGuid?: string; // Feed-level GUID
  publisherGuid?: string; // Publisher GUID
  publisherUrl?: string; // Publisher URL
  imageUrl?: string; // Album artwork URL
}

interface AlbumDetailClientProps {
  albumTitle: string;
  initialAlbum: Album | null;
}

export default function AlbumDetailClient({ albumTitle, initialAlbum }: AlbumDetailClientProps) {
  const params = useParams();
  const albumId = (params?.id as string) || '';
  const { isLightningEnabled } = useLightning();
  const [album, setAlbum] = useState<Album | null>(initialAlbum);
  const [isLoading, setIsLoading] = useState(!initialAlbum);
  const [error, setError] = useState<string | null>(null);
  const [relatedAlbums, setRelatedAlbums] = useState<Album[]>([]);
  const [podrollAlbums, setPodrollAlbums] = useState<PodrollAlbum[]>([]);
  const [siteAlbums, setSiteAlbums] = useState<Album[]>([]);
  const [senderName, setSenderName] = useState('');
  const [boostAmount, setBoostAmount] = useState(50);
  const [boostMessage, setBoostMessage] = useState('');
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [showTrackBoostModal, setShowTrackBoostModal] = useState(false);
  const [trackBoostAmount, setTrackBoostAmount] = useState(50);
  const [trackBoostMessage, setTrackBoostMessage] = useState('');
  const [showTrackSplits, setShowTrackSplits] = useState(false);
  
  // Album boost modal state
  const [showAlbumBoostModal, setShowAlbumBoostModal] = useState(false);
  const [showAlbumSplits, setShowAlbumSplits] = useState(false);
  
  // Request deduplication refs
  const loadingAlbumsRef = useRef(false);
  const loadingRelatedRef = useRef(false);
  const lastInitialAlbumTitleRef = useRef<string | null>(null);
  const videoLoadAttemptedRef = useRef(false);
  const loadAlbumWithRefreshCalledRef = useRef(false);
  
  
  // Global audio context
  const { 
    playAlbum: globalPlayAlbum, 
    currentTrack,
    isPlaying: globalIsPlaying,
    pause: globalPause,
    resume: globalResume,
    toggleShuffle
  } = useAudio();

  // Global video context
  const videoContext = useVideo();
  const {
    playVideo: globalPlayVideo,
    currentVideo,
    isPlaying: isVideoPlaying,
    pause: pauseVideo,
    resume: resumeVideo,
    updateCurrentTime,
    updateDuration
  } = videoContext;

  // Video playback state
  const [playingVideoTrack, setPlayingVideoTrack] = useState<Track | null>(null);
  const videoPlayerRef = useRef<HTMLDivElement>(null);
  
  // Track view state (audio or video)
  const [trackView, setTrackView] = useState<'audio' | 'video'>('audio');

  // Lightning payment handlers
  const handleBoostSuccess = (response: any) => {
    setShowAlbumBoostModal(false);
    setBoostMessage(''); // Clear the message input after successful boost
    
    // Trigger multiple confetti bursts for dramatic effect
    const count = 200;
    const defaults = {
      origin: { y: 0.7 },
      colors: ['#FFD700', '#FFA500', '#FF8C00', '#FFE55C', '#FFFF00']
    };

    function fire(particleRatio: number, opts: any) {
      confetti(Object.assign({}, defaults, opts, {
        particleCount: Math.floor(count * particleRatio)
      }));
    }

    fire(0.25, {
      spread: 26,
      startVelocity: 55,
    });
    fire(0.2, {
      spread: 60,
    });
    fire(0.35, {
      spread: 100,
      decay: 0.91,
      scalar: 0.8
    });
    fire(0.1, {
      spread: 120,
      startVelocity: 25,
      decay: 0.92,
      scalar: 1.2
    });
    fire(0.1, {
      spread: 120,
      startVelocity: 45,
    });
  };

  const handleBoostError = (error: string) => {
    console.error('❌ Boost failed:', error);
  };

  // Get Lightning payment recipients from pre-processed server-side data
  // Payment recipients are pre-processed during RSS parsing and stored in the album/track objects
  // Memoize payment recipients to prevent render loop
  const paymentRecipients = useMemo(() => {
    if (!album) return null;
    
    // Use pre-processed payment recipients from server-side parsing (preferred)
    if (album.paymentRecipients && album.paymentRecipients.length > 0) {
      return album.paymentRecipients;
    }
    
    // Fallback: Check for album-level value.recipients (for backwards compatibility)
    const valueRecipients = album.value?.recipients;
    if (valueRecipients && valueRecipients.length > 0) {
      // Convert RSSValue recipients format to paymentRecipients format
      return valueRecipients
        .filter((r: any) => r.type === 'node')
        .map((r: any) => ({
          address: r.address,
          split: r.split,
          name: r.name,
          fee: r.fee
        }));
    }
    
    return null; // Will use fallback single recipient
  }, [album]);

  // Get Lightning payment recipients for a specific track
  // Payment recipients are pre-processed during RSS parsing and stored in track objects
  // For video tracks, use the corresponding audio track's recipients (not album-level)
  const getTrackPaymentRecipients = (track: Track): Array<{ address: string; split: number; name?: string; fee?: boolean; type?: string; fixedAmount?: number }> | null => {
    if (!track) {
      return null;
    }
    
    // Special case: Autumn Rust uses specific recipients for all boosts
    if (album && album.title && album.title.toLowerCase().includes('autumn rust')) {
      return [
        {
          address: '03b6f613e88bd874177c28c6ad83b3baba43c4c656f56be1f8df84669556054b79',
          split: 1,
          name: 'boostbot@fountain.fm',
          type: 'node'
        },
        {
          address: '03589f3ddb81f3802f3fc9aaa359b684ed19840b55db88f7c9c2cc671e74ac93e2',
          split: 1,
          name: 'ThunderRoad',
          type: 'node'
        },
        {
          address: '02c7bb6f29f09d92d40d62d64443b688891259dea324406b4678df6235794f24bf',
          split: 1,
          name: 'ericpp@getalby.com',
          type: 'node'
        },
        {
          address: '03d55f4d4c870577e98ac56605a54c5ed20c8897e41197a068fd61bdb580efaa67',
          split: 1,
          name: 'BoostBot',
          type: 'node'
        },
        {
          address: '035ad2c954e264004986da2d9499e1732e5175e1dcef2453c921c6cdcc3536e9d8',
          split: 1,
          name: 'steven@getalby.com',
          type: 'node'
        },
        {
          address: '031ce2f133b570edf1c776e571e27d22a715dc6ea73956f0e79f4272d81d9dc0d5',
          split: 95,
          name: 'DoerfelVerse_Node',
          type: 'node'
        }
      ];
    }
    
    // Special case: The Satellite Spotlight uses specific recipients for all boosts
    if (album && album.title && album.title.toLowerCase().includes('satellite spotlight')) {
      return [
        {
          address: '031ce2f133b570edf1c776e571e27d22a715dc6ea73956f0e79f4272d81d9dc0d5',
          split: 95,
          name: 'DoerfelVerse_Node',
          type: 'node'
        },
        {
          address: '02c7bb6f29f09d92d40d62d64443b688891259dea324406b4678df6235794f24bf',
          split: 1,
          name: 'Ericpp',
          type: 'node'
        },
        {
          address: '035ad2c954e264004986da2d9499e1732e5175e1dcef2453c921c6cdcc3536e9d8',
          split: 1,
          name: 'steven@getalby.com',
          type: 'node'
        },
        {
          address: '03589f3ddb81f3802f3fc9aaa359b684ed19840b55db88f7c9c2cc671e74ac93e2',
          split: 1,
          name: 'ThunderRoad',
          type: 'node'
        },
        {
          address: '03b6f613e88bd874177c28c6ad83b3baba43c4c656f56be1f8df84669556054b79',
          split: 1,
          name: 'boostbot@fountain.fm',
          type: 'node'
        },
        {
          address: '03ae9f91a0cb8ff43840e3c322c4c61f019d8c1c3cea15a25cfc425ac605e61a4a',
          split: 1,
          name: 'Podcastindex.org',
          type: 'node'
        }
      ];
    }
    
    // First, try to find the track in the album to get the most up-to-date properties
    // This ensures we have the correct videoUrl and paymentRecipients
    if (album && album.tracks) {
      const albumTrack = album.tracks.find((t: Track) => 
        t.title.trim().toLowerCase() === track.title.trim().toLowerCase()
      );
      if (albumTrack) {
        // Use the album track's properties (more up-to-date)
        track = albumTrack;
      }
    }
    
    // Check if this track is a video track (either has videoUrl directly, or exists in album with videoUrl)
    let isVideoTrack = !!track.videoUrl;
    if (!isVideoTrack && album) {
      // Check if a track with the same title exists in album and has videoUrl
      const albumTrack = album.tracks?.find((t: Track) => 
        t.title.trim().toLowerCase() === track.title.trim().toLowerCase() && t.videoUrl
      );
      if (albumTrack) {
        isVideoTrack = true;
      }
    }
    
    // For video tracks, ALWAYS find the corresponding audio track and use its recipients
    // This ensures videos use track-level splits (e.g., 5 recipients) instead of album-level (e.g., 317 recipients)
    // Video tracks may have album-level recipients set, so we skip them and look for the audio track
    if (isVideoTrack && album) {
      // Find the corresponding audio track (same title, no videoUrl)
      // Use case-insensitive comparison and trim whitespace for better matching
      // For CityBeach, the video track is "CityBeach" but audio tracks are "CityBeach - Tomorrow", etc.
      // So we need to match tracks that start with the video track's title
      const videoTitleNormalized = track.title.trim().toLowerCase();
      
      // First, try to find exact match
      let correspondingAudioTrack = album.tracks?.find((t: Track) => {
        const audioTitleNormalized = t.title.trim().toLowerCase();
        return audioTitleNormalized === videoTitleNormalized && !t.videoUrl;
      });
      
      // If no exact match, try prefix match (e.g., "CityBeach" matches "CityBeach - Tomorrow")
      // Prioritize tracks that have track-level payment recipients (not album-level)
      if (!correspondingAudioTrack) {
        const matchingTracks = album.tracks?.filter((t: Track) => {
          if (t.videoUrl) return false;
          const audioTitleNormalized = t.title.trim().toLowerCase();
          return (
            audioTitleNormalized.startsWith(videoTitleNormalized + ' ') ||
            audioTitleNormalized.startsWith(videoTitleNormalized + '-') ||
            audioTitleNormalized.startsWith(videoTitleNormalized + ' -')
          );
        }) || [];
        
        // Prioritize tracks that have track-level payment recipients (not album-level)
        // Track-level recipients are typically 5-6 recipients, album-level are 300+
        correspondingAudioTrack = matchingTracks.find((t: Track) => {
          const hasTrackLevelRecipients = t.paymentRecipients && t.paymentRecipients.length > 0 && t.paymentRecipients.length < 50;
          const hasTrackLevelValue = t.value?.recipients && t.value.recipients.length > 0 && t.value.recipients.length < 50;
          return hasTrackLevelRecipients || hasTrackLevelValue;
        });
        
        // If no track with track-level recipients, use the first matching track
        if (!correspondingAudioTrack && matchingTracks.length > 0) {
          correspondingAudioTrack = matchingTracks[0];
        }
      }
      
      if (correspondingAudioTrack) {
        // Use the audio track's payment recipients (preferred)
        if (correspondingAudioTrack.paymentRecipients && correspondingAudioTrack.paymentRecipients.length > 0) {
          return correspondingAudioTrack.paymentRecipients;
        }
        
        // Check audio track's value.recipients as fallback
        const audioTrackValueRecipients = correspondingAudioTrack.value?.recipients;
        if (audioTrackValueRecipients && audioTrackValueRecipients.length > 0) {
          return audioTrackValueRecipients
            .filter((r: any) => r.type === 'node')
            .map((r: any) => ({
              address: r.address,
              split: r.split,
              name: r.name,
              fee: r.fee
            }));
        }
      }
    }
    
    // For non-video tracks, use pre-processed track payment recipients from server-side parsing (preferred)
    if (track.paymentRecipients && track.paymentRecipients.length > 0) {
      return track.paymentRecipients;
    }
    
    // Fallback: Check for track-level value.recipients (for backwards compatibility)
    const trackValueRecipients = track.value?.recipients;
    if (trackValueRecipients && trackValueRecipients.length > 0) {
      // Convert RSSValue recipients format to paymentRecipients format
      return trackValueRecipients
        .filter((r: any) => r.type === 'node')
        .map((r: any) => ({
          address: r.address,
          split: r.split,
          name: r.name,
          fee: r.fee
        }));
    }
    
    // Fallback to album-level payment recipients only if not a video track or no corresponding audio track found
    return paymentRecipients;
  };
  
  // Get fallback recipient for backwards compatibility
  const getFallbackRecipient = (): { address: string; amount: number } => {
    return {
      address: '03740ea02585ed87b83b2f76317a4562b616bd7b8ec3f925be6596932b2003fc9e',
      amount: 50
    };
  };
  
  // Check if album has video tracks (check both album and initialAlbum)
  const hasVideoTracks = useMemo(() => {
    const albumHasVideos = album?.tracks?.some(track => track.videoUrl) || false;
    const initialHasVideos = initialAlbum?.tracks?.some(track => track.videoUrl) || false;
    const hasVideos = albumHasVideos || initialHasVideos;
    
    return hasVideos;
  }, [album, initialAlbum]);
  
  // Filter tracks based on trackView (use album tracks, fallback to initialAlbum)
  const filteredTracks = useMemo(() => {
    const tracksToUse = album?.tracks || initialAlbum?.tracks || [];
    if (tracksToUse.length === 0) return [];
    
    if (trackView === 'video') {
      return tracksToUse.filter(track => track.videoUrl);
    } else {
      // 'audio' - show tracks without videoUrl
      return tracksToUse.filter(track => !track.videoUrl);
    }
  }, [album, initialAlbum, trackView]);
  
  // Background state
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [backgroundLoaded, setBackgroundLoaded] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const preloadAttemptedRef = useRef(false);

  useEffect(() => {
    setIsClient(true);
    
    const checkDevice = () => {
      setIsDesktop(window.innerWidth > 768);
    };
    
    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);


  // Load album data if not provided
  useEffect(() => {
    if (!initialAlbum) {
      loadAlbum();
      return;
    }
    
    // Only initialize once to prevent infinite loops
    const currentTitle = initialAlbum.title;
    if (lastInitialAlbumTitleRef.current === null) {
      // First time initialization
      lastInitialAlbumTitleRef.current = currentTitle;
      setAlbum(initialAlbum);
      setIsLoading(false);

      // Defer all non-critical data loading using requestIdleCallback for better performance
      // This prevents blocking the main content display and only loads when browser is idle
      const scheduleIdleTask = (callback: () => void, delay: number = 0) => {
        if ('requestIdleCallback' in window) {
          const timeoutId = setTimeout(() => {
            requestIdleCallback(callback, { timeout: 5000 });
          }, delay);
          return () => clearTimeout(timeoutId);
        } else {
          // Fallback for browsers without requestIdleCallback
          const timeoutId = setTimeout(callback, delay + 1000);
          return () => clearTimeout(timeoutId);
        }
      };

      // Load non-critical data only when browser is idle
      const cleanup1 = scheduleIdleTask(() => {
        loadSiteAlbums().catch(() => {
          // Silently handle errors
        });
      }, 1000);

      const cleanup2 = scheduleIdleTask(() => {
        loadRelatedAlbums().catch(() => {
          // Silently handle errors
        });
      }, 1500);

      const cleanup3 = scheduleIdleTask(() => {
        loadPodrollAlbums();
      }, 2000);

      return () => {
        cleanup1();
        cleanup2();
        cleanup3();
      };
    }
    // Don't update on subsequent renders - the album state is already set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount to prevent infinite loops

  // Load album to get video URLs (non-blocking, uses refresh=1 to fetch from RSS if missing from cache)
  const loadAlbumWithRefresh = useCallback(async () => {
    // Prevent multiple simultaneous calls
    if (loadAlbumWithRefreshCalledRef.current) {
      return;
    }
    loadAlbumWithRefreshCalledRef.current = true;
    
    try {
      // Use the actual URL parameter (albumId) if available, otherwise derive from title
      // Fallback to deriving from title if params not available (e.g., during SSR)
      const slugFromId = albumId && albumId.trim() ? albumId : null;
      const albumSlug = slugFromId || albumTitle
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')       // Remove punctuation except spaces and hyphens
        .replace(/\s+/g, '-')           // Replace spaces with dashes
        .replace(/-+/g, '-')            // Replace multiple consecutive dashes with single dash
        .replace(/^-+|-+$/g, '');       // Remove leading/trailing dashes
      
      // Use refresh=1 to force RSS parsing and get video URLs (only called when videos are missing)
      const apiUrl = `/api/album/${encodeURIComponent(albumSlug)}?refresh=1`;
      
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        console.error(`Failed to load album with videos: ${response.status} ${response.statusText}`);
        loadAlbumWithRefreshCalledRef.current = false; // Reset on error
        return;
      }

      const data = await response.json();
      
      if (data.album) {
        // Check if we got video URLs
        const hasNewVideoUrls = data.album.tracks?.some((track: Track) => track.videoUrl);
        
        // Use functional update to access current album state without dependency
        setAlbum(currentAlbum => {
          const currentHasVideoUrls = currentAlbum?.tracks?.some((track: Track) => track.videoUrl);
          
          // Only update if we got video URLs that were missing (prevents unnecessary updates)
          if (hasNewVideoUrls && !currentHasVideoUrls) {
            setError(null);
            return data.album;
          }
          return currentAlbum; // No change needed
        });
      }
    } catch (err) {
      console.error('Error loading album with videos:', err);
      loadAlbumWithRefreshCalledRef.current = false; // Reset on error
    }
  }, [albumTitle, albumId]); // Removed album to prevent infinite loop - we check current state inside the function

  // Separate useEffect for loading videos when missing from static cache
  useEffect(() => {
    if (!initialAlbum || videoLoadAttemptedRef.current) return;
    
    // Check if album should have video URLs but doesn't (static cache might be missing them)
    const albumsWithVideo = [
      'the-satellite-spotlight',
      'satellite-spotlight',
      'satellite-spotlight-sprouting-symphonies-citybeach-tracks',
      'autumn-rust',
      'autumn rust',
      'satellite-spotlight-autumn-rust-the-doerfels-tracks'
    ];
    
    // Use albumId from URL params if available, otherwise derive from title
    const albumSlugFromId = albumId || '';
    const albumSlugFromTitle = albumTitle
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    
    // Check both the URL slug and the title-derived slug
    const shouldHaveVideo = albumsWithVideo.some(videoAlbum => 
      albumSlugFromId.includes(videoAlbum) || 
      albumSlugFromTitle.includes(videoAlbum) || 
      albumTitle.toLowerCase().includes('satellite spotlight') ||
      albumTitle.toLowerCase().includes('autumn rust')
    );
    
    // Check if any tracks have video URLs
    const hasVideoUrls = initialAlbum.tracks?.some((track: Track) => track.videoUrl);
    
    // If album should have videos but doesn't, load them in background (non-blocking)
    if (shouldHaveVideo && !hasVideoUrls) {
      videoLoadAttemptedRef.current = true;
      // Load videos in background after page is fully rendered
      // Use longer delay to ensure page is interactive before making API call
      const loadVideos = () => {
        loadAlbumWithRefresh();
      };
      
      // Use requestIdleCallback with longer timeout to ensure page is fully loaded
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        const idleCallbackId = requestIdleCallback(loadVideos, { timeout: 2000 });
        return () => cancelIdleCallback(idleCallbackId);
      } else {
        // Delay to let initial render complete and page become interactive
        const timeoutId = setTimeout(loadVideos, 1000);
        return () => clearTimeout(timeoutId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount to prevent infinite loops

  // Separate useEffect for background image preloading to avoid re-running API calls
  useEffect(() => {
    if (initialAlbum && initialAlbum.coverArt && !preloadAttemptedRef.current) {
      preloadAttemptedRef.current = true;
      preloadBackgroundImage(initialAlbum);
    }
  }, [initialAlbum]);

  // Scroll to video player when it opens
  useEffect(() => {
    if (playingVideoTrack && playingVideoTrack.videoUrl && videoPlayerRef.current) {
      // Small delay to ensure the video player is rendered
      setTimeout(() => {
        videoPlayerRef.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }, 100);
    }
  }, [playingVideoTrack]);

  // Load saved sender name from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedSenderName = localStorage.getItem('boost-sender-name');
      if (savedSenderName) {
        setSenderName(savedSenderName);
      }
    }
  }, []);

  // Save sender name to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined' && senderName.trim()) {
      localStorage.setItem('boost-sender-name', senderName.trim());
    }
  }, [senderName]);

  const preloadBackgroundImage = async (albumData: Album) => {
    if (!albumData.coverArt) {
      setBackgroundLoaded(true);
      return;
    }
    
    try {
      const isGif = albumData.coverArt.toLowerCase().includes('.gif');
      
      // Add preload link to head for faster loading (browser will start downloading immediately)
      const preloadLink = document.createElement('link');
      preloadLink.rel = 'preload';
      preloadLink.as = 'image';
      preloadLink.href = albumData.coverArt;
      if ('fetchPriority' in preloadLink) {
        (preloadLink as any).fetchPriority = 'high';
      }
      document.head.appendChild(preloadLink);
      
      // Set background image URL immediately so it can start loading
      setBackgroundImage(albumData.coverArt);
      setBackgroundLoaded(true);
      
      // Also preload in an img element for better browser caching
      // For GIFs, use eager loading and high priority
      const img = document.createElement('img');
      img.decoding = 'async';
      img.loading = isGif ? 'eager' : 'lazy';
      if ('fetchPriority' in img) {
        (img as any).fetchPriority = 'high';
      }
      img.src = albumData.coverArt;
      // Don't wait for this - let it load in the background
    } catch (error) {
      // On error, still try to show the image
      setBackgroundImage(albumData.coverArt);
      setBackgroundLoaded(true);
    }
  };

  const loadAlbum = useCallback(async () => {
    try {
      setIsLoading(true);
      
      // Convert album title back to URL slug format for API call
      const albumSlug = albumTitle
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')       // Remove punctuation except spaces and hyphens
        .replace(/\s+/g, '-')           // Replace spaces with dashes
        .replace(/-+/g, '-')            // Replace multiple consecutive dashes with single dash
        .replace(/^-+|-+$/g, '');       // Remove leading/trailing dashes
      
      // Only refresh if explicitly requested via URL parameter
      // Don't force refresh for video albums - let the cache work
      const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      const hasRefreshParam = urlParams.get('refresh') === '1' || urlParams.get('nocache') === '1';
      
      // Use the new individual album endpoint that does live RSS parsing with GUID data
      // Only add refresh parameter if explicitly requested
      const apiUrl = hasRefreshParam
        ? `/api/album/${encodeURIComponent(albumSlug)}?refresh=1`
        : `/api/album/${encodeURIComponent(albumSlug)}`;
      
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        throw new Error('Failed to load album');
      }

      const data = await response.json();
      
      if (data.album) {
        setAlbum(data.album);
        setError(null);
        
        // Always set background image for vibrant album backgrounds
        if (data.album.coverArt && !preloadAttemptedRef.current) {
          preloadAttemptedRef.current = true;
          preloadBackgroundImage(data.album);
        }

        // Defer all non-critical data loading using requestIdleCallback
        const scheduleIdleTask = (callback: () => void, delay: number = 0) => {
          if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
            const timeoutId = setTimeout(() => {
              requestIdleCallback(callback, { timeout: 5000 });
            }, delay);
            return () => clearTimeout(timeoutId);
          } else {
            const timeoutId = setTimeout(callback, delay + 1000);
            return () => clearTimeout(timeoutId);
          }
        };

        scheduleIdleTask(() => {
          loadSiteAlbums().catch(() => {
            // Silently handle errors
          });
        }, 1000);

        scheduleIdleTask(() => {
          loadRelatedAlbums().catch(() => {
            // Silently handle errors
          });
        }, 1500);

        scheduleIdleTask(() => {
          loadPodrollAlbums();
        }, 2000);
      } else {
        setError('Album not found');
      }
    } catch (err) {
      console.error('Error loading album:', err);
      setError('Failed to load album');
    } finally {
      setIsLoading(false);
    }
  }, [albumTitle]);

  const loadSiteAlbums = useCallback(async () => {
    // Prevent duplicate requests
    if (loadingAlbumsRef.current) {
      return siteAlbums;
    }
    
    try {
      loadingAlbumsRef.current = true;
      // Use the lightweight albums endpoint to avoid RSS parsing overhead
      const response = await fetch('/api/albums-simple');
      if (response.ok) {
        const data = await response.json();
        const albums = data.albums || [];
        setSiteAlbums(albums);
        return albums;
      }
    } catch (error) {
      // Silently handle errors
    } finally {
      loadingAlbumsRef.current = false;
    }
    return [];
  }, []);

  const loadRelatedAlbums = useCallback(async () => {
    // Prevent duplicate requests
    if (loadingRelatedRef.current) {
      return;
    }
    
    loadingRelatedRef.current = true;
    
    try {
      const response = await fetch('/api/albums-static');
      if (response.ok) {
        const data = await response.json();
        const albums = Array.isArray(data) ? data : [];
        
        const relatedAlbums = albums.filter((relatedAlbum: Album) => {
          // Simple related album logic - same artist or exclude current album
          return relatedAlbum.feedId !== album?.feedId && 
                 (relatedAlbum.artist === album?.artist || 
                  relatedAlbum.title.toLowerCase().includes(album?.title?.toLowerCase() || ''));
        }).slice(0, 6);
        
        setRelatedAlbums(relatedAlbums);
      }
    } catch (error) {
      // Silently handle errors
    } finally {
      loadingRelatedRef.current = false;
    }
  }, [album]);

  const loadPodrollAlbums = useCallback(async () => {
    if (!album?.podroll || album.podroll.length === 0) return;
    
    try {
      // Use site albums if already loaded, otherwise wait for them to load
      let albums: Album[] = siteAlbums;
      if (albums.length === 0) {
        // Wait a bit for the site albums to load from the parallel call
        await new Promise(resolve => setTimeout(resolve, 500));
        albums = siteAlbums;
        
        // If still empty after waiting, something went wrong - skip podroll processing
        if (albums.length === 0) {
          return;
        }
      }
      
      // Filter out non-music podcast feeds from podrolls
      const filteredPodroll = filterPodrollItems(album.podroll);
      
      // Process all podroll items in parallel for better performance
      const podrollPromises = filteredPodroll.map(async (podrollItem) => {
        // Check if this podroll URL matches any album on the site
        const matchingAlbum = albums.find(siteAlbum => 
          siteAlbum.feedUrl === podrollItem.url
        );
        
        if (matchingAlbum) {
          // Use the site album data
          return {
            title: matchingAlbum.title,
            artist: matchingAlbum.artist,
            coverArt: matchingAlbum.coverArt,
            url: podrollItem.url
          };
        } else {
          // Try to fetch external feed data with timeout
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
            
            const response = await fetch(`/api/test-single-feed?url=${encodeURIComponent(podrollItem.url)}`, {
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (response.ok) {
              const data = await response.json();
              if (data.album) {
                return {
                  title: data.album.title || podrollItem.title || 'Unknown Album',
                  artist: data.album.artist || 'Unknown Artist',
                  coverArt: data.album.coverArt || '/placeholder-episode.jpg',
                  url: podrollItem.url
                };
              }
            }
          } catch (error) {
            // Silently handle errors
          }
          
          // Fallback to basic podroll data
          return {
            title: podrollItem.title || 'Unknown Album',
            artist: 'Unknown Artist',
            coverArt: '/placeholder-episode.jpg',
            url: podrollItem.url
          };
        }
      });
      
      // Wait for all podroll items to resolve (in parallel)
      const podrollResults = await Promise.allSettled(podrollPromises);
      const podrollData = podrollResults
        .filter((result): result is PromiseFulfilledResult<PodrollAlbum> => result.status === 'fulfilled')
        .map(result => result.value);
      
      setPodrollAlbums(podrollData);
    } catch (error) {
      console.error('Error loading podroll albums:', error);
    }
  }, [album, siteAlbums]);

  const handlePlayAlbum = () => {
    if (!album) return;
    
    // Stop video if currently playing
    if (playingVideoTrack || isVideoPlaying) {
      if (pauseVideo) pauseVideo();
      setPlayingVideoTrack(null);
    }
    
    // Play audio tracks (hero art should just start the album)
    const audioTracks = album.tracks.map(track => ({
      ...track,
      artist: album.artist,
      album: album.title,
      image: track.image || album.coverArt
    }));
    
    globalPlayAlbum(audioTracks, 0, album.title);
  };

  const handlePlayTrack = (track: Track, index: number) => {
    if (!album) return;
    
    // Stop video if currently playing
    if (playingVideoTrack || isVideoPlaying) {
      if (pauseVideo) pauseVideo();
      setPlayingVideoTrack(null);
    }
    
    const audioTracks = album.tracks.map(t => ({
      ...t,
      artist: album.artist,
      album: album.title,
      image: t.image || album.coverArt
    }));
    
    globalPlayAlbum(audioTracks, index, album.title);
  };

  const handlePlayVideo = (track: Track) => {
    if (!track.videoUrl) {
      return;
    }
    
    // Pause audio if playing
    if (globalIsPlaying) {
      globalPause();
    }
    
    // Play video with chapter support (startTime/endTime)
    globalPlayVideo({
      title: track.title,
      duration: track.duration,
      videoUrl: track.videoUrl,
      trackNumber: track.trackNumber,
      image: track.image,
      artist: album?.artist,
      album: album?.title,
      startTime: track.startTime, // Chapter start time in seconds
      endTime: track.endTime, // Chapter end time in seconds
      value: track.value,
      guid: track.guid,
      podcastGuid: track.podcastGuid,
      feedGuid: track.feedGuid,
      feedUrl: track.feedUrl,
      publisherGuid: track.publisherGuid,
      publisherUrl: track.publisherUrl,
      imageUrl: track.imageUrl
    }, album?.title);
    
    setPlayingVideoTrack(track);
  };


  const isTrackPlaying = (track: Track) => {
    return currentTrack?.url === track.url && globalIsPlaying;
  };

  const formatDuration = (duration: string): string => {
    if (!duration) return '0:00';
    if (duration.includes(':')) return duration;
    
    const seconds = parseInt(duration);
    if (!isNaN(seconds)) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    return duration;
  };

  const getReleaseYear = () => {
    if (!album) return '';
    try {
      return new Date(album.releaseDate).getFullYear();
    } catch {
      return '';
    }
  };

  const getAlbumSlug = (albumData: Album) => {
    return albumData.title
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const getPublisherSlug = (publisherName: string) => {
    return publisherName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  // Combine and deduplicate related albums
  const getCombinedRelatedAlbums = () => {
    const combined: Array<Album | PodrollAlbum> = [];
    const seen = new Set<string>();
    
    // Add site albums first (they have priority)
    relatedAlbums.forEach(album => {
      const key = `${album.title.toLowerCase()}|${album.artist.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(album);
      }
    });
    
    // Add podroll albums that aren't duplicates
    podrollAlbums.forEach(podrollAlbum => {
      const key = `${podrollAlbum.title.toLowerCase()}|${podrollAlbum.artist.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(podrollAlbum);
      }
    });
    
    return combined.slice(0, 8); // Limit to 8 total albums
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white">
        {/* Header Skeleton */}
        <header className="bg-black/50 backdrop-blur-md border-b border-white/10 sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-9 h-9 bg-gray-700 rounded-lg animate-pulse"></div>
                <div className="hidden sm:flex items-center gap-2">
                  <div className="w-32 h-4 bg-gray-700 rounded animate-pulse"></div>
                  <div className="w-2 h-4 bg-gray-700 rounded animate-pulse"></div>
                  <div className="w-24 h-4 bg-gray-700 rounded animate-pulse"></div>
                </div>
              </div>
              <div className="hidden sm:block">
                <div className="w-20 h-4 bg-gray-700 rounded animate-pulse"></div>
              </div>
            </div>
          </div>
        </header>

        {/* Album Hero Section Skeleton */}
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="flex flex-col lg:flex-row gap-6 items-start">
              {/* Album Artwork Skeleton */}
              <div className="flex-shrink-0 mx-auto lg:mx-0">
                <div className="w-64 h-64 lg:w-80 lg:h-80 bg-gray-700 rounded-xl animate-pulse"></div>
              </div>

              {/* Album Info Skeleton */}
              <div className="flex-1 text-center lg:text-left">
                <div className="mb-4">
                  <div className="h-12 lg:h-16 bg-gray-700 rounded animate-pulse mb-2"></div>
                  <div className="h-6 lg:h-8 bg-gray-700 rounded animate-pulse mb-2"></div>
                  <div className="h-4 bg-gray-700 rounded animate-pulse mb-4"></div>
                  
                  <div className="flex items-center justify-center lg:justify-start gap-4 mb-6">
                    <div className="h-4 bg-gray-700 rounded animate-pulse w-16"></div>
                    <div className="h-4 bg-gray-700 rounded animate-pulse w-20"></div>
                  </div>

                  <div className="max-w-2xl mx-auto lg:mx-0 mb-6 bg-gray-800/30 rounded-xl p-6">
                    <div className="space-y-2">
                      <div className="h-4 bg-gray-700 rounded animate-pulse"></div>
                      <div className="h-4 bg-gray-700 rounded animate-pulse"></div>
                      <div className="h-4 bg-gray-700 rounded animate-pulse w-3/4"></div>
                    </div>
                  </div>
                </div>

                {/* Play Controls Skeleton */}
                <div className="flex items-center justify-center lg:justify-start gap-4 mb-6">
                  <div className="h-12 bg-gray-700 rounded-full animate-pulse w-32"></div>
                  <div className="h-12 bg-gray-700 rounded-full animate-pulse w-12"></div>
                  <div className="h-12 bg-gray-700 rounded-full animate-pulse w-20"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Track List Skeleton */}
        <div className="container mx-auto px-4 pb-8">
          <div className="max-w-4xl mx-auto">
            <div className="bg-black/30 backdrop-blur-sm rounded-xl border border-white/20 overflow-hidden">
              <div className="p-6 border-b border-white/10">
                <div className="h-8 bg-gray-700 rounded animate-pulse w-24"></div>
              </div>
              
              <div className="divide-y divide-white/5">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-4 p-4">
                    <div className="w-8 h-4 bg-gray-700 rounded animate-pulse"></div>
                    <div className="w-12 h-12 bg-gray-700 rounded animate-pulse"></div>
                    <div className="flex-1">
                      <div className="h-4 bg-gray-700 rounded animate-pulse mb-1"></div>
                      <div className="h-3 bg-gray-700 rounded animate-pulse w-1/2"></div>
                    </div>
                    <div className="h-4 bg-gray-700 rounded animate-pulse w-12"></div>
                    <div className="h-8 bg-gray-700 rounded-lg animate-pulse w-16"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom spacing */}
        <div className="h-24" />
      </div>
    );
  }

  if (error || (!album && !isLoading)) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
        <h1 className="text-2xl font-semibold mb-4">{error || 'Album not found'}</h1>
        <Link 
          href="/"
          className="text-blue-400 hover:text-blue-300 transition-colors"
        >
          ← Back to albums
        </Link>
      </div>
    );
  }

  // TypeScript guard: album is guaranteed to be non-null here or we're loading
  if (!album) {
    // Still loading, show spinner
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-white"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white relative overflow-hidden">
      <style jsx>{`
        .text-shadow {
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8), 0 2px 8px rgba(0, 0, 0, 0.5);
        }
        .text-shadow-sm {
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
        }
      `}</style>
      {/* Dynamic Background with Bloodshot Lies fallback */}
      <div className="fixed inset-0 z-0">
        {/* Primary album background */}
        {backgroundImage && backgroundLoaded ? (
          <Image
            src={backgroundImage}
            alt={`${album.title} background`}
            fill
            className="object-cover w-full h-full"
            priority
            unoptimized={
              // Bypass optimization for GIFs and problematic PNGs from doerfelverse.com
              backgroundImage.toLowerCase().includes('.gif') ||
              (backgroundImage.includes('doerfelverse.com') && backgroundImage.toLowerCase().includes('.png'))
            }
            quality={90}
            sizes="100vw"
          />
        ) : (
          /* Fallback to default background */
          <div className="w-full h-full bg-gradient-to-br from-gray-900 to-black"></div>
        )}
        
        {/* Very subtle gradient overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/30"></div>
      </div>

      {/* Content */}
      <div className="relative z-10">
        {/* Header */}
        <header className="bg-black/50 backdrop-blur-md border-b border-white/10 sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link
                  href="/"
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors group"
                  title="Back to albums"
                  suppressHydrationWarning
                >
                  <ArrowLeft className="w-5 h-5 group-hover:scale-110 transition-transform" />
                </Link>
                
                <div className="hidden sm:flex items-center gap-2 text-sm">
                  <Link href="/" className="text-gray-400 hover:text-white transition-colors" suppressHydrationWarning>
                    Into the Doerfel-Verse
                  </Link>
                  <span className="text-gray-600">/</span>
                  <span className="font-medium truncate max-w-[200px]">{album.title}</span>
                </div>
              </div>

              {/* Desktop Version Info */}
              <div className="hidden sm:block text-xs text-gray-400">
                {album.tracks.length} tracks • {getReleaseYear()}
              </div>
            </div>
          </div>
        </header>

        {/* Album Hero Section */}
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="flex flex-col lg:flex-row gap-6 items-start">
              {/* Album Artwork */}
              <div className="flex-shrink-0 mx-auto lg:mx-0">
                <div className="w-64 h-64 lg:w-80 lg:h-80 relative rounded-xl shadow-2xl overflow-hidden border border-white/20 group cursor-pointer">
                  <Image
                    src={album.coverArt}
                    alt={album.title}
                    fill
                    className="object-cover"
                    priority
                    sizes="(min-width: 1024px) 320px, 256px"
                    unoptimized={
                      // Bypass optimization for GIFs and problematic PNGs from doerfelverse.com
                      album.coverArt.toLowerCase().includes('.gif') ||
                      (album.coverArt.includes('doerfelverse.com') && album.coverArt.toLowerCase().includes('.png'))
                    }
                  />
                  
                  {/* Play Button Overlay */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button
                      onClick={handlePlayAlbum}
                      className="p-4 lg:p-6 bg-white/20 backdrop-blur-sm border border-white/40 text-white rounded-full hover:scale-110 hover:bg-white/30 transition-all shadow-2xl"
                      title={`Play ${album.title}`}
                    >
                      <svg className="w-8 h-8 lg:w-12 lg:h-12 ml-1" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Album Info */}
              <div className="flex-1 text-center lg:text-left">
                <div className="mb-4 bg-black/60 backdrop-blur-sm p-4 rounded-lg">
                  <h1 className="text-4xl lg:text-5xl font-bold mb-2 text-white text-shadow">
                    {album.title}
                  </h1>
                  <p className="text-xl lg:text-2xl text-gray-300 mb-2 text-shadow-sm">{album.artist}</p>
                  
                  {/* Publisher Link */}
                  {album.publisher && (
                    <div className="mb-4">
                      <Link
                        href={`/publisher/${getPublisherSlug(album.artist)}`}
                        className="inline-flex items-center gap-2 text-sm text-white hover:text-yellow-400 transition-colors underline underline-offset-2 text-shadow-sm"
                        title={`View all albums by ${album.artist}`}
                      >
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full"></span>
                        View all albums by {album.artist}
                      </Link>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-center lg:justify-start gap-4 text-sm text-gray-200 mb-6 text-shadow-sm">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                      {getReleaseYear()}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                      {album.tracks.length} tracks
                    </span>
                  </div>

                  {album.description && (
                    <div className="max-w-2xl mx-auto lg:mx-0 mb-2 bg-black/30 backdrop-blur-sm rounded-xl border border-white/20 p-6">
                      <p className="text-white leading-relaxed">{album.description}</p>
                    </div>
                  )}

                </div>


                {/* Play Controls */}
                <div className="flex items-center justify-center lg:justify-start gap-4 mb-6">
                  <button
                    onClick={handlePlayAlbum}
                    className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 rounded-full transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
                  >
                    <Play className="w-5 h-5" />
                    <span className="font-semibold">Play Album</span>
                  </button>
                  
                  <button
                    onClick={() => toggleShuffle()}
                    className="p-3 bg-white/10 hover:bg-white/20 rounded-full transition-all backdrop-blur-sm border-2 border-white/40 hover:border-white/60 shadow-lg"
                    title="Shuffle"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M14.83 13.41L13.42 14.82L16.55 17.95L14.5 20H20V14.5L17.96 16.54L14.83 13.41M14.5 4L16.54 6.04L4 18.59L5.41 20L17.96 7.46L20 9.5V4M10.59 9.17L5.41 4L4 5.41L9.17 10.58L10.59 9.17Z"/>
                    </svg>
                  </button>
                  
                  {/* Album Boost Button */}
                  {isLightningEnabled && (
                    <button
                      onClick={() => setShowAlbumBoostModal(true)}
                      className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-yellow-500 to-orange-600 text-white rounded-full font-semibold transition-all duration-200 hover:from-yellow-400 hover:to-orange-500 hover:shadow-lg transform hover:scale-105 active:scale-95 touch-manipulation min-w-[44px] min-h-[44px]"
                    >
                      <Zap className="w-4 h-4" />
                      <span>Boost</span>
                    </button>
                  )}
                </div>

                {/* Funding Information - Support This Artist */}
                {album.funding && album.funding.length > 0 && (
                  <div className="mb-8">
                    <h3 className="text-lg font-semibold mb-3 text-white text-center lg:text-left">Support This Artist</h3>
                    <div className="flex flex-wrap justify-center lg:justify-start gap-3">
                      {album.funding.map((funding, index) => (
                        <a
                          key={index}
                          href={funding.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-4 py-2 rounded-full text-sm font-medium transition-all transform hover:scale-105 flex items-center gap-2"
                        >
                          💝 {funding.message || 'Support'}
                        </a>
                      ))}
                    </div>
                  </div>
                )}


              </div>
            </div>
          </div>
        </div>

        {/* Track List */}
        <div className="container mx-auto px-4 pb-8">
          <div className="max-w-4xl mx-auto">
            <div className="bg-black/70 backdrop-blur-sm rounded-xl border border-white/20 overflow-hidden">
              <div className="p-6 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setTrackView('audio');
                      // Stop video player when switching to audio view
                      if (playingVideoTrack || isVideoPlaying) {
                        pauseVideo();
                        setPlayingVideoTrack(null);
                      }
                    }}
                    className={`px-4 py-2 rounded-lg text-lg font-bold transition-all ${
                      trackView === 'audio'
                        ? 'bg-white/20 text-white shadow-sm'
                        : 'text-gray-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    Tracks
                  </button>
                  {hasVideoTracks && (
                    <button
                      onClick={() => setTrackView('video')}
                      className={`px-4 py-2 rounded-lg text-lg font-bold transition-all ${
                        trackView === 'video'
                          ? 'bg-white/20 text-white shadow-sm'
                          : 'text-gray-400 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      Video
                    </button>
                  )}
                </div>
              </div>
              
              <div className="divide-y divide-white/5">
                {filteredTracks.map((track, index) => {
                  const isCurrentTrack = currentTrack?.url === track.url;
                  const isCurrentlyPlaying = isTrackPlaying(track);
                  // Find the original index in album.tracks (or initialAlbum.tracks) for handlePlayTrack
                  const tracksToSearch = album?.tracks || initialAlbum?.tracks || [];
                  const originalIndex = tracksToSearch.findIndex(t => t.trackNumber === track.trackNumber);
                  const finalIndex = originalIndex !== -1 ? originalIndex : index;

                  return (
                    <div
                      key={track.trackNumber}
                      className={`flex items-center gap-4 p-4 hover:bg-white/5 transition-colors cursor-pointer group ${
                        isCurrentTrack ? 'bg-white/10' : ''
                      }`}
                      onClick={() => handlePlayTrack(track, finalIndex)}
                    >
                      {/* Track Number / Play Icon */}
                      <div className="w-8 flex items-center justify-center">
                        {isCurrentlyPlaying ? (
                          <div className="w-4 h-4 flex items-center justify-center">
                            <div className="w-1 h-3 bg-blue-400 animate-pulse mr-0.5"></div>
                            <div className="w-1 h-2 bg-blue-400 animate-pulse delay-75 mr-0.5"></div>
                            <div className="w-1 h-4 bg-blue-400 animate-pulse delay-150"></div>
                          </div>
                        ) : (
                          <span className={`text-sm font-medium ${isCurrentTrack ? 'text-blue-400' : 'text-gray-200 group-hover:text-white'} text-shadow-sm`}>
                            {index + 1}
                          </span>
                        )}
                      </div>

                      {/* Track Artwork */}
                      <div 
                        className="w-12 h-12 relative flex-shrink-0 rounded overflow-hidden cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent track row click
                          // If track has video, play video; otherwise play audio
                          if (track.videoUrl) {
                            handlePlayVideo(track);
                          } else {
                            handlePlayTrack(track, finalIndex);
                          }
                        }}
                      >
                        <Image
                          src={track.image || album.coverArt}
                          alt={track.title}
                          fill
                          className="object-cover"
                          sizes="48px"
                          unoptimized={
                            // Bypass optimization for GIFs and problematic PNGs from doerfelverse.com
                            (track.image || album.coverArt).toLowerCase().includes('.gif') ||
                            ((track.image || album.coverArt).includes('doerfelverse.com') && (track.image || album.coverArt).toLowerCase().includes('.png'))
                          }
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Play className="w-4 h-4 text-white" />
                        </div>
                      </div>

                      {/* Track Info */}
                      <div className="flex-1 min-w-0">
                        <h3 className={`font-medium truncate ${
                          isCurrentTrack ? 'text-blue-400' : 'text-white'
                        }`}>
                          {track.title}
                        </h3>
                        <p className="text-sm text-gray-300 truncate text-shadow-sm">{album.artist}</p>
                      </div>

                      {/* Duration */}
                      <div className="text-sm text-gray-200 font-mono text-shadow-sm">
                        {formatDuration(track.duration)}
                      </div>

                      {/* Video Play Button */}
                      {track.videoUrl && (
                        <div 
                          className="flex items-center justify-center ml-2"
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent track play when clicking video
                          }}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayVideo(track);
                            }}
                            className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-500 to-pink-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 hover:from-purple-400 hover:to-pink-500 hover:shadow-lg transform hover:scale-105 active:scale-95"
                            title="Play video"
                          >
                            <Video className="w-4 h-4" />
                            <span className="hidden sm:inline">Video</span>
                          </button>
                        </div>
                      )}

                      {/* Track Lightning Boost Button */}
                      {isLightningEnabled && (
                        <div 
                          className="flex items-center justify-center ml-2"
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent track play when clicking boost
                          }}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTrack(track);
                              setShowTrackBoostModal(true);
                            }}
                            className="inline-flex items-center gap-2 bg-gradient-to-r from-yellow-500 to-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 hover:from-yellow-400 hover:to-orange-500 hover:shadow-lg transform hover:scale-105 active:scale-95 touch-manipulation min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0"
                          >
                            <Zap className="w-4 h-4" />
                            <span className="hidden sm:inline">Boost</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Video Player Section */}
        {playingVideoTrack && playingVideoTrack.videoUrl && (
          <div ref={videoPlayerRef} className="container mx-auto px-2 sm:px-4 pb-24 sm:pb-8">
            <div className="max-w-4xl mx-auto">
              <div className="bg-black/70 backdrop-blur-sm rounded-xl border border-white/20 overflow-hidden">
                <div className="p-3 sm:p-6 border-b border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg sm:text-2xl font-bold text-shadow">Video Player</h2>
                    <p className="text-xs sm:text-sm text-gray-300 mt-1 truncate">{playingVideoTrack.title}</p>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                    {/* Video Boost Button */}
                    {isLightningEnabled && (
                      <button
                        onClick={() => {
                          setSelectedTrack(playingVideoTrack);
                          setShowTrackBoostModal(true);
                        }}
                        className="inline-flex items-center gap-1 sm:gap-2 bg-gradient-to-r from-yellow-500 to-orange-600 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all duration-200 hover:from-yellow-400 hover:to-orange-500 hover:shadow-lg transform hover:scale-105 active:scale-95 touch-manipulation min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0"
                        title="Boost this video"
                      >
                        <Zap className="w-4 h-4" />
                        <span className="hidden sm:inline">Boost</span>
                      </button>
                    )}
                    <button
                      onClick={() => {
                        pauseVideo();
                        setPlayingVideoTrack(null);
                      }}
                      className="p-2 sm:p-2 hover:bg-white/10 rounded-lg transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
                      title="Close video player"
                    >
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="p-2 sm:p-6">
                  <VideoPlayer
                    videoUrl={playingVideoTrack.videoUrl}
                    startTime={playingVideoTrack.startTime} // Chapter start time in seconds
                    endTime={playingVideoTrack.endTime} // Chapter end time in seconds
                    seekTime={videoContext.seekRequest ?? undefined} // Sync seek request from context (chapter-relative)
                    onEnded={() => {
                      setPlayingVideoTrack(null);
                    }}
                    onTimeUpdate={(time) => {
                      // VideoPlayer now passes display time (chapter-relative if playing a chapter, otherwise absolute)
                      // So we can use it directly - no need to recalculate
                      // This ensures the global now playing bar shows the same time as the main player
                      if (updateCurrentTime) {
                        updateCurrentTime(time);
                      }
                    }}
                    onPlay={() => {
                      // Update VideoContext play state for now playing bar sync
                      resumeVideo();
                    }}
                    onPause={() => {
                      // Update VideoContext pause state for now playing bar sync
                      pauseVideo();
                    }}
                    onDurationChange={(duration) => {
                      // VideoPlayer now passes display duration (chapter duration if playing a chapter, otherwise full video duration)
                      // So we can use it directly - no need to recalculate
                      // This ensures the global now playing bar shows the same duration as the main player
                      if (updateDuration) {
                        updateDuration(duration);
                      }
                      
                      // Update track duration if it's missing or 0:00
                      if (playingVideoTrack && (!playingVideoTrack.duration || playingVideoTrack.duration === '0:00')) {
                        const mins = Math.floor(duration / 60);
                        const secs = Math.floor(duration % 60);
                        const formattedDuration = `${mins}:${secs.toString().padStart(2, '0')}`;
                        
                        // Update the track in the album's tracks array
                        if (album) {
                          const updatedTracks = album.tracks.map(t => 
                            t.videoUrl === playingVideoTrack.videoUrl && t.title === playingVideoTrack.title
                              ? { ...t, duration: formattedDuration }
                              : t
                          );
                          setAlbum({ ...album, tracks: updatedTracks });
                        }
                        
                        // Update the playing video track
                        setPlayingVideoTrack({ ...playingVideoTrack, duration: formattedDuration });
                      }
                    }}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Album Boost Modal */}
        {isLightningEnabled && showAlbumBoostModal && album && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative bg-gradient-to-b from-gray-900 to-black rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[85vh] sm:max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-300">
              {/* Header with Album Art */}
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80 z-10" />
                <Image
                  src={album.coverArt}
                  alt={album.title}
                  width={400}
                  height={200}
                  className="w-full h-32 sm:h-40 object-cover"
                  unoptimized={album.coverArt.includes('doerfelverse.com') && album.coverArt.toLowerCase().includes('.png')}
                />
                <button
                  onClick={() => setShowAlbumBoostModal(false)}
                  className="absolute top-4 right-4 z-20 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors backdrop-blur-sm touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="absolute bottom-4 left-6 right-6 z-20">
                  <h3 className="text-xl sm:text-2xl font-bold text-white mb-1">{album.title}</h3>
                  <p className="text-sm sm:text-base text-gray-200">{album.artist}</p>
                </div>
              </div>
              
              <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(85vh-8rem)] sm:max-h-[calc(90vh-10rem)]">
                {/* Amount Input */}
                <div>
                  <label className="text-gray-400 text-sm font-medium">Amount</label>
                  <div className="flex items-center gap-3 mt-2">
                    <input
                      type="number"
                      value={boostAmount}
                      onChange={(e) => setBoostAmount(Math.max(1, parseInt(e.target.value) || 1))}
                      className="flex-1 px-4 py-3 bg-gray-800/50 border border-gray-700 text-white rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                      placeholder="Enter amount"
                      min="1"
                    />
                    <span className="text-gray-400 font-medium">sats</span>
                  </div>
                </div>
                
                {/* Sender Name */}
                <div>
                  <label className="text-gray-400 text-sm font-medium">Your Name (Optional)</label>
                  <input
                    type="text"
                    value={senderName}
                    onChange={(e) => {
                      setSenderName(e.target.value);
                      if (e.target.value.trim()) {
                        localStorage.setItem('boost-sender-name', e.target.value.trim());
                      }
                    }}
                    className="w-full mt-2 px-4 py-3 bg-gray-800/50 border border-gray-700 text-white rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                    placeholder="Anonymous"
                    maxLength={50}
                  />
                </div>

                {/* Boostagram Message */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-gray-400 text-sm font-medium">Message (Optional)</label>
                    <span className="text-gray-500 text-xs">{boostMessage.length}/250</span>
                  </div>
                  <textarea
                    value={boostMessage}
                    onChange={(e) => setBoostMessage(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 text-white rounded-xl text-base resize-none focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                    placeholder="Share your thoughts..."
                    maxLength={250}
                    rows={3}
                  />
                </div>

                {/* Show Splits Button */}
                <div className="mt-4">
                  <button
                    onClick={() => setShowAlbumSplits(!showAlbumSplits)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-colors"
                  >
                    <Info className="w-4 h-4" />
                    <span>{showAlbumSplits ? 'Hide' : 'Show'} Payment Splits</span>
                  </button>
                  
                  {showAlbumSplits && (() => {
                    const recipients = (() => {
                      // For album boosts, use a track's recipients instead of album-level recipients
                      // This ensures we use track-level value blocks (e.g., 6 recipients) instead of channel-level (e.g., 317 recipients)
                      if (album.tracks && album.tracks.length > 0) {
                        // Try to find CityBeach track first (for The Satellite Spotlight album)
                        const cityBeachTrack = album.tracks.find((t: Track) => 
                          t.title.trim().toLowerCase().includes('citybeach') && !t.videoUrl
                        );
                        
                        // Use CityBeach track if found, otherwise use first track
                        let trackToUse = cityBeachTrack || album.tracks[0];
                        
                        // For Disco Swag album, ensure we use track-level recipients (95/5) instead of channel-level (90/10)
                        // Try to find any track with track-level value/paymentRecipients
                        if (album.title?.toLowerCase().includes('disco swag')) {
                          const trackWithValue = album.tracks.find((t: Track) => {
                            const recipients = getTrackPaymentRecipients(t);
                            return recipients && recipients.length > 0;
                          });
                          if (trackWithValue) {
                            trackToUse = trackWithValue;
                          }
                        }
                        
                        const trackRecipients = getTrackPaymentRecipients(trackToUse);
                        
                        if (trackRecipients && trackRecipients.length > 0) {
                          return trackRecipients;
                        }
                      }
                      // Fallback to album-level recipients if no track recipients found
                      return paymentRecipients || [];
                    })();
                    
                    if (recipients.length === 0) {
                      return (
                        <div className="mt-3 p-3 bg-gray-800/30 rounded-lg text-sm text-gray-400">
                          No payment splits configured
                        </div>
                      );
                    }
                    
                    const totalSplit = recipients.reduce((sum: number, r: any) => sum + (r.split || 0), 0);
                    
                    // Sort recipients by split (largest to smallest)
                    const sortedRecipients = [...recipients].sort((a: any, b: any) => (b.split || 0) - (a.split || 0));
                    
                    return (
                      <div className="mt-3 p-4 bg-gray-800/30 rounded-lg border border-gray-700">
                        <div className="text-sm font-medium text-gray-300 mb-3">
                          Payment will be split among {recipients.length} recipient{recipients.length !== 1 ? 's' : ''}:
                        </div>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {sortedRecipients.map((recipient: any, index: number) => {
                            const percentage = totalSplit > 0 ? ((recipient.split / totalSplit) * 100).toFixed(1) : '0';
                            const amount = Math.floor((boostAmount * recipient.split) / totalSplit);
                            return (
                              <div key={index} className="flex items-center justify-between p-2 bg-gray-900/50 rounded">
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm text-white font-medium truncate">
                                    {recipient.name || `Recipient ${index + 1}`}
                                  </div>
                                  <div className="text-xs text-gray-400 truncate font-mono">
                                    {recipient.address.substring(0, 20)}...
                                  </div>
                                </div>
                                <div className="text-right ml-4">
                                  <div className="text-sm text-white font-medium">
                                    {percentage}%
                                  </div>
                                  <div className="text-xs text-gray-400">
                                    {amount} sats
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {totalSplit !== 100 && totalSplit > 0 && (
                          <div className="mt-2 text-xs text-yellow-400">
                            Note: Total split is {totalSplit}% (not 100%)
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                
                {/* Boost Button */}
                <BitcoinConnectPayment
                  amount={boostAmount}
                  description={`Boost for ${album.title} by ${album.artist}`}
                  onSuccess={handleBoostSuccess}
                  onError={handleBoostError}
                  className="w-full !mt-6"
                  recipients={(() => {
                    // Special case: Autumn Rust uses specific recipients for all boosts (audio and video)
                    if (album.title?.toLowerCase().includes('autumn rust')) {
                      return [
                        {
                          address: '03b6f613e88bd874177c28c6ad83b3baba43c4c656f56be1f8df84669556054b79',
                          split: 1,
                          name: 'boostbot@fountain.fm',
                          type: 'node'
                        },
                        {
                          address: '03589f3ddb81f3802f3fc9aaa359b684ed19840b55db88f7c9c2cc671e74ac93e2',
                          split: 1,
                          name: 'ThunderRoad',
                          type: 'node'
                        },
                        {
                          address: '02c7bb6f29f09d92d40d62d64443b688891259dea324406b4678df6235794f24bf',
                          split: 1,
                          name: 'ericpp@getalby.com',
                          type: 'node'
                        },
                        {
                          address: '03d55f4d4c870577e98ac56605a54c5ed20c8897e41197a068fd61bdb580efaa67',
                          split: 1,
                          name: 'BoostBot',
                          type: 'node'
                        },
                        {
                          address: '035ad2c954e264004986da2d9499e1732e5175e1dcef2453c921c6cdcc3536e9d8',
                          split: 1,
                          name: 'steven@getalby.com',
                          type: 'node'
                        },
                        {
                          address: '031ce2f133b570edf1c776e571e27d22a715dc6ea73956f0e79f4272d81d9dc0d5',
                          split: 95,
                          name: 'DoerfelVerse_Node',
                          type: 'node'
                        }
                      ];
                    }
                    
                    // Special case: The Satellite Spotlight uses specific recipients for all boosts (audio and video)
                    if (album.title?.toLowerCase().includes('satellite spotlight')) {
                      return [
                        {
                          address: '031ce2f133b570edf1c776e571e27d22a715dc6ea73956f0e79f4272d81d9dc0d5',
                          split: 95,
                          name: 'DoerfelVerse_Node',
                          type: 'node'
                        },
                        {
                          address: '02c7bb6f29f09d92d40d62d64443b688891259dea324406b4678df6235794f24bf',
                          split: 1,
                          name: 'Ericpp',
                          type: 'node'
                        },
                        {
                          address: '035ad2c954e264004986da2d9499e1732e5175e1dcef2453c921c6cdcc3536e9d8',
                          split: 1,
                          name: 'steven@getalby.com',
                          type: 'node'
                        },
                        {
                          address: '03589f3ddb81f3802f3fc9aaa359b684ed19840b55db88f7c9c2cc671e74ac93e2',
                          split: 1,
                          name: 'ThunderRoad',
                          type: 'node'
                        },
                        {
                          address: '03b6f613e88bd874177c28c6ad83b3baba43c4c656f56be1f8df84669556054b79',
                          split: 1,
                          name: 'boostbot@fountain.fm',
                          type: 'node'
                        },
                        {
                          address: '03ae9f91a0cb8ff43840e3c322c4c61f019d8c1c3cea15a25cfc425ac605e61a4a',
                          split: 1,
                          name: 'Podcastindex.org',
                          type: 'node'
                        }
                      ];
                    }
                    
                    // For album boosts, use a track's recipients instead of album-level recipients
                    // This ensures we use track-level value blocks (e.g., 6 recipients) instead of channel-level (e.g., 317 recipients)
                    if (album.tracks && album.tracks.length > 0) {
                      // Try to find CityBeach track first (for The Satellite Spotlight album)
                      const cityBeachTrack = album.tracks.find((t: Track) => 
                        t.title.trim().toLowerCase().includes('citybeach') && !t.videoUrl
                      );
                      
                      // Use CityBeach track if found, otherwise use first track
                      let trackToUse = cityBeachTrack || album.tracks[0];
                      
                      // For Disco Swag album, ensure we use track-level recipients (95/5) instead of channel-level (90/10)
                      // Try to find any track with track-level value/paymentRecipients
                      if (album.title?.toLowerCase().includes('disco swag')) {
                        const trackWithValue = album.tracks.find((t: Track) => {
                          const recipients = getTrackPaymentRecipients(t);
                          return recipients && recipients.length > 0;
                        });
                        if (trackWithValue) {
                          trackToUse = trackWithValue;
                        }
                      }
                      
                      const trackRecipients = getTrackPaymentRecipients(trackToUse);
                      
                      if (trackRecipients && trackRecipients.length > 0) {
                        return trackRecipients;
                      }
                    }
                    // Fallback to album-level recipients if no track recipients found
                    return paymentRecipients || undefined;
                  })()}
                  recipient={getFallbackRecipient().address}
                  enableBoosts={true}
                  boostMetadata={{
                    title: album.title,
                    artist: album.artist,
                    album: album.title,
                    url: `https://doerfelverse.com/album/${encodeURIComponent(albumTitle)}`,
                    appName: 'ITDV App',
                    senderName: senderName?.trim() || 'Super Fan',
                    message: boostMessage?.trim() || undefined,
                    itemGuid: album.tracks?.[0]?.guid,
                    podcastGuid: album.tracks?.[0]?.podcastGuid,
                    podcastFeedGuid: album.feedGuid,
                    feedUrl: album.feedUrl,
                    publisherGuid: album.publisherGuid,
                    publisherUrl: album.publisherUrl,
                    imageUrl: album.coverArt
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Track Boost Modal */}
        {isLightningEnabled && showTrackBoostModal && selectedTrack && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative bg-gradient-to-b from-gray-900 to-black rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[85vh] sm:max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-300">
              {/* Header with Track Art */}
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80 z-10" />
                <Image
                  src={selectedTrack.image || album?.coverArt || '/placeholder-episode.jpg'}
                  alt={selectedTrack.title}
                  width={400}
                  height={200}
                  className="w-full h-32 sm:h-40 object-cover"
                />
                <button
                  onClick={() => {
                    setShowTrackBoostModal(false);
                    setSelectedTrack(null);
                  }}
                  className="absolute top-4 right-4 z-20 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors backdrop-blur-sm touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="absolute bottom-4 left-6 right-6 z-20">
                  <h3 className="text-xl sm:text-2xl font-bold text-white mb-1">{selectedTrack.title}</h3>
                  <p className="text-sm sm:text-base text-gray-200">{album?.artist}</p>
                </div>
              </div>
              
              <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(85vh-8rem)] sm:max-h-[calc(90vh-10rem)]">
                {/* Amount Input */}
                <div>
                  <label className="text-gray-400 text-sm font-medium">Amount</label>
                  <div className="flex items-center gap-3 mt-2">
                    <input
                      type="number"
                      value={trackBoostAmount}
                      onChange={(e) => setTrackBoostAmount(Math.max(1, parseInt(e.target.value) || 1))}
                      className="flex-1 px-4 py-3 bg-gray-800/50 border border-gray-700 text-white rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                      placeholder="Enter amount"
                      min="1"
                    />
                    <span className="text-gray-400 font-medium">sats</span>
                  </div>
                </div>
                
                {/* Sender Name */}
                <div>
                  <label className="text-gray-400 text-sm font-medium">Your Name (Optional)</label>
                  <input
                    type="text"
                    value={senderName}
                    onChange={(e) => {
                      setSenderName(e.target.value);
                      if (e.target.value.trim()) {
                        localStorage.setItem('boost-sender-name', e.target.value.trim());
                      }
                    }}
                    className="w-full mt-2 px-4 py-3 bg-gray-800/50 border border-gray-700 text-white rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                    placeholder="Anonymous"
                    maxLength={50}
                  />
                </div>

                {/* Boostagram Message */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-gray-400 text-sm font-medium">Message (Optional)</label>
                    <span className="text-gray-500 text-xs">{trackBoostMessage.length}/250</span>
                  </div>
                  <textarea
                    value={trackBoostMessage}
                    onChange={(e) => setTrackBoostMessage(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 text-white rounded-xl text-base resize-none focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                    placeholder="Share your thoughts..."
                    maxLength={250}
                    rows={3}
                  />
                </div>

                {/* Show Splits Button */}
                <div className="mt-4">
                  <button
                    onClick={() => setShowTrackSplits(!showTrackSplits)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-colors"
                  >
                    <Info className="w-4 h-4" />
                    <span>{showTrackSplits ? 'Hide' : 'Show'} Payment Splits</span>
                  </button>
                  
                  {showTrackSplits && (() => {
                    const recipients = getTrackPaymentRecipients(selectedTrack) || [];
                    
                    if (recipients.length === 0) {
                      return (
                        <div className="mt-3 p-3 bg-gray-800/30 rounded-lg text-sm text-gray-400">
                          No payment splits configured
                        </div>
                      );
                    }
                    
                    const totalSplit = recipients.reduce((sum: number, r: any) => sum + (r.split || 0), 0);
                    
                    // Sort recipients by split (largest to smallest)
                    const sortedRecipients = [...recipients].sort((a: any, b: any) => (b.split || 0) - (a.split || 0));
                    
                    return (
                      <div className="mt-3 p-4 bg-gray-800/30 rounded-lg border border-gray-700">
                        <div className="text-sm font-medium text-gray-300 mb-3">
                          Payment will be split among {recipients.length} recipient{recipients.length !== 1 ? 's' : ''}:
                        </div>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {sortedRecipients.map((recipient: any, index: number) => {
                            const percentage = totalSplit > 0 ? ((recipient.split / totalSplit) * 100).toFixed(1) : '0';
                            const amount = Math.floor((trackBoostAmount * recipient.split) / totalSplit);
                            return (
                              <div key={index} className="flex items-center justify-between p-2 bg-gray-900/50 rounded">
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm text-white font-medium truncate">
                                    {recipient.name || `Recipient ${index + 1}`}
                                  </div>
                                  <div className="text-xs text-gray-400 truncate font-mono">
                                    {recipient.address.substring(0, 20)}...
                                  </div>
                                </div>
                                <div className="text-right ml-4">
                                  <div className="text-sm text-white font-medium">
                                    {percentage}%
                                  </div>
                                  <div className="text-xs text-gray-400">
                                    {amount} sats
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {totalSplit !== 100 && totalSplit > 0 && (
                          <div className="mt-2 text-xs text-yellow-400">
                            Note: Total split is {totalSplit}% (not 100%)
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                
                {/* Boost Button */}
                <BitcoinConnectPayment
                  amount={trackBoostAmount}
                  description={`Boost for "${selectedTrack.title}" by ${album?.artist}`}
                  onSuccess={(response) => {
                    handleBoostSuccess(response);
                    setShowTrackBoostModal(false);
                    setSelectedTrack(null);
                    setTrackBoostMessage('');
                  }}
                  onError={handleBoostError}
                  className="w-full !mt-6"
                  recipients={getTrackPaymentRecipients(selectedTrack) || undefined}
                  recipient={getFallbackRecipient().address}
                  enableBoosts={true}
                  boostMetadata={{
                    title: selectedTrack.title,
                    artist: album?.artist || 'Unknown Artist',
                    album: album?.title || 'Unknown Album',
                    episode: selectedTrack.title,
                    url: `https://doerfelverse.com/album/${encodeURIComponent(albumTitle)}`,
                    appName: 'ITDV App',
                    senderName: senderName?.trim() || undefined,
                    message: trackBoostMessage?.trim() || undefined,
                    // Include RSS podcast GUIDs for proper Nostr tagging
                    itemGuid: selectedTrack.guid,
                    podcastGuid: selectedTrack.podcastGuid,
                    podcastFeedGuid: album?.feedGuid,
                    feedUrl: album?.feedUrl,
                    publisherGuid: album?.publisherGuid,
                    publisherUrl: album?.publisherUrl,
                    imageUrl: selectedTrack.imageUrl || album?.coverArt
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Bottom spacing for audio player */}
        <div className="h-24" />
      </div>
      
      {/* Performance Monitor (development only) */}
      <PerformanceMonitor />
    </div>
  );
}