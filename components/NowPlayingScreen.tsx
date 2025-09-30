'use client';

import React, { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAudio } from '@/contexts/AudioContext';
import { useLightning } from '@/contexts/LightningContext';
import { useSwipeGestures } from '@/hooks/useSwipeGestures';
import { extractColorsFromImage, createAlbumBackground, createTextOverlay, createButtonStyles, ExtractedColors } from '@/lib/color-utils';
import { performanceMonitor, getMobileOptimizations, getCachedColors, debounce } from '@/lib/performance-utils';
import { BitcoinConnectPayment } from '@/components/BitcoinConnect';
import { useBitcoinConnect } from '@/contexts/BitcoinConnectContext';
import confetti from 'canvas-confetti';

interface NowPlayingScreenProps {
  isOpen: boolean;
  onClose: () => void;
}

// Global color cache to persist across component remounts
const globalColorCache = new Map<string, ExtractedColors>();
let colorDataPromise: Promise<any> | null = null;

const NowPlayingScreen: React.FC<NowPlayingScreenProps> = ({ isOpen, onClose }) => {
  const router = useRouter();
  const { isLightningEnabled } = useLightning();
  const [extractedColors, setExtractedColors] = useState<ExtractedColors | null>(null);
  const [isLoadingColors, setIsLoadingColors] = useState(false);
  const [showBoostModal, setShowBoostModal] = useState(false);
  const [boostAmount, setBoostAmount] = useState(50);
  const [senderName, setSenderName] = useState('');
  const [boostMessage, setBoostMessage] = useState('');
  const [albumData, setAlbumData] = useState<any>(null);
  const colorCache = useRef<Map<string, ExtractedColors>>(globalColorCache);
  
  const { checkConnection } = useBitcoinConnect();

  const {
    currentTrack,
    currentAlbum,
    isPlaying,
    currentTime,
    duration,
    isShuffling,
    isRepeating,
    pause,
    resume,
    nextTrack,
    previousTrack,
    seekTo,
    toggleShuffle,
    toggleRepeat,
    isAutoBoostEnabled,
    toggleAutoBoost,
  } = useAudio();

  // Add swipe gestures for mobile
  const swipeRef = useSwipeGestures({
    onSwipeLeft: nextTrack,
    onSwipeRight: previousTrack,
    onSwipeDown: onClose,
    threshold: 50,
    velocityThreshold: 0.3
  });

  // Performance-optimized color loading with mobile considerations
  const loadColors = useRef(debounce(async (albumTitle: string, track: any) => {
    const timer = performanceMonitor.startTimer('colorLoad');
    // Create cache key that includes track info for track-specific colors
    const cacheKey = track.image 
      ? `${albumTitle.toLowerCase()}-${track.title?.toLowerCase() || 'unknown'}` 
      : albumTitle.toLowerCase();
    
    try {
      // Check memory cache first
      if (colorCache.current.has(cacheKey)) {
        console.log('🎨 Using memory cache for:', albumTitle);
        setExtractedColors(colorCache.current.get(cacheKey)!);
        performanceMonitor.recordCacheHit();
        return;
      }

      // Note: Skip preloaded cache check for now to ensure we check for track-specific colors
      // We'll check preloaded colors later as a fallback

      console.log('🎨 Loading colors from network for:', albumTitle);
      setIsLoadingColors(true);

      // Create or reuse the shared promise for color data loading
      if (!colorDataPromise) {
        colorDataPromise = fetch('/data/albums-with-colors.json')
          .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .catch(error => {
            console.error('Failed to load color data:', error);
            colorDataPromise = null;
            throw error;
          });
      }

      const data = await colorDataPromise;
      const album = data.albums?.find((a: any) => 
        a.title?.toLowerCase() === albumTitle.toLowerCase()
      );
      
      let colors = null;
      
      // Check for track-specific colors first
      if (album?.tracks && track.image) {
        const trackMatch = album.tracks.find((t: any) => 
          t.title?.toLowerCase() === track.title?.toLowerCase() && 
          t.image === track.image && 
          t.colors
        );
        
        if (trackMatch?.colors) {
          console.log('🎵 Using track-specific colors for:', track.title);
          colors = trackMatch.colors;
        }
      }
      
      // Fallback to album colors
      if (!colors && album?.colors) {
        console.log('🎨 Using album colors for:', albumTitle);
        colors = album.colors;
      }
      
      // Final fallback: check preloaded cache
      if (!colors) {
        const preloadedColors = getCachedColors(albumTitle);
        if (preloadedColors) {
          console.log('🎨 Using preloaded cache as final fallback for:', albumTitle);
          colors = preloadedColors;
        }
      }

      if (colors) {
        // Cache with size limit for mobile performance
        const mobileOpts = getMobileOptimizations();
        if (colorCache.current.size >= mobileOpts.maxCacheSize) {
          const firstKey = colorCache.current.keys().next().value;
          if (firstKey) {
            colorCache.current.delete(firstKey);
          }
        }
        
        colorCache.current.set(cacheKey, colors);
        setExtractedColors(colors);
        performanceMonitor.recordCacheMiss();
      } else {
        console.log('🎨 No colors found for:', albumTitle);
        setExtractedColors(null);
      }
      
    } catch (error) {
      console.warn('Failed to load colors:', error);
      setExtractedColors(null);
    } finally {
      setIsLoadingColors(false);
      timer();
    }
  }, getMobileOptimizations().colorLoadDelay)).current;

  useEffect(() => {
    if (!isOpen || !currentTrack) {
      setExtractedColors(null);
      return;
    }

    const albumTitle = currentAlbum;
    if (!albumTitle) {
      console.log('🎨 No album title provided');
      setExtractedColors(null);
      return;
    }

    loadColors(albumTitle, currentTrack);
  }, [isOpen, currentAlbum, currentTrack, loadColors]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  // Load album data when album changes
  useEffect(() => {
    if (currentAlbum && isOpen) {
      fetchAlbumData(currentAlbum);
    } else {
      setAlbumData(null);
    }
  }, [currentAlbum, isOpen]);

  // Load saved sender name on component mount
  useEffect(() => {
    if (isOpen) {
      const savedSenderName = localStorage.getItem('boost-sender-name');
      if (savedSenderName) {
        setSenderName(savedSenderName);
      }
    }
  }, [isOpen]);

  // Save sender name to localStorage when it changes
  useEffect(() => {
    if (senderName.trim()) {
      localStorage.setItem('boost-sender-name', senderName.trim());
    }
  }, [senderName]);

  if (!isOpen || !currentTrack) return null;

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    seekTo(newTime);
  };

  const handleViewAlbum = () => {
    if (currentAlbum) {
      // Convert album title to URL-friendly slug (consistent with AlbumCard)
      const albumSlug = currentAlbum.toLowerCase()
        .replace(/[^\w\s-]/g, '') // Remove punctuation except spaces and hyphens
        .replace(/\s+/g, '-') // Replace spaces with dashes
        .replace(/-+/g, '-') // Replace multiple consecutive dashes with single dash
        .replace(/^-+|-+$/g, '') // Remove leading/trailing dashes
        .trim();
      
      router.push(`/album/${albumSlug}`);
      onClose(); // Close the now playing screen
    }
  };

  const handleBoostSuccess = (response: any) => {
    setShowBoostModal(false);
    setBoostMessage(''); // Clear the message input after successful boost
    
    // Trigger multiple confetti bursts for dramatic effect
    const count = 200;
    const defaults = {
      origin: { y: 0.7 },
      colors: ['#FFD700', '#FFA500', '#FF8C00', '#FFE55C', '#FFFF00']
    };

    function fire(particleRatio: number, opts: any) {
      confetti({
        ...defaults,
        ...opts,
        particleCount: Math.floor(count * particleRatio),
      });
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
    console.error('Boost failed:', error);
  };

  // Fetch album data to get podcast:value splits (fallback only)
  const fetchAlbumData = async (albumTitle: string) => {
    try {
      console.log('🔍 Fetching album data for fallback value data:', albumTitle);
      
      // Convert album title to URL-friendly format (same as album page)
      const albumId = albumTitle.toLowerCase()
        .replace(/[^\w\s-]/g, '')       // Remove punctuation except spaces and hyphens
        .replace(/\s+/g, '-')           // Replace spaces with dashes
        .replace(/-+/g, '-')            // Replace multiple consecutive dashes with single dash
        .replace(/^-+|-+$/g, '');       // Remove leading/trailing dashes
      
      const response = await fetch(`/api/album/${encodeURIComponent(albumId)}`);
      const data = await response.json();
      
      if (data.success && data.album) {
        console.log('✅ Found fallback album data:', data.album.title, {
          hasValue: !!data.album.value,
          recipients: data.album.value?.recipients?.length || 0
        });
        setAlbumData(data.album);
      } else {
        console.log('❌ No fallback album found for:', albumTitle);
        setAlbumData(null);
      }
    } catch (error) {
      console.error('Failed to fetch fallback album data:', error);
      setAlbumData(null);
    }
  };

  // Get Lightning payment recipients from RSS value data
  const getPaymentRecipients = (): Array<{ address: string; split: number; name?: string; fee?: boolean }> | null => {
    // Debug: Log current track structure
    console.log('🔍 Current track data:', currentTrack, {
      hasCurrentTrack: !!currentTrack,
      hasValue: !!currentTrack?.value,
      trackTitle: currentTrack?.title
    });
    
    // First, check if current track has value data
    if (currentTrack?.value && currentTrack.value.type === 'lightning' && currentTrack.value.method === 'keysend') {
      console.log('🔍 Checking current track for podcast:value data:', currentTrack.title, { 
        hasValue: !!currentTrack.value,
        valueType: currentTrack.value?.type,
        valueMethod: currentTrack.value?.method,
        recipients: currentTrack.value?.recipients?.length || 0
      });
      
      const recipients = currentTrack.value.recipients
        .filter((r: any) => r.type === 'node') // Only include node recipients
        .map((r: any) => ({
          address: r.address,
          split: r.split,
          name: r.name,
          fee: r.fee,
          type: 'node' // Include the type field for payment routing
        }));
      
      console.log('✅ Found podcast:value recipients from current track:', recipients);
      return recipients;
    }
    
    // Fall back to album-level value data if available
    if (albumData?.value && albumData.value.type === 'lightning' && albumData.value.method === 'keysend') {
      console.log('🔍 Checking album for podcast:value data:', albumData.title, { 
        hasValue: !!albumData.value,
        valueType: albumData.value?.type,
        valueMethod: albumData.value?.method,
        recipients: albumData.value?.recipients?.length || 0
      });
      
      const recipients = albumData.value.recipients
        .filter((r: any) => r.type === 'node') // Only include node recipients
        .map((r: any) => ({
          address: r.address,
          split: r.split,
          name: r.name,
          fee: r.fee,
          type: 'node' // Include the type field for payment routing
        }));
      
      console.log('✅ Found podcast:value recipients from album:', recipients);
      return recipients;
    }
    
    console.log('❌ No podcast:value data found, using fallback');
    return null; // Will use fallback single recipient
  };

  // Get fallback recipient for payments (same as AlbumCard)
  const getFallbackRecipient = (): { address: string; amount: number } => {
    return {
      address: '03740ea02585ed87b83b2f76317a4562b616bd7b8ec3f925be6596932b2003fc9e',
      amount: 50
    };
  };

  // Generate mobile-optimized background styles
  const mobileOpts = getMobileOptimizations();
  const backgroundStyle = extractedColors 
    ? { 
        background: createAlbumBackground(extractedColors),
        willChange: mobileOpts.willChange,
        contain: mobileOpts.cssContainment
      }
    : { 
        background: 'linear-gradient(135deg, #1e3a8a 0%, #3730a3 25%, #581c87 75%, #000000 100%)',
        willChange: mobileOpts.willChange,
        contain: mobileOpts.cssContainment
      };

  const overlayStyle = extractedColors 
    ? { background: createTextOverlay(extractedColors) }
    : { background: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.3) 100%)' };

  // Generate dynamic button styles that match the background
  const buttonStyles = extractedColors 
    ? createButtonStyles(extractedColors)
    : {
        background: 'rgba(255, 255, 255, 0.1)',
        border: 'rgba(255, 255, 255, 0.2)',
        hoverBackground: 'rgba(255, 255, 255, 0.2)',
        hoverBorder: 'rgba(255, 255, 255, 0.3)',
      };

  return (
    <div 
      ref={swipeRef}
      className="fixed inset-0 z-[100] flex flex-col transition-colors duration-500 ease-in-out"
      style={backgroundStyle}
    >
      {/* Color overlay for better text readability */}
      <div className="absolute inset-0 pointer-events-none" style={overlayStyle} />
      {/* Header */}
      <div className="flex items-center justify-between p-4 sm:p-6" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <button
          onClick={onClose}
          className="p-2 text-white/60 hover:text-white transition-colors"
          title="Close"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        <div className="text-center">
          <p className="text-xs text-white/60 uppercase tracking-wider">Playing from</p>
          <p className="text-sm text-white font-medium">{currentAlbum || 'Queue'}</p>
        </div>

        <button
          onClick={handleViewAlbum}
          className="p-2 text-white/60 hover:text-white transition-colors"
          title="View album"
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
          </svg>
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-8 pb-4 sm:pb-8" style={{ paddingBottom: `max(2rem, calc(2rem + env(safe-area-inset-bottom)))` }}>
        {/* Album Art - Responsive to window size */}
        <div className="w-full max-w-xs sm:max-w-sm md:max-w-md aspect-square relative mb-6 sm:mb-8">
          {currentTrack.image ? (
            <Image
              src={currentTrack.image}
              alt={currentTrack.title}
              fill
              className="object-cover rounded-lg shadow-2xl"
              sizes="(max-width: 768px) 90vw, 400px"
              priority
            />
          ) : (
            <div className="w-full h-full bg-gray-800 rounded-lg flex items-center justify-center">
              <svg className="w-24 h-24 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
              </svg>
            </div>
          )}
        </div>

        {/* Track Info */}
        <div className="w-full max-w-md text-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2 truncate">
            {currentTrack.title}
          </h1>
          <p className="text-lg sm:text-xl text-white/60 truncate">
            {currentTrack.artist || 'Unknown Artist'}
          </p>
        </div>

        {/* Progress Bar */}
        <div className="w-full max-w-md mb-8">
          <input
            type="range"
            min="0"
            max={duration || 0}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider-large"
            style={{
              background: `linear-gradient(to right, #ffffff 0%, #ffffff ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.2) ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.2) 100%)`
            }}
          />
          <div className="flex justify-between mt-2">
            <span className="text-xs text-white/60">{formatTime(currentTime)}</span>
            <span className="text-xs text-white/60">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Main Controls */}
        <div className="flex flex-col items-center gap-4 mb-8">
          {/* Media Controls Row */}
          <div className="flex items-center justify-center gap-4 sm:gap-6">
            <button
              onClick={toggleShuffle}
              className={`p-2 transition-colors ${
                isShuffling ? 'text-white' : 'text-white/40 hover:text-white/60'
              }`}
              title="Toggle shuffle"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
              </svg>
            </button>

            <button
              onClick={previousTrack}
              className="p-3 text-white hover:scale-110 transition-transform"
              title="Previous track"
            >
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
              </svg>
            </button>

            <button
              onClick={isPlaying ? pause : resume}
              className="p-4 bg-white text-black rounded-full hover:scale-110 transition-transform"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              ) : (
                <svg className="w-8 h-8 ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>

            <button
              onClick={nextTrack}
              className="p-3 text-white hover:scale-110 transition-transform"
              title="Next track"
            >
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
              </svg>
            </button>

            <button
              onClick={toggleRepeat}
              className={`p-2 transition-colors ${
                isRepeating ? 'text-white' : 'text-white/40 hover:text-white/60'
              }`}
              title="Toggle repeat"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
              </svg>
            </button>
          </div>

          {/* Boost Button Row - only show when Lightning is enabled */}
          {isLightningEnabled && (
            <div className="flex items-center justify-center w-full relative">
              <button
                onClick={() => {
                  checkConnection();
                  setShowBoostModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 backdrop-blur-sm rounded-full text-white hover:text-yellow-300 transform hover:scale-105 transition-all duration-150 text-sm"
                style={{
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
                background: buttonStyles.background,
                border: `1px solid ${buttonStyles.border}`
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = buttonStyles.hoverBackground;
                e.currentTarget.style.border = `1px solid ${buttonStyles.hoverBorder}`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = buttonStyles.background;
                e.currentTarget.style.border = `1px solid ${buttonStyles.border}`;
              }}
              title="Boost this song"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M7 2v11h3v9l7-12h-4l4-8z"/>
              </svg>
              <span className="font-medium">Boost Song</span>
              </button>
              
              {/* Auto boost button positioned to the right */}
              <button
                onClick={toggleAutoBoost}
                className={`absolute right-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs transition-colors ${
                  isAutoBoostEnabled 
                    ? 'bg-yellow-400/20 text-yellow-400 border border-yellow-400/30' 
                    : 'bg-white/10 text-white/60 border border-white/20 hover:text-white hover:border-white/30'
                }`}
                title={`Auto boost ${isAutoBoostEnabled ? 'enabled' : 'disabled'} - 25 sats`}
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M7 2v11h3v9l7-12h-4l4-8z"/>
                </svg>
                <span className="font-medium">Auto</span>
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Boost Modal - only show when Lightning is enabled */}
      {isLightningEnabled && showBoostModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative bg-gray-900 rounded-2xl shadow-2xl max-w-sm w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M7 2v11h3v9l7-12h-4l4-8z"/>
                  </svg>
                  Boost Song
                </h3>
                <button
                  onClick={() => setShowBoostModal(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                  title="Close"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="mb-4">
                <p className="text-gray-300 text-sm mb-2">
                  Send sats to support <strong>{currentTrack?.title || 'this song'}</strong> 
                  {currentTrack?.artist && ` by ${currentTrack.artist}`}
                </p>
              </div>
              
              {/* Amount Selection */}
              <div className="mb-6">
                <p className="text-gray-300 text-xs mb-3 uppercase tracking-wide">Boost Amount</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={boostAmount}
                    onChange={(e) => setBoostAmount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg text-sm"
                    placeholder="Enter amount in sats"
                    min="1"
                  />
                  <span className="text-gray-400 text-sm">sats</span>
                </div>
              </div>
              
              {/* Sender Name */}
              <div className="mb-6">
                <p className="text-gray-300 text-xs mb-3 uppercase tracking-wide">Your Name (Optional)</p>
                <input
                  type="text"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg text-sm"
                  placeholder="Enter your name to be credited in the boost"
                  maxLength={50}
                />
                <p className="text-gray-500 text-xs mt-1">This will be included with your boost payment</p>
              </div>

              {/* Boostagram Message */}
              <div>
                <label className="block text-white text-sm font-medium mb-2">
                  Message (Optional)
                </label>
                <textarea
                  value={boostMessage}
                  onChange={(e) => setBoostMessage(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg text-sm resize-none"
                  placeholder="Enter your boostagram message (up to 250 characters)"
                  maxLength={250}
                  rows={3}
                />
                <div className="flex justify-between items-center mt-1">
                  <p className="text-gray-500 text-xs">Custom message for your boost</p>
                  <p className="text-gray-400 text-xs">{boostMessage.length}/250</p>
                </div>
              </div>
              
              <BitcoinConnectPayment
                amount={boostAmount}
                description={`Boost for ${currentTrack?.title || 'Unknown Song'} by ${currentTrack?.artist || currentAlbum || 'Unknown Artist'}`}
                onSuccess={handleBoostSuccess}
                onError={handleBoostError}
                className="w-full"
                recipients={getPaymentRecipients() || undefined}
                recipient={getFallbackRecipient().address}
                enableBoosts={true}
                boostMetadata={{
                  title: currentTrack?.title || 'Unknown Song',
                  artist: currentTrack?.artist || currentAlbum || 'Unknown Artist',
                  album: currentAlbum || 'Unknown Album',
                  episode: currentTrack?.title,
                  url: currentAlbum ? `https://zaps.podtards.com/album/${encodeURIComponent(currentAlbum)}#${encodeURIComponent(currentTrack?.title || '')}` : 'https://zaps.podtards.com',
                  appName: 'HPM Lightning',
                  timestamp: Math.floor(currentTime),
                  senderName: senderName?.trim() || undefined,
                  message: boostMessage?.trim() || undefined,
                  itemGuid: currentTrack?.guid,
                  podcastGuid: currentTrack?.podcastGuid,
                  podcastFeedGuid: currentTrack?.feedGuid || albumData?.feedGuid,
                  feedUrl: currentTrack?.feedUrl || albumData?.feedUrl,
                  publisherGuid: currentTrack?.publisherGuid || albumData?.publisherGuid,
                  publisherUrl: currentTrack?.publisherUrl || albumData?.publisherUrl,
                  imageUrl: currentTrack?.imageUrl || albumData?.imageUrl
                }}
              />
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default NowPlayingScreen;