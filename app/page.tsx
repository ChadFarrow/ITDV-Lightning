'use client';

import { useState, useEffect, useRef, Suspense, lazy, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import LoadingSpinner from '@/components/LoadingSpinner';
import { getVersionString } from '@/lib/version';
import { useAudio } from '@/contexts/AudioContext';
import { useLightning } from '@/contexts/LightningContext';
import { toast } from '@/components/Toast';
import { preloadCriticalColors } from '@/lib/performance-utils';
import dynamic from 'next/dynamic';
import { Zap } from 'lucide-react';
import confetti from 'canvas-confetti';
import { isLightningEnabled } from '@/lib/feature-flags';

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
  trackNumber: number;
  image?: string;
  value?: any; // Track-level podcast:value data
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
  const { isLightningEnabled } = useLightning();
  const [isLoading, setIsLoading] = useState(true);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [publishers, setPublishers] = useState<any[]>([]);
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
  
  // Global audio context
  const { playAlbumAndOpenNowPlaying: globalPlayAlbum, toggleShuffle } = useAudio();
  const hasLoadedRef = useRef(false);
  
  // Handle boost button click from album card
  const handleBoostClick = (album: Album) => {
    setSelectedAlbum(album);
    setShowBoostModal(true);
  };
  
  // Handle boost success
  const handleBoostSuccess = (response: any) => {
    setShowBoostModal(false);
    setBoostMessage(''); // Clear the message input after successful boost
    
    // Trigger confetti animation
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

    fire(0.25, { spread: 26, startVelocity: 55 });
    fire(0.2, { spread: 60 });
    fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    fire(0.1, { spread: 120, startVelocity: 45 });
    
    toast.success('⚡ Boost sent successfully!');
  };
  
  const handleBoostError = (error: string) => {
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

  useEffect(() => {
    setIsClient(true);
    
    // Load saved sender name
    const savedSenderName = localStorage.getItem('boost-sender-name');
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
    
    // Check for cached data first to speed up initial load
    const cachedAlbums = localStorage.getItem('cachedAlbums');
    const cacheTime = localStorage.getItem('albumsCacheTimestamp');
    
    if (cachedAlbums && cacheTime) {
      const cacheAge = Date.now() - parseInt(cacheTime);
      // Use cache if less than 10 minutes old
      if (cacheAge < 10 * 60 * 1000) {
        const albums = JSON.parse(cachedAlbums);
        setAlbums(albums);
        setIsLoading(false);
        
        // Still fetch fresh data in background
        setTimeout(() => loadCriticalAlbums(), 1000);
        return;
      }
    }
    
    // Progressive loading: Load critical data first, then enhance
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
      setIsLoading(true);
      setError(null);
      setLoadingProgress(0);
      
      // Load all albums directly
      const allAlbums = await loadAlbumsData();
      console.log(`📦 Loaded ${allAlbums.length} albums`);
      setAlbums(allAlbums);
      
      // Preload colors for first albums for instant Now Playing screen
      const firstAlbumTitles = allAlbums.slice(0, 10).map((album: any) => album.title);
      preloadCriticalColors(firstAlbumTitles).catch(console.warn);
      
      // Load static publisher data
      try {
        const publisherResponse = await fetch('/publishers.json');
        if (publisherResponse.ok) {
          const staticPublishers = await publisherResponse.json();
          setPublishers(staticPublishers);
          console.log('📦 Loaded static publisher data:', staticPublishers.map((p: any) => p.name));
        } else {
          console.warn('Failed to load static publisher data');
        }
      } catch (error) {
        console.error('Error loading static publisher data:', error);
      }
      
      setLoadingProgress(100);
      setIsLoading(false);
      
    } catch (error) {
      setError('Failed to load albums');
      setIsLoading(false);
    }
  }, []);

  const loadAlbumsData = async () => {
    try {
      // Check for cached albums first - extend cache time for better performance
      if (typeof window !== 'undefined') {
        const cached = localStorage.getItem('cachedAlbums');
        const cacheTime = localStorage.getItem('albumsCacheTimestamp');
        
        if (cached && cacheTime && (Date.now() - parseInt(cacheTime)) < 10 * 60 * 1000) {
          console.log('📦 Using cached albums');
          return JSON.parse(cached);
        }
      }

      // Use static cached data for fast loading
      console.log('🔄 Loading albums from static cache...');
      let response = await fetch('/api/albums-static-cached');
      let data;
      let useStaticCache = false;
      
      if (response.ok) {
        data = await response.json();
        // Check if the data includes podcast:value and GUID information
        const hasValueData = data.albums?.some((album: any) => 
          album.value || album.tracks?.some((track: any) => track.value)
        );
        
        // Check if the data includes GUID information needed for Nostr tagging
        const hasGuidData = data.albums?.some((album: any) => 
          album.feedGuid || album.tracks?.some((track: any) => track.guid)
        );
        
        if (hasValueData && hasGuidData) {
          console.log('⚡ Using static cached album data (fast loading, includes podcast:value and GUID data)');
          useStaticCache = true;
        } else {
          if (!hasValueData) {
            console.log('📦 Static cached data missing podcast:value info, falling back to dynamic data...');
          }
          if (!hasGuidData) {
            console.log('🏷️ Static cached data missing GUID info needed for Nostr tagging, falling back to dynamic data...');
          }
        }
      }
      
      if (!useStaticCache) {
        // Fallback to dynamic data if static cache fails or lacks podcast:value data
        console.log('📡 Loading dynamic data to get podcast:value for Lightning...');
        response = await fetch('/api/albums-no-db');
        if (response.ok) {
          data = await response.json();
          console.log('⚡ Using dynamic album data (includes podcast:value for Lightning)');
        }
      }
      
      if (!response.ok || !data) {
        // Fallback to static data if database-free fails
        console.log('🔄 Database-free failed, falling back to static data (Lightning payments will use fallback address)...');
        response = await fetch('/api/albums-static');
        
        if (!response.ok) {
          throw new Error(`Failed to fetch albums: ${response.status} ${response.statusText}`);
        }
        
        data = await response.json();
        console.log('📦 Using static album data (no podcast:value data available)');
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
          localStorage.setItem('cachedAlbums', JSON.stringify(uniqueAlbums));
          localStorage.setItem('albumsCacheTimestamp', Date.now().toString());
          console.log(`📦 Cached ${uniqueAlbums.length} albums`);
        } catch (error) {
          console.warn('⚠️ Failed to cache albums:', error);
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
    
    // Find the first playable track
    const firstTrack = album.tracks.find(track => track.url);
    
    if (!firstTrack || !firstTrack.url) {
      console.warn('Cannot play album: missing track');
      setError('No playable tracks found in this album');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      console.log('🎵 Attempting to play:', album.title, 'Track URL:', firstTrack.url);
      
      // Use global audio context to play album
      const audioTracks = album.tracks.map(track => ({
        ...track,
        artist: album.artist,
        album: album.title,
        image: track.image || album.coverArt
      }));
      
      globalPlayAlbum(audioTracks, 0, album.title);
      console.log('✅ Successfully started playback');
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

  // Helper functions for filtering and sorting
  const getFilteredAlbums = () => {
    // Filter out LNURL Testing Podcast from main page display (accessible via sidebar)
    const albumsToUse = albums.filter(album => album.title !== 'LNURL Testing Podcast');
    
          // Universal sorting function that implements hierarchical order: Pinned → Albums → EPs → Singles
      const sortWithHierarchy = (albums: Album[]) => {
        return albums.sort((a, b) => {
          // Pin specific albums to the top in order
          const pinnedOrder = ["Bloodshot Lies - The Album", "Think EP", "Music From The Doerfel-Verse"];
          const aIndex = pinnedOrder.indexOf(a.title);
          const bIndex = pinnedOrder.indexOf(b.title);
          
          // If both are pinned, sort by pinnedOrder
          if (aIndex !== -1 && bIndex !== -1) {
            return aIndex - bIndex;
          }
          // If only one is pinned, it goes first
          if (aIndex !== -1) return -1;
          if (bIndex !== -1) return 1;

          // Hierarchical sorting: Albums (7+ tracks) → EPs (2-6 tracks) → Singles (1 track)
          const aIsAlbum = a.tracks.length > 6;
          const bIsAlbum = b.tracks.length > 6;
          const aIsEP = a.tracks.length > 1 && a.tracks.length <= 6;
          const bIsEP = b.tracks.length > 1 && b.tracks.length <= 6;
          const aIsSingle = a.tracks.length === 1;
          const bIsSingle = b.tracks.length === 1;
          
          // Albums come first
          if (aIsAlbum && !bIsAlbum) return -1;
          if (!aIsAlbum && bIsAlbum) return 1;
          
          // EPs come second (if both are not albums)
          if (aIsEP && !bIsEP) return -1;
          if (!aIsEP && bIsEP) return 1;
          
          // Singles come last (if both are not albums or EPs)
          if (aIsSingle && !bIsSingle) return -1;
          if (!aIsSingle && bIsSingle) return 1;
          
          // If same type, sort by title
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
                      src="/HPM-lightning-logo.jpg" 
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
                      src="/HPM-lightning-logo.jpg" 
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
                    className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="hidden sm:inline">About this site</span>
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
        <div className={`fixed top-0 left-0 h-full w-80 bg-gray-900/95 backdrop-blur-sm transform transition-transform duration-300 z-30 border-r border-gray-700 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="p-4 pt-16 flex flex-col h-full">
            <h2 className="text-lg font-bold mb-4">Menu</h2>
            
            <div className="mb-4 space-y-1">
              <Link 
                href="/lightning-guide" 
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-800/50 transition-colors"
                onClick={() => setIsSidebarOpen(false)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-sm">Lightning Payments</span>
              </Link>
              
              <Link 
                href="/music-guide" 
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-800/50 transition-colors"
                onClick={() => setIsSidebarOpen(false)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                <span className="text-sm">Music Streaming</span>
              </Link>
              
              <Link 
                href="/rss-guide" 
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-800/50 transition-colors"
                onClick={() => setIsSidebarOpen(false)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                </svg>
                <span className="text-sm">RSS & Podcasting 2.0</span>
              </Link>
              
              <Link 
                href="/about" 
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-800/50 transition-colors"
                onClick={() => setIsSidebarOpen(false)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm">About & Support</span>
              </Link>
              
              <Link  
                href="/admin/feeds" 
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-800/50 transition-colors"
                onClick={() => setIsSidebarOpen(false)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm">Admin Panel</span>
              </Link>
              
              <Link
                href="/album/lnurl-testing-podcast"
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-800/50 transition-colors"
                onClick={() => setIsSidebarOpen(false)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-sm">LNURL Testing Podcast</span>
              </Link>

              {isLightningEnabled && (
                <Link
                  href="/boosts"
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-800/50 transition-colors"
                  onClick={() => setIsSidebarOpen(false)}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span className="text-sm">⚡ Boosts</span>
                </Link>
              )}
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
            className="fixed inset-0 bg-black/50 z-20" 
            onClick={() => setIsSidebarOpen(false)}
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
          ) : filteredAlbums.length > 0 ? (
            <div className="max-w-7xl mx-auto">
              {/* Controls Bar */}
              <ControlsBar
                activeFilter={activeFilter}
                onFilterChange={setActiveFilter}
                viewType={viewType}
                onViewChange={setViewType}
                showShuffle={true}
                onShuffle={handleShuffle}
                resultCount={filteredAlbums.length}
                resultLabel={activeFilter === 'all' ? 'Releases' : 
                  activeFilter === 'albums' ? 'Albums' :
                  activeFilter === 'eps' ? 'EPs' : 
                  activeFilter === 'singles' ? 'Singles' : 
                  activeFilter === 'publishers' ? 'Artists' : 'Releases'}
                className="mb-8"
              />


              {/* Albums Display */}
              {activeFilter === 'publishers' ? (
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
                            {albumsWithMultipleTracks.map((album, index) => (
                              <AlbumCard
                                key={`album-${index}`}
                                album={album}
                                onPlay={playAlbum}
                                onBoostClick={handleBoostClick}
                              />
                            ))}
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
            </div>
          ) : (
            <div className="text-center py-12">
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
              
              {/* Boost Button */}
              <BitcoinConnectPayment
                amount={boostAmount}
                description={`Boost for ${selectedAlbum.title} by ${selectedAlbum.artist}`}
                onSuccess={handleBoostSuccess}
                onError={handleBoostError}
                className="w-full !mt-6"
                recipients={(() => {
                  // Get payment recipients from selected album
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
                  // Check first track for value data
                  const firstTrack = selectedAlbum.tracks?.[0];
                  if (firstTrack?.value && firstTrack.value.type === 'lightning' && firstTrack.value.method === 'keysend') {
                    return firstTrack.value.recipients
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
                  url: `https://zaps.podtards.com/album/${encodeURIComponent(selectedAlbum.feedId || selectedAlbum.title)}`,
                  appName: 'ITDV Lightning',
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
    </div>
  );
}