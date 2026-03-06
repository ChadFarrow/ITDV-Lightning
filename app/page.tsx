'use client';

import { useState, useEffect, useRef, Suspense, lazy, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import LoadingSpinner from '@/components/LoadingSpinner';
import { getVersionString } from '@/lib/version';
import { useAudio } from '@/contexts/AudioContext';
import { useVideo } from '@/contexts/VideoContext';
import { useLightning } from '@/contexts/LightningContext';
import { toast } from '@/components/Toast';
import { preloadCriticalColors } from '@/lib/performance-utils';
import dynamic from 'next/dynamic';
import { Zap, Video, Play, Info } from 'lucide-react';
import confetti from 'canvas-confetti';
import { isLightningEnabled } from '@/lib/feature-flags';
import { safeLocalStorage } from '@/lib/safe-storage';
import VideoPlayer from '@/components/VideoPlayer';

// Lazy load Lightning components - not needed on initial page load
const BitcoinConnectWallet = dynamic(
  () => import('@/components/BitcoinConnect').then(mod => ({ default: mod.BitcoinConnectWallet })),
  { 
    loading: () => <div className="w-32 h-10 bg-gray-800/50 rounded-lg animate-pulse" />,
    ssr: false 
  }
);

const BitcoinConnectPayment = dynamic(
  () => import('@/components/BitcoinConnect').then(mod => ({ default: mod.BitcoinConnectPayment })),
  { 
    loading: () => <div className="w-full h-10 bg-gray-800/50 rounded-lg animate-pulse" />,
    ssr: false 
  }
);

// Direct import of AlbumCard to fix lazy loading issue
import AlbumCard from '@/components/AlbumCard';
import LightningToggle from '@/components/LightningToggle';

const PublisherCard = dynamic(() => import('@/components/PublisherCard'), {
  loading: () => <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 h-20 animate-pulse"></div>,
  ssr: false
});

const ControlsBar = dynamic(() => import('@/components/ControlsBar'), {
  loading: () => <div className="mb-8 p-4 bg-gray-800/20 rounded-lg animate-pulse h-16"></div>,
  ssr: false
});

// Import types from the ControlsBar component
import type { FilterType, ViewType } from '@/components/ControlsBar';


interface Track {
  title: string;
  duration: string;
  url: string;
  videoUrl?: string; // Video enclosure URL (HLS .m3u8 files)
  trackNumber: number;
  image?: string;
  value?: any; // Track-level podcast:value data
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
  value?: any; // Album-level podcast:value data
  podroll?: RSSPodRoll[];
  publisher?: {
    feedGuid: string;
    feedUrl: string;
    medium: string;
  };
  // Podcast GUIDs for Nostr boost tagging
  feedGuid?: string; // Feed-level GUID
  publisherGuid?: string; // Publisher GUID
  publisherUrl?: string; // Publisher URL
  imageUrl?: string; // Album artwork URL
}


export default function HomePage() {
  const router = useRouter();
  const { isLightningEnabled } = useLightning();
  const [isLoading, setIsLoading] = useState(true);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [publishers, setPublishers] = useState<any[]>([]);
  const [pinnedAlbums, setPinnedAlbums] = useState<string[]>([
    "Disco Swag - The Album",
    "Bloodshot Lies - The Album",
    "Music From The Doerfel-Verse",
    "Autumn Rust",
    "Ben Doerfel",
    "Jam with Nate",
    "Beware of Banjo"
  ]);
  const [pinnedEPs, setPinnedEPs] = useState<string[]>([
    "Think EP",
    "Think EP LIVE!"
  ]);
  const [error, setError] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [totalFeedsCount, setTotalFeedsCount] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  
  // Boost modal state
  const [showBoostModal, setShowBoostModal] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [boostAmount, setBoostAmount] = useState(50);
  const [senderName, setSenderName] = useState('');
  const [boostMessage, setBoostMessage] = useState('');
  const [showSplits, setShowSplits] = useState(false);
  
  // Video boost modal state
  const [showVideoBoostModal, setShowVideoBoostModal] = useState(false);
  const [selectedVideoTrack, setSelectedVideoTrack] = useState<(Track & { album: Album }) | null>(null);
  const [videoBoostAmount, setVideoBoostAmount] = useState(50);
  const [videoBoostMessage, setVideoBoostMessage] = useState('');
  const [showVideoSplits, setShowVideoSplits] = useState(false);
  
  // Global audio and video context
  const { playAlbumAndOpenNowPlaying: globalPlayAlbum, toggleShuffle, pause: globalPause, isPlaying: globalIsPlaying } = useAudio();
  const videoContext = useVideo();
  const { playVideo: globalPlayVideo, currentVideo, isPlaying: isVideoPlaying, pause: pauseVideo, resume: resumeVideo, updateCurrentTime, updateDuration, seekRequest, stop: stopVideo } = videoContext;
  const hasLoadedRef = useRef(false);
  const videoPlayerRef = useRef<HTMLDivElement>(null);
  
  // Handle boost button click from album card
  const handleBoostClick = (album: Album) => {
    setSelectedAlbum(album);
    setShowBoostModal(true);
  };
  
  // Handle boost success
  const handleBoostSuccess = (response: any) => {
    setShowBoostModal(false);
    setBoostMessage(''); // Clear the message input after successful boost
    
    // Trigger confetti animation (wrapped in try/catch for privacy browsers that block canvas)
    try {
      const count = 200;
      const defaults = {
        origin: { y: 0.7 },
        colors: ['#FFD700', '#FFA500', '#FF8C00', '#FFE55C', '#FFFF00']
      };

      const fire = (particleRatio: number, opts: any) => {
        confetti(Object.assign({}, defaults, opts, {
          particleCount: Math.floor(count * particleRatio)
        }));
      };

      fire(0.25, { spread: 26, startVelocity: 55 });
      fire(0.2, { spread: 60 });
      fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
      fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
      fire(0.1, { spread: 120, startVelocity: 45 });
    } catch (e) {
      // Canvas-based confetti may be blocked by privacy browsers (e.g., DuckDuckGo)
    }

    toast.success('⚡ Boost sent successfully!');
  };
  
  const handleBoostError = (error: string) => {
    toast.error('Failed to send boost');
  };
  
  // Handle video boost success
  const handleVideoBoostSuccess = (response: any) => {
    setShowVideoBoostModal(false);
    setVideoBoostMessage('');
    
    // Trigger confetti animation (wrapped in try/catch for privacy browsers that block canvas)
    try {
      const count = 200;
      const defaults = {
        origin: { y: 0.7 }
      };

      const fire = (particleRatio: number, opts: any) => {
        confetti({
          ...defaults,
          ...opts,
          particleCount: Math.floor(count * particleRatio)
        });
      };

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
    } catch (e) {
      // Canvas-based confetti may be blocked by privacy browsers (e.g., DuckDuckGo)
    }

    toast.success('⚡ Boost sent successfully!');
  };
  
  const handleVideoBoostError = (error: string) => {
    toast.error('Failed to send boost');
  };
  
  // Static background state
  const [backgroundImageLoaded, setBackgroundImageLoaded] = useState(false);

  // Controls state
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [viewType, setViewType] = useState<ViewType>('grid');

  // Shuffle functionality
  const handleShuffle = () => {
    try {
      toggleShuffle();
      toast.success('🎲 Shuffle toggled!');
    } catch (error) {
      toast.error('Error toggling shuffle');
    }
  };

  // Shuffle All functionality
  const handleShuffleAll = () => {
    try {
      // Collect all tracks from all albums, excluding test feeds
      const allTracks: any[] = [];
      
      albums.forEach(album => {
        // Skip LNURL Testing Podcast and other test feeds from shuffle
        if (album.title === 'LNURL Testing Podcast') {
          return;
        }

        // Check if this is a Satellite Spotlight/Skirmish compilation album
        const isSatelliteAlbum = album.title?.toLowerCase().includes('satellite spotlight') ||
                                  album.title?.toLowerCase().includes('satellite skirmish') ||
                                  album.artist?.toLowerCase().includes('satellite skirmish') ||
                                  album.artist?.toLowerCase().includes('satellite spotlight');

        album.tracks.forEach(track => {
          // Skip video-only tracks (no audio URL) - shuffle is audio only
          if (!track.url) {
            return;
          }

          // For Satellite Spotlight/Skirmish albums, only include Doerfels and CityBeach tracks
          if (isSatelliteAlbum) {
            const titleLower = track.title?.toLowerCase() || '';
            const isDoerfels = titleLower.includes('doerfel');
            const isCityBeach = titleLower.includes('citybeach');
            if (!isDoerfels && !isCityBeach) {
              return;
            }
          }
          // Create track object that matches AudioContext's Track interface
          allTracks.push({
            title: track.title,
            duration: track.duration,
            url: track.url,
            trackNumber: track.trackNumber,
            image: track.image || album.coverArt,
            artist: album.artist || 'Unknown Artist',
            album: album.title,
            value: track.value,
            guid: track.guid,
            podcastGuid: track.podcastGuid,
            feedGuid: track.feedGuid,
            feedUrl: track.feedUrl,
            publisherGuid: track.publisherGuid,
            imageUrl: track.imageUrl
          });
        });
      });

      // Add the true crime promo to the shuffle list
      allTracks.push({
        title: "Into the Doerfelverse True Crime Promo",
        duration: "00:00", // Will be set when audio loads
        url: "/into%20the%20doerfelverse%20true%20crime%20promo.mp3",
        trackNumber: 999, // High number to put it at end if not shuffled
        image: "/ITDV-lightning-logo.webp", // Use ITDV logo
        artist: "The Doerfels",
        website: "https://www.doerfelverse.com/", // Link to main Doerfelverse site
        value: {
          type: "lightning",
          method: "keysend",
          suggested: "25",
          recipients: [
            {
              type: "node",
              address: "035ad2c954e264004986da2d9499e1732e5175e1dcef2453c921c6cdcc3536e9d8",
              split: 100,
              name: "The Doerfels",
              fee: false
            }
          ]
        },
        guid: "promo-true-crime-001",
        feedGuid: "doerfels-main-feed",
        publisherGuid: "doerfels-publisher"
      });

      // Add the promo two more times to increase chances of appearing in shuffle
      allTracks.push({
        title: "Into the Doerfelverse True Crime Promo",
        duration: "00:00", // Will be set when audio loads
        url: "/into%20the%20doerfelverse%20true%20crime%20promo.mp3",
        trackNumber: 999, // High number to put it at end if not shuffled
        image: "/ITDV-lightning-logo.webp", // Use ITDV logo
        artist: "The Doerfels",
        website: "https://www.doerfelverse.com/", // Link to main Doerfelverse site
        value: {
          type: "lightning",
          method: "keysend",
          suggested: "25",
          recipients: [
            {
              type: "node",
              address: "035ad2c954e264004986da2d9499e1732e5175e1dcef2453c921c6cdcc3536e9d8",
              split: 100,
              name: "The Doerfels",
              fee: false
            }
          ]
        },
        guid: "promo-true-crime-002",
        feedGuid: "doerfels-main-feed",
        publisherGuid: "doerfels-publisher"
      });

      allTracks.push({
        title: "Into the Doerfelverse True Crime Promo",
        duration: "00:00", // Will be set when audio loads
        url: "/into%20the%20doerfelverse%20true%20crime%20promo.mp3",
        trackNumber: 999, // High number to put it at end if not shuffled
        image: "/ITDV-lightning-logo.webp", // Use ITDV logo
        artist: "The Doerfels",
        website: "https://www.doerfelverse.com/", // Link to main Doerfelverse site
        value: {
          type: "lightning",
          method: "keysend",
          suggested: "25",
          recipients: [
            {
              type: "node",
              address: "035ad2c954e264004986da2d9499e1732e5175e1dcef2453c921c6cdcc3536e9d8",
              split: 100,
              name: "The Doerfels",
              fee: false
            }
          ]
        },
        guid: "promo-true-crime-003",
        feedGuid: "doerfels-main-feed",
        publisherGuid: "doerfels-publisher"
      });

      // Shuffle the tracks array using Fisher-Yates shuffle algorithm
      const shuffledTracks = [...allTracks];
      for (let i = shuffledTracks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledTracks[i], shuffledTracks[j]] = [shuffledTracks[j], shuffledTracks[i]];
      }

      // Start playing the shuffled playlist
      globalPlayAlbum(shuffledTracks, 0, 'Shuffle All');
      
      toast.success(`🎲 Shuffling ${allTracks.length} tracks from all albums!`);
    } catch (error) {
      console.error('Error shuffling all tracks:', error);
      toast.error('Error shuffling all tracks');
    }
  };

  useEffect(() => {
    setIsClient(true);
    
    // Load saved sender name
    const savedSenderName = safeLocalStorage.getItem('boost-sender-name');
    if (savedSenderName) {
      setSenderName(savedSenderName);
    }
    
    // Add scroll detection for mobile
    let scrollTimer: NodeJS.Timeout;
    const handleScroll = () => {
      document.body.classList.add('is-scrolling');
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        document.body.classList.remove('is-scrolling');
      }, 150);
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('touchmove', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('touchmove', handleScroll);
      clearTimeout(scrollTimer);
    };
  }, []);

  useEffect(() => {
    // Prevent multiple loads
    if (hasLoadedRef.current) {
      return;
    }
    
    hasLoadedRef.current = true;
    
    // Check for cached data first - show immediately even if stale (stale-while-revalidate pattern)
    const cachedAlbums = safeLocalStorage.getItem('cachedAlbums');
    const cacheTime = safeLocalStorage.getItem('albumsCacheTimestamp');
    
    if (cachedAlbums && cacheTime) {
      const cacheAge = Date.now() - parseInt(cacheTime);
      const albums = JSON.parse(cachedAlbums);
      
      // Show cached data immediately (even if stale) for instant page load
      setAlbums(albums);
      setIsLoading(false);
      
      // If cache is fresh (< 10 min), delay background refresh
      // If cache is stale, refresh immediately in background
      if (cacheAge < 10 * 60 * 1000) {
        // Fresh cache - refresh in background after a delay
        if ('requestIdleCallback' in window) {
          requestIdleCallback(() => loadCriticalAlbums(), { timeout: 3000 });
        } else {
          setTimeout(() => loadCriticalAlbums(), 500);
        }
      } else {
        // Stale cache - refresh immediately but don't block UI
        // Use setTimeout to allow UI to render first
        setTimeout(() => {
          loadCriticalAlbums().catch(() => {
            // Silently handle errors - we already have cached data
          });
        }, 0);
      }
      return;
    }
    
    // No cache - load fresh data (but show loading state immediately)
    loadCriticalAlbums();
  }, []); // Run only once on mount

  // Static background loading
  useEffect(() => {
    // Set a small delay to ensure the background image has time to load
    const timer = setTimeout(() => {
      setBackgroundImageLoaded(true);
    }, 100);
    
    return () => clearTimeout(timer);
  }, []);

  // Load all albums and publishers
  const loadCriticalAlbums = useCallback(async () => {
    try {
      // Only show loading if we don't already have albums (from cache)
      if (albums.length === 0) {
        setIsLoading(true);
        setLoadingProgress(0);
      }
      setError(null);
      
      // Load albums and update state immediately when ready
      const allAlbums = await loadAlbumsData();
      
      // Only update if we got new data (avoid unnecessary re-renders)
      if (allAlbums && allAlbums.length > 0) {
        setAlbums(allAlbums);
      }
      
      setLoadingProgress(90);
      
      // Preload colors for first albums for instant Now Playing screen (non-blocking)
      const firstAlbumTitles = allAlbums.slice(0, 10).map((album: any) => album.title);
      preloadCriticalColors(firstAlbumTitles).catch(() => {
        // Silently handle errors
      });
      
      // Load static publisher data in parallel (non-blocking)
      fetch('/publishers.json')
        .then(publisherResponse => {
          if (publisherResponse.ok) {
            return publisherResponse.json();
          }
          return null;
        })
        .then(staticPublishers => {
          if (staticPublishers) {
            setPublishers(staticPublishers);
          }
        })
        .catch(() => {
          // Silently handle errors
        });

      // Load pinned albums and EPs order (non-blocking)
      fetch('/api/pinned-albums')
        .then(pinnedResponse => {
          if (pinnedResponse.ok) {
            return pinnedResponse.json();
          }
          return null;
        })
        .then(pinnedData => {
          if (pinnedData?.pinnedAlbums && Array.isArray(pinnedData.pinnedAlbums)) {
            setPinnedAlbums(pinnedData.pinnedAlbums);
          }
          if (pinnedData?.pinnedEPs && Array.isArray(pinnedData.pinnedEPs)) {
            setPinnedEPs(pinnedData.pinnedEPs);
          }
        })
        .catch(() => {
          // Silently handle errors - use default pinned order
        });
      
      setLoadingProgress(100);
      setIsLoading(false);
      
    } catch (error) {
      // Only show error if we don't have cached data
      if (albums.length === 0) {
        setError('Failed to load albums');
        setIsLoading(false);
      }
      // If we have cached data, silently fail - user already sees content
    }
  }, [albums.length]);

  // Helper function to fetch with timeout
  const fetchWithTimeout = async (url: string, timeoutMs: number = 5000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  };

  const loadAlbumsData = async () => {
    try {
      // Check for cache-busting query parameter
      const urlParams = new URLSearchParams(window.location.search);
      const forceRefresh = urlParams.get('refresh') === '1' || urlParams.get('nocache') === '1';
      
      // Clear client-side cache if force refresh requested
      if (forceRefresh && typeof window !== 'undefined') {
        safeLocalStorage.removeItem('cachedAlbums');
        safeLocalStorage.removeItem('albumsCacheTimestamp');
        console.log('🔄 Client-side cache cleared due to refresh parameter');
      }
      
      // Check for cached albums first - use longer cache time for better performance
      if (!forceRefresh && typeof window !== 'undefined') {
        const cached = safeLocalStorage.getItem('cachedAlbums');
        const cacheTime = safeLocalStorage.getItem('albumsCacheTimestamp');

        // Use cache if less than 30 minutes old (extended from 10 minutes)
        if (cached && cacheTime && (Date.now() - parseInt(cacheTime)) < 30 * 60 * 1000) {
          return JSON.parse(cached);
        }
      }

      // Use static cached data for fast loading (optimized timeouts)
      let response;
      let data;

      try {
        // Try the fastest endpoint first (in-memory cached) with shorter timeout
        // Add refresh parameter to force server-side cache clear
        const staticUrl = forceRefresh ? '/api/albums-static-cached?refresh=1' : '/api/albums-static-cached';
        response = await fetchWithTimeout(staticUrl, 1000);
        if (response?.ok) {
          data = await response.json();
        }
      } catch (error) {
        // Silently handle errors - will try fallback
      }

      // Only try fallback if static cache failed (with longer timeout for RSS parsing)
      // Add refresh parameter to force server-side cache clear
      if (!data) {
        try {
          const albumsUrl = forceRefresh ? '/api/albums?refresh=1' : '/api/albums';
          response = await fetchWithTimeout(albumsUrl, 3000);
          if (response?.ok) {
            data = await response.json();
          }
        } catch (error) {
          // Silently handle errors
        }
      }

      if (!data) {
        throw new Error('Failed to fetch albums: All endpoints failed');
      }
      
      const albums = data.albums || [];
      
      setLoadingProgress(75);
      
      // Deduplicate albums
      const albumMap = new Map<string, Album>();
      
      albums.forEach((album: Album) => {
        const key = `${album.title.toLowerCase()}|${album.artist.toLowerCase()}`;
        if (!albumMap.has(key)) {
          albumMap.set(key, album);
        }
      });
      
      const uniqueAlbums = Array.from(albumMap.values());
      
      // Cache all albums - no tier-based restrictions
      if (typeof window !== 'undefined') {
        try {
          safeLocalStorage.setItem('cachedAlbums', JSON.stringify(uniqueAlbums));
          safeLocalStorage.setItem('albumsCacheTimestamp', Date.now().toString());
        } catch (error) {
          // Silently handle errors
        }
      }
      
      return uniqueAlbums;
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Error loading album data: ${errorMessage}`);
      toast.error(`Failed to load albums: ${errorMessage}`);
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  const playAlbum = async (album: Album, e: React.MouseEvent | React.TouchEvent) => {
    // Only prevent default/propagation for the play button, not the entire card
    e.stopPropagation();
    
    // For "The Satellite Spotlight" album, find the first CityBeach audio track (Doerfels track)
    // Otherwise, find the first playable track
    let startIndex = 0;
    const isSatelliteSpotlight = album.title?.toLowerCase().includes('satellite spotlight') || 
                                  album.artist?.toLowerCase().includes('satellite skirmish');
    
    if (isSatelliteSpotlight) {
      // Find the first audio track (not video) with "CityBeach" in the title
      const cityBeachTrackIndex = album.tracks.findIndex(track => 
        track.url && 
        !track.videoUrl && 
        track.title?.toLowerCase().includes('citybeach')
      );
      
      if (cityBeachTrackIndex !== -1) {
        startIndex = cityBeachTrackIndex;
      } else {
        // Fallback to first playable track if no CityBeach track found
        const firstTrack = album.tracks.find(track => track.url && !track.videoUrl);
        if (firstTrack) {
          startIndex = album.tracks.indexOf(firstTrack);
        }
      }
    } else {
      // For other albums, find the first playable track
      const firstTrack = album.tracks.find(track => track.url);
      if (firstTrack) {
        startIndex = album.tracks.indexOf(firstTrack);
      }
    }
    
    const startTrack = album.tracks[startIndex];
    if (!startTrack || !startTrack.url) {
      setError('No playable tracks found in this album');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      // Use global audio context to play album
      const audioTracks = album.tracks.map(track => ({
        ...track,
        artist: album.artist,
        album: album.title,
        image: track.image || album.coverArt
      }));
      
      globalPlayAlbum(audioTracks, startIndex, album.title);
    } catch (error) {
      let errorMessage = 'Unable to play audio - please try again';
      
      if (error instanceof DOMException) {
        switch (error.name) {
          case 'NotAllowedError':
            errorMessage = 'Tap the play button again to start playback';
            break;
          case 'NotSupportedError':
            errorMessage = 'Audio format not supported on this device';
            break;
        }
      }
      
      setError(errorMessage);
      toast.error(errorMessage);
      
      setTimeout(() => setError(null), 5000);
    }
  };

  // Helper function to get all video tracks (filtered to only show 'doerfels' and 'citybeach' videos)
  const getAllVideoTracks = useCallback(() => {
    const videoTracks: Array<Track & { album: Album }> = [];
    
    albums.forEach(album => {
      if (album.title === 'LNURL Testing Podcast') return;
      
      album.tracks.forEach(track => {
        if (track.videoUrl) {
          // Filter to only include 'doerfels' and 'citybeach' videos
          const trackTitleLower = track.title?.toLowerCase() || '';
          const albumTitleLower = album.title?.toLowerCase() || '';
          const artistLower = album.artist?.toLowerCase() || '';
          
          const isDoerfels = trackTitleLower.includes('doerfel') || 
                           albumTitleLower.includes('doerfel') || 
                           artistLower.includes('doerfel');
          
          const isCityBeach = trackTitleLower.includes('citybeach') || 
                             trackTitleLower.includes('city beach') ||
                             albumTitleLower.includes('citybeach') || 
                             albumTitleLower.includes('city beach') ||
                             artistLower.includes('citybeach') ||
                             artistLower.includes('city beach');
          
          if (isDoerfels || isCityBeach) {
            videoTracks.push({
              ...track,
              album: album
            });
          }
        }
      });
    });
    
    // Sort by album title, then by track number
    return videoTracks.sort((a, b) => {
      const albumCompare = a.album.title.localeCompare(b.album.title);
      if (albumCompare !== 0) return albumCompare;
      return a.trackNumber - b.trackNumber;
    });
  }, [albums]);

  // Helper functions for filtering and sorting
  const getFilteredAlbums = () => {
    // Filter out LNURL Testing Podcast from main page display (accessible via sidebar)
    const albumsToUse = albums.filter(album => album.title !== 'LNURL Testing Podcast');
    
          // Universal sorting function that implements hierarchical order: Pinned → Albums → EPs → Singles
      const sortWithHierarchy = (albumsToSort: Album[]) => {
        return albumsToSort.sort((a, b) => {
          // Determine types
          const aIsAlbum = a.tracks.length > 6;
          const bIsAlbum = b.tracks.length > 6;
          const aIsEP = a.tracks.length > 1 && a.tracks.length <= 6;
          const bIsEP = b.tracks.length > 1 && b.tracks.length <= 6;
          const aIsSingle = a.tracks.length === 1;
          const bIsSingle = b.tracks.length === 1;

          // Get pinned index based on type
          const aIndex = aIsAlbum ? pinnedAlbums.indexOf(a.title) : aIsEP ? pinnedEPs.indexOf(a.title) : -1;
          const bIndex = bIsAlbum ? pinnedAlbums.indexOf(b.title) : bIsEP ? pinnedEPs.indexOf(b.title) : -1;

          // Albums come first
          if (aIsAlbum && !bIsAlbum) return -1;
          if (!aIsAlbum && bIsAlbum) return 1;

          // If both are albums, check pinned order
          if (aIsAlbum && bIsAlbum) {
            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return a.title.localeCompare(b.title);
          }
          
          // EPs come second (if both are not albums)
          if (aIsEP && !bIsEP) return -1;
          if (!aIsEP && bIsEP) return 1;

          // If both are EPs, check pinned order
          if (aIsEP && bIsEP) {
            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return a.title.localeCompare(b.title);
          }

          // Singles come last (if both are not albums or EPs)
          if (aIsSingle && !bIsSingle) return -1;
          if (!aIsSingle && bIsSingle) return 1;

          // If same type (singles), sort by title
          return a.title.localeCompare(b.title);
        });
      };
    
    // Apply filtering based on active filter
    let filtered = albumsToUse;
    
    switch (activeFilter) {
      case 'albums':
        filtered = albumsToUse.filter(album => album.tracks.length > 6);
        break;
      case 'eps':
        filtered = albumsToUse.filter(album => album.tracks.length > 1 && album.tracks.length <= 6);
        break;
      case 'singles':
        filtered = albumsToUse.filter(album => album.tracks.length === 1);
        break;
      case 'video':
        // For video filter, return empty array - we'll show videos separately
        return [];
      case 'publishers':
        // For publishers filter, we'll show publishers instead of albums
        return publishers;
      default: // 'all'
        filtered = albumsToUse;
    }

    // Apply hierarchical sorting to filtered results
    return sortWithHierarchy(filtered);
  };

  const filteredAlbums = getFilteredAlbums();
  const videoTracks = activeFilter === 'video' ? getAllVideoTracks() : [];

  // Handle video play
  const handlePlayVideo = (track: Track & { album: Album }) => {
    if (!track.videoUrl) return;
    
    // Pause audio if playing
    if (globalIsPlaying) {
      globalPause();
    }
    
    // Play video
    globalPlayVideo({
      title: track.title,
      duration: track.duration,
      videoUrl: track.videoUrl,
      trackNumber: track.trackNumber,
      image: track.image || track.album.coverArt,
      artist: track.album.artist,
      album: track.album.title,
      startTime: track.startTime,
      endTime: track.endTime,
      value: track.value,
      guid: track.guid,
      podcastGuid: track.podcastGuid,
      feedGuid: track.feedGuid,
      feedUrl: track.feedUrl,
      publisherGuid: track.publisherGuid,
      publisherUrl: track.publisherUrl,
      imageUrl: track.imageUrl
    }, track.album.title);
    
    // Scroll to video player after a short delay to ensure it's rendered
    setTimeout(() => {
      if (videoPlayerRef.current) {
        videoPlayerRef.current.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }
    }, 100);
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


  return (
    <div className="min-h-screen text-white relative overflow-hidden">
      {/* Bloodshot Lies Album Art Background */}
      <div className="fixed inset-0 z-0">
        <Image
          src="/bloodshot-lies-big.png"
          alt="Bloodshot Lies Album Art"
          fill
          className="object-cover w-full h-full"
          loading="eager"
          quality={40}
          sizes="100vw"
          placeholder="blur"
          blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k="
        />
        <div className="absolute inset-0 bg-black/60"></div>
      </div>

      {/* Content overlay */}
      <div className="relative z-10">
        {/* Header */}
        <header className="border-b backdrop-blur-sm bg-black/30 pt-6" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
          <div className="container mx-auto px-6 py-2">
            {/* Mobile Header */}
            <div className="block sm:hidden mb-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition-colors"
                    aria-label="Toggle menu"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                  <div className="w-10 h-10 relative border border-gray-700 rounded-lg overflow-hidden">
                    <Image 
                      src="/ITDV-lightning-logo.jpg" 
                      alt="HPM Lightning Logo" 
                      width={40} 
                      height={40}
                      className="object-cover"
                      loading="lazy"
                      quality={60}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {isLightningEnabled && <BitcoinConnectWallet />}
                  <Link 
                    href="/about" 
                    className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <span className="text-sm">About</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </Link>
                </div>
              </div>
              <div className="text-center">
                <h1 className="text-xl font-bold mb-1">Into the Doerfel-Verse</h1>


              </div>
            </div>

            {/* Desktop Header */}
            <div className="hidden sm:block mb-4">
              <div className="relative flex items-center justify-center">
                <div className="absolute left-0 flex items-center gap-4">
                  <button
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition-colors"
                    aria-label="Toggle menu"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                  <div className="w-10 h-10 relative border border-gray-700 rounded-lg overflow-hidden">
                    <Image 
                      src="/ITDV-lightning-logo.jpg" 
                      alt="HPM Lightning Logo" 
                      width={40} 
                      height={40}
                      className="object-cover"
                      loading="lazy"
                      quality={60}
                    />
                  </div>
                </div>
                <div className="text-center">
                  <h1 className="text-3xl font-bold mb-1">Into the Doerfel-Verse</h1>


                </div>
                <div className="absolute right-0 flex items-center gap-4">
                  {isLightningEnabled && <BitcoinConnectWallet />}
                  <Link
                    href="/about"
                    className="inline-flex items-center text-blue-400 hover:text-blue-300 transition-colors"
                    title="About this site"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </Link>
                </div>
              </div>
            </div>
            
            {/* Loading/Error Status */}
            {isClient && (
              <div className="flex items-center gap-2 text-sm">
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></span>
                    <span className="text-yellow-400">
                      Loading albums...
                      {loadingProgress > 0 && ` (${Math.round(loadingProgress)}%)`}
                    </span>
                  </div>
                ) : error ? (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-red-400 rounded-full"></span>
                    <span className="text-red-400">{error}</span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </header>
        
        {/* Sidebar */}
        <div className={`fixed top-0 left-0 h-full w-80 bg-gray-900/95 backdrop-blur-sm transform transition-transform duration-300 z-50 border-r border-gray-700 pointer-events-auto ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="p-4 pt-16 flex flex-col h-full">
            <h2 className="text-lg font-bold mb-4">Menu</h2>
            
            <div className="mb-4 space-y-1">
              <a
                href="/about"
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-800/50 transition-colors cursor-pointer relative z-10 pointer-events-auto"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsSidebarOpen(false);
                  window.location.href = '/about';
                }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm">About & Support</span>
              </a>

              <a
                href="/boosts"
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-800/50 transition-colors cursor-pointer relative z-10 pointer-events-auto"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsSidebarOpen(false);
                  window.location.href = '/boosts';
                }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-sm">⚡ Boosts</span>
              </a>
            </div>
            
            {/* Lightning Toggle - moved up to avoid being hidden by now playing bar */}
            <div className="pt-4 border-t border-gray-700">
              <LightningToggle />
            </div>
            
            <div className="mt-auto pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Version</span>
                <span className="text-xs text-gray-400 font-mono">{getVersionString()}</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Overlay */}
        {isSidebarOpen && (
          <div 
            className="fixed top-0 right-0 bottom-0 bg-black/50 z-40 pointer-events-auto" 
            style={{ left: '320px' }}
            onClick={() => {
              setIsSidebarOpen(false);
            }}
          />
        )}
        
        {/* Main Content */}
        <div className="container mx-auto px-3 sm:px-6 py-6 sm:py-8 pb-28">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <LoadingSpinner 
                size="large"
                text="Loading music feeds..."
                showProgress={false}
              />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <h2 className="text-2xl font-semibold mb-4 text-red-400">Error Loading Albums</h2>
              <p className="text-gray-400">{error}</p>
              <button 
                onClick={() => loadCriticalAlbums()}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Retry
              </button>
            </div>
          ) : (activeFilter === 'video' ? videoTracks.length > 0 : filteredAlbums.length > 0) ? (
            <div className="max-w-7xl mx-auto">
              {/* Controls Bar */}
              <ControlsBar
                activeFilter={activeFilter}
                onFilterChange={setActiveFilter}
                viewType={viewType}
                onViewChange={setViewType}
                showShuffle={false}
                onShuffle={handleShuffle}
                showShuffleAll={true}
                onShuffleAll={handleShuffleAll}
                resultCount={activeFilter === 'video' ? videoTracks.length : filteredAlbums.length}
                resultLabel={activeFilter === 'all' ? 'Releases' : 
                  activeFilter === 'albums' ? 'Albums' :
                  activeFilter === 'eps' ? 'EPs' : 
                  activeFilter === 'singles' ? 'Singles' : 
                  activeFilter === 'video' ? 'Videos' :
                  activeFilter === 'publishers' ? 'Artists' : 'Releases'}
                className="mb-8"
              />


              {/* Videos Display */}
              {activeFilter === 'video' ? (
                viewType === 'grid' ? (
                  <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                    {videoTracks.map((track, index) => (
                      <div
                        key={`video-${track.album.title}-${track.trackNumber}-${index}`}
                        className="group relative bg-white/5 backdrop-blur-sm rounded-xl overflow-hidden border border-white/10 hover:border-white/20 transition-all duration-200 cursor-pointer"
                        onClick={() => handlePlayVideo(track)}
                      >
                        {/* Video Thumbnail */}
                        <div className="relative aspect-square w-full">
                          <Image
                            src={track.image || track.album.coverArt}
                            alt={track.title}
                            fill
                            className="object-cover"
                            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                            priority={index < 8}
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="bg-white/20 backdrop-blur-sm rounded-full p-3">
                              <Play className="w-6 h-6 text-white fill-white" />
                            </div>
                          </div>
                          {/* Video Badge */}
                          <div className="absolute top-2 right-2 bg-purple-500/90 backdrop-blur-sm rounded-full px-2 py-1 flex items-center gap-1">
                            <Video className="w-3 h-3 text-white" />
                          </div>
                        </div>

                        {/* Video Info */}
                        <div className="p-2 sm:p-3 bg-black/70 backdrop-blur-sm">
                          <h3 className="font-semibold text-sm sm:text-base truncate mb-1 group-hover:text-blue-400 transition-colors">
                            {track.title}
                          </h3>
                          <p className="text-xs sm:text-sm text-gray-400 truncate">{track.album.artist}</p>
                          <p className="text-xs text-gray-500 truncate mt-1">{track.album.title}</p>
                          <div className="flex items-center justify-between mt-2 gap-2">
                            <span className="text-xs text-gray-400 font-mono">{formatDuration(track.duration)}</span>
                            <div className="flex items-center gap-2">
                              {/* Boost Button */}
                              {isLightningEnabled && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedVideoTrack(track);
                                    setShowVideoBoostModal(true);
                                  }}
                                  className="inline-flex items-center gap-1 bg-gradient-to-r from-yellow-500 to-orange-600 text-white px-2 py-1 rounded text-xs font-medium transition-all duration-200 hover:from-yellow-400 hover:to-orange-500 hover:shadow-lg transform hover:scale-105 active:scale-95"
                                  title="Boost this video"
                                >
                                  <Zap className="w-3 h-3" />
                                  <span className="hidden sm:inline">Boost</span>
                                </button>
                              )}
                              <Link
                                href={`/album/${encodeURIComponent(track.album.title.toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, ''))}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                              >
                                View Album
                              </Link>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {videoTracks.map((track, index) => (
                      <div
                        key={`video-${track.album.title}-${track.trackNumber}-${index}`}
                        className="group flex items-center gap-4 p-4 bg-white/5 backdrop-blur-sm rounded-xl hover:bg-white/10 transition-all duration-200 border border-white/10 hover:border-white/20 cursor-pointer"
                        onClick={() => handlePlayVideo(track)}
                      >
                        <div className="w-16 h-16 relative rounded-lg overflow-hidden flex-shrink-0">
                          <Image
                            src={track.image || track.album.coverArt}
                            alt={track.title}
                            fill
                            className="object-cover"
                            sizes="64px"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Play className="w-4 h-4 text-white fill-white" />
                          </div>
                          <div className="absolute top-1 right-1 bg-purple-500/90 backdrop-blur-sm rounded-full p-1">
                            <Video className="w-2.5 h-2.5 text-white" />
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-lg group-hover:text-blue-400 transition-colors truncate">
                            {track.title}
                          </h3>
                          <p className="text-sm text-gray-400 truncate">{track.album.artist}</p>
                          <p className="text-xs text-gray-500 truncate mt-1">{track.album.title}</p>
                        </div>

                        <div className="flex items-center gap-4 text-sm text-gray-400">
                          <span className="font-mono">{formatDuration(track.duration)}</span>
                          <div className="flex items-center gap-2">
                            {/* Boost Button */}
                            {isLightningEnabled && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedVideoTrack(track);
                                  setShowVideoBoostModal(true);
                                }}
                                className="inline-flex items-center gap-1 bg-gradient-to-r from-yellow-500 to-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 hover:from-yellow-400 hover:to-orange-500 hover:shadow-lg transform hover:scale-105 active:scale-95"
                                title="Boost this video"
                              >
                                <Zap className="w-4 h-4" />
                                <span>Boost</span>
                              </button>
                            )}
                            <Link
                              href={`/album/${encodeURIComponent(track.album.title.toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, ''))}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                            >
                              View Album
                            </Link>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : activeFilter === 'publishers' ? (
                // Publishers display
                <div className="space-y-4">
                  {filteredAlbums.map((publisher: any, index: number) => (
                    <PublisherCard
                      key={`publisher-${index}`}
                      publisher={publisher}
                    />
                  ))}
                </div>
              ) : activeFilter === 'all' ? (
                // Original sectioned layout for "All" filter
                <>
                  {/* Albums Grid */}
                  {(() => {
                    const albumsWithMultipleTracks = filteredAlbums.filter(album => album.tracks.length > 6);
                    return albumsWithMultipleTracks.length > 0 && (
                      <div className="mb-12">
                        <h2 className="text-2xl font-bold mb-6">Albums</h2>
                        {viewType === 'grid' ? (
                          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                            {albumsWithMultipleTracks.map((album, index) => {
                              // For GIFs, prioritize first 12 (increased from 8) to improve above-fold loading
                              // Non-GIFs can prioritize more since they're smaller
                              // Also prioritize Autumn Rust specifically (large 39MB GIF) - always prioritize if it's a GIF
                              // This ensures it starts loading immediately even if it's not in the first 12
                              const isGif = album.coverArt.toLowerCase().includes('.gif');
                              const isAutumnRust = album.title?.toLowerCase().includes('autumn rust');
                              const shouldPrioritize = isGif ? (index < 12 || isAutumnRust) : index < 16;
                              
                              return (
                                <AlbumCard
                                  key={`album-${index}`}
                                  album={album}
                                  onPlay={playAlbum}
                                  onBoostClick={handleBoostClick}
                                  priority={shouldPrioritize}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {albumsWithMultipleTracks.map((album, index) => (
                              <Link
                                key={`album-${index}`}
                                href={`/album/${encodeURIComponent(album.title.toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, ''))}`}
                                className="group flex items-center gap-4 p-4 bg-white/5 backdrop-blur-sm rounded-xl hover:bg-white/10 transition-all duration-200 border border-white/10 hover:border-white/20"
                              >
                                <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                                  <Image 
                                    src={album.coverArt} 
                                    alt={album.title}
                                    width={64}
                                    height={64}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-semibold text-lg group-hover:text-blue-400 transition-colors truncate">
                                    {album.title}
                                  </h3>
                                  <p className="text-gray-400 text-sm truncate">{album.artist}</p>
                                </div>
                                
                                <div className="flex items-center gap-4 text-sm text-gray-400">
                                  <span>{new Date(album.releaseDate).getFullYear()}</span>
                                  <span>{album.tracks.length} tracks</span>
                                  <span className="px-2 py-1 bg-white/10 rounded text-xs">Album</span>
                                </div>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  
                  {/* EPs and Singles Grid */}
                  {(() => {
                    const epsAndSingles = filteredAlbums.filter(album => album.tracks.length <= 6);
                    return epsAndSingles.length > 0 && (
                      <div>
                        <h2 className="text-2xl font-bold mb-6">EPs and Singles</h2>
                        {viewType === 'grid' ? (
                          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                            {epsAndSingles.map((album, index) => (
                              <AlbumCard
                                key={`ep-single-${index}`}
                                album={album}
                                onPlay={playAlbum}
                                onBoostClick={handleBoostClick}
                                priority={index < 4} // Prioritize first 4 EPs/Singles
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {epsAndSingles.map((album, index) => (
                              <Link
                                key={`ep-single-${index}`}
                                href={`/album/${encodeURIComponent(album.title.toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, ''))}`}
                                className="group flex items-center gap-4 p-4 bg-white/5 backdrop-blur-sm rounded-xl hover:bg-white/10 transition-all duration-200 border border-white/10 hover:border-white/20"
                              >
                                <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                                  <Image 
                                    src={album.coverArt} 
                                    alt={album.title}
                                    width={64}
                                    height={64}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-semibold text-lg group-hover:text-blue-400 transition-colors truncate">
                                    {album.title}
                                  </h3>
                                  <p className="text-gray-400 text-sm truncate">{album.artist}</p>
                                </div>
                                
                                <div className="flex items-center gap-4 text-sm text-gray-400">
                                  <span>{new Date(album.releaseDate).getFullYear()}</span>
                                  <span>{album.tracks.length} tracks</span>
                                  <span className="px-2 py-1 bg-white/10 rounded text-xs">
                                    {album.tracks.length === 1 ? 'Single' : 'EP'}
                                  </span>
                                </div>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : (
                // Unified layout for specific filters (Albums, EPs, Singles)
                viewType === 'grid' ? (
                  <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                    {filteredAlbums.map((album, index) => (
                      <AlbumCard
                        key={`${album.title}-${index}`}
                        album={album}
                        onPlay={playAlbum}
                        onBoostClick={handleBoostClick}
                        priority={index < 8} // Prioritize first 8 images (above the fold)
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredAlbums.map((album, index) => (
                      <Link
                        key={`${album.title}-${index}`}
                        href={`/album/${encodeURIComponent(album.title.toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, ''))}`}
                        className="group flex items-center gap-4 p-4 bg-white/5 backdrop-blur-sm rounded-xl hover:bg-white/10 transition-all duration-200 border border-white/10 hover:border-white/20"
                      >
                        <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                          <Image 
                            src={album.coverArt} 
                            alt={album.title}
                            width={64}
                            height={64}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-lg group-hover:text-blue-400 transition-colors truncate">
                            {album.title}
                          </h3>
                          <p className="text-gray-400 text-sm truncate">{album.artist}</p>
                        </div>
                        
                        <div className="flex items-center gap-4 text-sm text-gray-400">
                          <span>{new Date(album.releaseDate).getFullYear()}</span>
                          <span>{album.tracks.length} tracks</span>
                          <span className="px-2 py-1 bg-white/10 rounded text-xs">
                            {album.tracks.length <= 6 ? (album.tracks.length === 1 ? 'Single' : 'EP') : 'Album'}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )
              )}

              {/* Video Player (when video is playing) - at bottom */}
              {currentVideo && currentVideo.videoUrl && (
                <div ref={videoPlayerRef} className="mt-8 mb-16 max-w-4xl mx-auto relative z-10">
                  <div className="bg-black/70 backdrop-blur-sm rounded-xl border border-white/20 overflow-hidden">
                    <div className="p-4 sm:p-6 border-b border-white/10 flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h2 className="text-lg sm:text-2xl font-bold text-white">Video Player</h2>
                        <p className="text-sm text-gray-300 mt-1 truncate">{currentVideo.title}</p>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                        {/* Video Boost Button */}
                        {isLightningEnabled && (
                          <button
                            onClick={() => {
                              setShowVideoBoostModal(true);
                            }}
                            className="inline-flex items-center justify-center gap-1 sm:gap-2 bg-gradient-to-r from-yellow-500 to-orange-600 text-white px-2 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all duration-200 hover:from-yellow-400 hover:to-orange-500 hover:shadow-lg transform hover:scale-105 active:scale-95 touch-manipulation min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 relative z-10"
                            title="Boost this video"
                          >
                            <Zap className="w-4 h-4 flex-shrink-0" />
                            <span className="hidden sm:inline">Boost</span>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            stopVideo();
                          }}
                          className="px-3 sm:px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors touch-manipulation min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center relative z-10"
                        >
                          <span className="hidden sm:inline">Close</span>
                          <svg className="w-5 h-5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="p-4 sm:p-6">
                      <VideoPlayer
                        videoUrl={currentVideo.videoUrl}
                        startTime={currentVideo.startTime}
                        endTime={currentVideo.endTime}
                        seekTime={seekRequest || undefined}
                        onTimeUpdate={updateCurrentTime}
                        onDurationChange={updateDuration}
                        onPlay={resumeVideo}
                        onPause={pauseVideo}
                        onEnded={() => {
                          stopVideo();
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12">
              {activeFilter === 'video' ? (
                <>
                  <h2 className="text-2xl font-semibold mb-4">No Videos Found</h2>
                  <p className="text-gray-400">
                    There are no videos available on the site at this time.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-semibold mb-4">No Albums Found</h2>
                  <p className="text-gray-400">
                    Unable to load album information from the RSS feeds.
                  </p>
                  <button 
                    onClick={() => loadCriticalAlbums()}
                    className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Retry Loading Albums
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Boost Modal - Rendered outside of album cards - only show when Lightning is enabled */}
      {isLightningEnabled && showBoostModal && selectedAlbum && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative bg-gradient-to-b from-gray-900 to-black rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[85vh] sm:max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-300">
            {/* Header with Album Art */}
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80 z-10" />
              <Image
                src={selectedAlbum.coverArt}
                alt={selectedAlbum.title}
                width={400}
                height={200}
                className="w-full h-32 sm:h-40 object-cover"
              />
              <button
                onClick={() => {
                  setShowBoostModal(false);
                  setSelectedAlbum(null);
                }}
                className="absolute top-4 right-4 z-20 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors backdrop-blur-sm"
              >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="absolute bottom-4 left-6 right-6 z-20">
                <h3 className="text-xl sm:text-2xl font-bold text-white mb-1">{selectedAlbum.title}</h3>
                <p className="text-sm sm:text-base text-gray-200">{selectedAlbum.artist}</p>
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
                      safeLocalStorage.setItem('boost-sender-name', e.target.value.trim());
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
                  onClick={() => setShowSplits(!showSplits)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-colors"
                >
                  <Info className="w-4 h-4" />
                  <span>{showSplits ? 'Hide' : 'Show'} Payment Splits</span>
                </button>
                
                {showSplits && (() => {
                  const recipients = (() => {
                    // Special case: Autumn Rust uses specific recipients for all boosts
                    if (selectedAlbum.title?.toLowerCase().includes('autumn rust')) {
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
                    if (selectedAlbum.title?.toLowerCase().includes('satellite spotlight')) {
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
                    if (selectedAlbum.tracks && selectedAlbum.tracks.length > 0) {
                      // Try to find CityBeach track first (for The Satellite Spotlight album)
                      const cityBeachTrack = selectedAlbum.tracks.find((t: any) => 
                        t.title?.trim().toLowerCase().includes('citybeach') && !t.videoUrl
                      );
                      
                      // Use CityBeach track if found, otherwise use first track
                      let trackToUse = cityBeachTrack || selectedAlbum.tracks[0];
                      
                      // For Disco Swag album, ensure we use track-level recipients (95/5) instead of channel-level (90/10)
                      // Try to find any track with track-level value/paymentRecipients
                      if (selectedAlbum.title?.toLowerCase().includes('disco swag')) {
                        const trackWithValue = selectedAlbum.tracks.find((t: any) => 
                          (t.paymentRecipients && t.paymentRecipients.length > 0) ||
                          (t.value && t.value.type === 'lightning' && t.value.method === 'keysend' && t.value.recipients && t.value.recipients.length > 0)
                        );
                        if (trackWithValue) {
                          trackToUse = trackWithValue;
                        }
                      }
                      
                      // Check if track has paymentRecipients (pre-processed)
                      if (trackToUse.paymentRecipients && trackToUse.paymentRecipients.length > 0) {
                        return trackToUse.paymentRecipients;
                      }
                      
                      // Check if track has value.recipients
                      if (trackToUse.value && trackToUse.value.type === 'lightning' && trackToUse.value.method === 'keysend') {
                        return trackToUse.value.recipients
                          .filter((r: any) => r.type === 'node')
                          .map((r: any) => ({
                            address: r.address,
                            split: r.split,
                            name: r.name,
                            fee: r.fee,
                            type: 'node'
                          }));
                      }
                    }
                    
                    // Fallback to album-level recipients if no track recipients found
                    if (selectedAlbum.value && selectedAlbum.value.type === 'lightning' && selectedAlbum.value.method === 'keysend') {
                      return selectedAlbum.value.recipients
                        .filter((r: any) => r.type === 'node')
                        .map((r: any) => ({
                          address: r.address,
                          split: r.split,
                          name: r.name,
                          fee: r.fee,
                          type: 'node'
                        }));
                    }
                    
                    return [];
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
                description={`Boost for ${selectedAlbum.title} by ${selectedAlbum.artist}`}
                onSuccess={handleBoostSuccess}
                onError={handleBoostError}
                className="w-full !mt-6"
                recipients={(() => {
                  // Special case: Autumn Rust uses specific recipients for all boosts
                  if (selectedAlbum.title?.toLowerCase().includes('autumn rust')) {
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
                  if (selectedAlbum.title?.toLowerCase().includes('satellite spotlight')) {
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
                  if (selectedAlbum.tracks && selectedAlbum.tracks.length > 0) {
                    // Try to find CityBeach track first (for The Satellite Spotlight album)
                    const cityBeachTrack = selectedAlbum.tracks.find((t: any) => 
                      t.title?.trim().toLowerCase().includes('citybeach') && !t.videoUrl
                    );
                    
                    // Use CityBeach track if found, otherwise use first track
                    let trackToUse = cityBeachTrack || selectedAlbum.tracks[0];
                    
                    // For Disco Swag album, ensure we use track-level recipients (95/5) instead of channel-level (90/10)
                    // Try to find any track with track-level value/paymentRecipients
                    if (selectedAlbum.title?.toLowerCase().includes('disco swag')) {
                      const trackWithValue = selectedAlbum.tracks.find((t: any) => 
                        (t.paymentRecipients && t.paymentRecipients.length > 0) ||
                        (t.value && t.value.type === 'lightning' && t.value.method === 'keysend' && t.value.recipients && t.value.recipients.length > 0)
                      );
                      if (trackWithValue) {
                        trackToUse = trackWithValue;
                      }
                    }
                    
                    // Check if track has paymentRecipients (pre-processed)
                    if (trackToUse.paymentRecipients && trackToUse.paymentRecipients.length > 0) {
                      return trackToUse.paymentRecipients;
                    }
                    
                    // Check if track has value.recipients
                    if (trackToUse.value && trackToUse.value.type === 'lightning' && trackToUse.value.method === 'keysend') {
                      return trackToUse.value.recipients
                        .filter((r: any) => r.type === 'node')
                        .map((r: any) => ({
                          address: r.address,
                          split: r.split,
                          name: r.name,
                          fee: r.fee,
                          type: 'node'
                        }));
                    }
                  }
                  
                  // Fallback to album-level recipients if no track recipients found
                  if (selectedAlbum.value && selectedAlbum.value.type === 'lightning' && selectedAlbum.value.method === 'keysend') {
                    return selectedAlbum.value.recipients
                      .filter((r: any) => r.type === 'node')
                      .map((r: any) => ({
                        address: r.address,
                        split: r.split,
                        name: r.name,
                        fee: r.fee,
                        type: 'node'
                      }));
                  }
                  
                  return undefined;
                })()}
                recipient="03740ea02585ed87b83b2f76317a4562b616bd7b8ec3f925be6596932b2003fc9e"
                enableBoosts={true}
                boostMetadata={{
                  title: selectedAlbum.title,
                  artist: selectedAlbum.artist,
                  album: selectedAlbum.title,
                  url: `https://itdv.podtards.com/album/${encodeURIComponent(selectedAlbum.feedId || selectedAlbum.title)}`,
                  appName: 'ITDV App',
                  senderName: senderName?.trim() || 'Super Fan',
                  message: boostMessage?.trim() || undefined,
                  itemGuid: selectedAlbum.tracks?.[0]?.guid,
                  podcastGuid: selectedAlbum.tracks?.[0]?.podcastGuid,
                  podcastFeedGuid: selectedAlbum.feedGuid,
                  feedUrl: selectedAlbum.feedUrl,
                  publisherGuid: selectedAlbum.publisherGuid,
                  publisherUrl: selectedAlbum.publisherUrl,
                  imageUrl: selectedAlbum.imageUrl
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Video Boost Modal */}
      {isLightningEnabled && showVideoBoostModal && (currentVideo || selectedVideoTrack) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative bg-gradient-to-b from-gray-900 to-black rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[85vh] sm:max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-300">
            {/* Header with Video Art */}
            <div className="relative h-48 sm:h-64 bg-gradient-to-b from-gray-800 to-black">
              {(() => {
                const video = currentVideo || selectedVideoTrack;
                return video?.image || (selectedVideoTrack?.album?.coverArt) ? (
                  <Image
                    src={video?.image || selectedVideoTrack?.album?.coverArt || ''}
                    alt={video?.title || selectedVideoTrack?.title || ''}
                    fill
                    className="object-cover opacity-50"
                    sizes="(max-width: 640px) 100vw, 400px"
                  />
                ) : null;
              })()}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
              <button
                onClick={() => {
                  setShowVideoBoostModal(false);
                  setSelectedVideoTrack(null);
                }}
                className="absolute top-4 right-4 z-20 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors backdrop-blur-sm"
              >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="absolute bottom-4 left-4 right-4 z-10">
                {(() => {
                  const video = currentVideo || selectedVideoTrack;
                  return (
                    <>
                      <h2 className="text-xl sm:text-2xl font-bold text-white mb-1">{video?.title || selectedVideoTrack?.title}</h2>
                      <p className="text-gray-300 text-sm">{(video && 'artist' in video ? video.artist : undefined) || (typeof video?.album === 'string' ? video.album : undefined) || selectedVideoTrack?.album?.artist}</p>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Boost Form */}
            <div className="p-6 overflow-y-auto max-h-[calc(85vh-16rem)] sm:max-h-[calc(90vh-16rem)]">
              {/* Boost Amount */}
              <div className="mb-4">
                <label className="block text-gray-400 text-sm font-medium mb-2">Amount (sats)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={videoBoostAmount}
                    onChange={(e) => setVideoBoostAmount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="flex-1 px-4 py-3 bg-gray-800/50 border border-gray-700 text-white rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                    placeholder="Enter amount"
                    min="1"
                  />
                  <span className="text-gray-400 font-medium">sats</span>
                </div>
              </div>

              {/* Sender Name */}
              <div className="mb-4">
                <label className="block text-gray-400 text-sm font-medium mb-2">Your Name (Optional)</label>
                <input
                  type="text"
                  value={senderName}
                  onChange={(e) => {
                    setSenderName(e.target.value);
                    if (e.target.value.trim()) {
                      safeLocalStorage.setItem('boost-sender-name', e.target.value.trim());
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
                  <span className="text-gray-500 text-xs">{videoBoostMessage.length}/250</span>
                </div>
                <textarea
                  value={videoBoostMessage}
                  onChange={(e) => setVideoBoostMessage(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 text-white rounded-xl text-base resize-none focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                  placeholder="Share your thoughts..."
                  maxLength={250}
                  rows={3}
                />
              </div>

              {/* Show Splits Button */}
              <div className="mt-4">
                <button
                  onClick={() => setShowVideoSplits(!showVideoSplits)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700 text-gray-300 rounded-xl text-sm font-medium transition-colors"
                >
                  <Info className="w-4 h-4" />
                  <span>{showVideoSplits ? 'Hide' : 'Show'} Payment Splits</span>
                </button>
                
                {showVideoSplits && (() => {
                  const recipients = (() => {
                    const video = currentVideo || selectedVideoTrack;
                    const album = selectedVideoTrack?.album;
                    
                    // Special case: Autumn Rust uses specific recipients for all boosts (audio and video)
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
                    
                    // Special case: The Satellite Spotlight uses specific recipients for all boosts (audio and video)
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
                    
                    // Prioritize paymentRecipients (site-specific, ~5 splits) over value.recipients (main feed)
                    // Try track's paymentRecipients first (site-specific)
                    if (selectedVideoTrack?.paymentRecipients && selectedVideoTrack.paymentRecipients.length > 0) {
                      return selectedVideoTrack.paymentRecipients;
                    }
                    // Try video's paymentRecipients if available (check if property exists)
                    if (video && 'paymentRecipients' in video && video.paymentRecipients && video.paymentRecipients.length > 0) {
                      return video.paymentRecipients;
                    }
                    // Fallback to value.recipients only if paymentRecipients not available
                    if (video?.value && video.value.type === 'lightning' && video.value.method === 'keysend') {
                      return video.value.recipients
                        .filter((r: any) => r.type === 'node')
                        .map((r: any) => ({
                          address: r.address,
                          split: r.split,
                          name: r.name,
                          fee: r.fee,
                          type: 'node'
                        }));
                    }
                    // Try track's value.recipients as last resort
                    if (selectedVideoTrack?.value && selectedVideoTrack.value.type === 'lightning' && selectedVideoTrack.value.method === 'keysend') {
                      return selectedVideoTrack.value.recipients
                        .filter((r: any) => r.type === 'node')
                        .map((r: any) => ({
                          address: r.address,
                          split: r.split,
                          name: r.name,
                          fee: r.fee,
                          type: 'node'
                        }));
                    }
                    return [];
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
                          const amount = Math.floor((videoBoostAmount * recipient.split) / totalSplit);
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
                amount={videoBoostAmount}
                description={`Boost for ${(() => {
                  const video = currentVideo || selectedVideoTrack;
                  return video?.title || selectedVideoTrack?.title || '';
                })()}${(() => {
                  const video = currentVideo || selectedVideoTrack;
                  const artist = (video && 'artist' in video ? video.artist : undefined) || (typeof video?.album === 'string' ? undefined : selectedVideoTrack?.album?.artist);
                  return artist ? ` by ${artist}` : '';
                })()}`}
                onSuccess={handleVideoBoostSuccess}
                onError={handleVideoBoostError}
                className="w-full !mt-6"
                recipients={(() => {
                  const video = currentVideo || selectedVideoTrack;
                  const album = selectedVideoTrack?.album;
                  
                  // Special case: Autumn Rust uses specific recipients for all boosts (audio and video)
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
                  
                  // Special case: The Satellite Spotlight uses specific recipients for all boosts (audio and video)
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
                  
                  // Prioritize paymentRecipients (site-specific, ~5 splits) over value.recipients (main feed)
                  // Try track's paymentRecipients first (site-specific)
                  if (selectedVideoTrack?.paymentRecipients && selectedVideoTrack.paymentRecipients.length > 0) {
                    return selectedVideoTrack.paymentRecipients;
                  }
                  // Try video's paymentRecipients if available (check if property exists)
                  if (video && 'paymentRecipients' in video && video.paymentRecipients && video.paymentRecipients.length > 0) {
                    return video.paymentRecipients;
                  }
                  // Fallback to value.recipients only if paymentRecipients not available
                  if (video?.value && video.value.type === 'lightning' && video.value.method === 'keysend') {
                    return video.value.recipients
                      .filter((r: any) => r.type === 'node')
                      .map((r: any) => ({
                        address: r.address,
                        split: r.split,
                        name: r.name,
                        fee: r.fee,
                        type: 'node'
                      }));
                  }
                  // Try track's value.recipients as last resort
                  if (selectedVideoTrack?.value && selectedVideoTrack.value.type === 'lightning' && selectedVideoTrack.value.method === 'keysend') {
                    return selectedVideoTrack.value.recipients
                      .filter((r: any) => r.type === 'node')
                      .map((r: any) => ({
                        address: r.address,
                        split: r.split,
                        name: r.name,
                        fee: r.fee,
                        type: 'node'
                      }));
                  }
                  return undefined;
                })()}
                recipient="03740ea02585ed87b83b2f76317a4562b616bd7b8ec3f925be6596932b2003fc9e"
                enableBoosts={true}
                boostMetadata={{
                  title: (() => {
                    const video = currentVideo || selectedVideoTrack;
                    return video?.title || selectedVideoTrack?.title || '';
                  })(),
                  artist: (() => {
                    const video = currentVideo || selectedVideoTrack;
                    return (video && 'artist' in video ? video.artist : undefined) || (typeof video?.album === 'string' ? undefined : selectedVideoTrack?.album?.artist) || '';
                  })(),
                  album: (() => {
                    const video = currentVideo || selectedVideoTrack;
                    const album = video?.album;
                    return typeof album === 'string' ? album : (selectedVideoTrack?.album?.title || '');
                  })(),
                  episode: (() => {
                    const video = currentVideo || selectedVideoTrack;
                    return video?.title || selectedVideoTrack?.title || '';
                  })(),
                  url: (() => {
                    const video = currentVideo || selectedVideoTrack;
                    const album = video?.album;
                    const albumTitle = typeof album === 'string' ? album : (selectedVideoTrack?.album?.title || '');
                    const trackTitle = video?.title || selectedVideoTrack?.title;
                    return albumTitle ? `https://itdv.podtards.com/album/${encodeURIComponent(albumTitle)}#${encodeURIComponent(trackTitle || '')}` : 'https://itdv.podtards.com';
                  })(),
                  appName: 'ITDV App',
                  timestamp: Math.floor(Date.now() / 1000),
                  senderName: senderName?.trim() || undefined,
                  message: videoBoostMessage?.trim() || undefined,
                  itemGuid: (() => {
                    const video = currentVideo || selectedVideoTrack;
                    return video?.guid || selectedVideoTrack?.guid;
                  })(),
                  podcastGuid: (() => {
                    const video = currentVideo || selectedVideoTrack;
                    return video?.podcastGuid || selectedVideoTrack?.podcastGuid;
                  })(),
                  podcastFeedGuid: (() => {
                    const video = currentVideo || selectedVideoTrack;
                    return video?.feedGuid || selectedVideoTrack?.album?.feedGuid;
                  })(),
                  feedUrl: (() => {
                    const video = currentVideo || selectedVideoTrack;
                    return video?.feedUrl || selectedVideoTrack?.album?.feedUrl;
                  })(),
                  publisherGuid: (() => {
                    const video = currentVideo || selectedVideoTrack;
                    return video?.publisherGuid || selectedVideoTrack?.album?.publisherGuid;
                  })(),
                  publisherUrl: (() => {
                    const video = currentVideo || selectedVideoTrack;
                    return video?.publisherUrl || selectedVideoTrack?.album?.publisherUrl;
                  })(),
                  imageUrl: (() => {
                    const video = currentVideo || selectedVideoTrack;
                    return video?.imageUrl || selectedVideoTrack?.imageUrl || selectedVideoTrack?.album?.coverArt;
                  })()
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}