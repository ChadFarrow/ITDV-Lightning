'use client';

import React, { useRef, useEffect, useState } from 'react';
import Hls from 'hls.js';
import { useDeviceDetection } from '@/lib/hooks/useDeviceDetection';
import { getOptimalHLSConfig, getVideoOptimizationConfig, createConnectionChangeListener, type ConnectionQuality } from '@/lib/video-utils';

interface VideoPlayerProps {
  videoUrl: string;
  startTime?: number; // Start time in seconds for chapter/segment playback
  endTime?: number; // End time in seconds for chapter/segment playback
  seekTime?: number; // External seek time (chapter-relative if startTime/endTime are set)
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  onDurationChange?: (duration: number) => void; // Callback when video duration is available
  onPlay?: () => void; // Callback when video starts playing
  onPause?: () => void; // Callback when video is paused
  className?: string;
}

export default function VideoPlayer({
  videoUrl,
  startTime,
  endTime,
  seekTime,
  onEnded,
  onTimeUpdate,
  onDurationChange,
  onPlay,
  onPause,
  className = ''
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const lastSeekTimeRef = useRef<number | undefined>(undefined);
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>('unknown');
  const [currentQualityLevel, setCurrentQualityLevel] = useState<number>(-1);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Detect device and connection
  const { isMobile, connectionQuality: detectedConnectionQuality, isSlowConnection } = useDeviceDetection();
  
  // Update connection quality when detected
  useEffect(() => {
    if (detectedConnectionQuality) {
      setConnectionQuality(detectedConnectionQuality);
    }
  }, [detectedConnectionQuality]);

  // Check if URL needs to be proxied (Cloudflare Stream or SplitKit)
  const getProxiedUrl = (url: string): string => {
    if (url.includes('cloudflarestream.com')) {
      return `/api/proxy-video?url=${encodeURIComponent(url)}`;
    }
    // SplitKit URLs also need to be proxied due to CORS
    if (url.includes('thesplitkit.com')) {
      return `/api/proxy-video?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) {
      return;
    }

    const proxiedUrl = getProxiedUrl(videoUrl);
    // SplitKit URLs will be converted to HLS streams by the proxy
    const isHLS = videoUrl.includes('.m3u8') || videoUrl.includes('mpegURL') || videoUrl.includes('mpegurl') || videoUrl.includes('thesplitkit.com');

    // Clean up previous HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (isHLS && Hls.isSupported()) {
      // Get mobile-optimized HLS configuration
      const optimizationConfig = getVideoOptimizationConfig(isMobile, connectionQuality);
      const hlsConfig = getOptimalHLSConfig(isMobile, connectionQuality, startTime);
      
      // Use HLS.js for HLS streams with mobile-optimized configuration
      const hls = new Hls({
        ...hlsConfig,
        // Start loading from startTime if provided (optimize for chapter playback)
        // Only use startPosition for chapter playback, not for full videos
        startPosition: (startTime !== undefined && startTime > 0 && endTime !== undefined) ? startTime : -1,
        // Intercept all XHR requests to proxy Cloudflare Stream URLs
        xhrSetup: (xhr: XMLHttpRequest, url: string) => {
          // Skip if already proxied (relative or absolute)
          if (url.includes('/api/proxy-video')) {
            // Already proxied - no need to log (this happens frequently during playback)
            xhr.open('GET', url, true);
            return;
          }
          // If the URL is from Cloudflare Stream, proxy it (including audio segments)
          if (url.includes('cloudflarestream.com')) {
            const proxiedUrl = `/api/proxy-video?url=${encodeURIComponent(url)}`;
            xhr.open('GET', proxiedUrl, true);
            return;
          }
          // SplitKit URLs should work directly (they have CORS enabled)
          // Otherwise, use the original URL
          xhr.open('GET', url, true);
        }
      });

      hlsRef.current = hls;

      // For SplitKit URLs, try different possible HLS manifest paths
      // SplitKit might use different URL formats, so we'll try the base URL first
      // If that fails, HLS.js will handle the error
      const hlsUrl = proxiedUrl;
      
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        setError(null);
        
        // Track current quality level
        if (hls.levels && hls.levels.length > 0) {
          const currentLevel = hls.currentLevel;
          setCurrentQualityLevel(currentLevel);
        }
        
        // Get video duration when metadata is available
        const handleLoadedMetadata = () => {
          if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
            setVideoDuration(video.duration);
            if (onDurationChange) {
              onDurationChange(video.duration);
            }
          }
        };
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        
        // Seek to startTime if provided (in case startPosition didn't work)
        if (startTime !== undefined && startTime > 0) {
          // Use seeked event to ensure seeking is complete
          const seekToStart = () => {
            video.currentTime = startTime;
            video.removeEventListener('seeked', seekToStart);
          };
          video.addEventListener('seeked', seekToStart);
          video.currentTime = startTime;
        } else {
          // For videos without startTime (like raw videos), ensure video is ready
          // Try to play if metadata is already loaded
          if (video.readyState >= 2) {
            handleLoadedMetadata();
          }
        }
      });
      
      // Listen for level switches (quality changes)
      hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
        setCurrentQualityLevel(data.level);
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        // For non-fatal errors, HLS.js will automatically retry
        // Only log errors that might need attention
        if (!data.fatal) {
          // Suppress common non-fatal errors that HLS.js handles automatically
          if (data.details === 'fragLoadError' || data.details === 'fragParsingError') {
            // Don't log every fragment error - HLS.js handles retries automatically
            return;
          }
          
          // Handle audio track load errors - these are non-fatal, we can continue without alternate audio tracks
          if (data.details === 'audioTrackLoadError') {
            // Don't block playback - HLS.js will continue with the main audio track
            return;
          }
          
          // Handle level load errors - these are non-fatal, HLS.js will try other levels
          if (data.details === 'levelLoadError') {
            // Don't block playback - HLS.js will try other quality levels
            return;
          }
          
          // Suppress other non-fatal errors
          return;
        }
        
        // Fatal errors need handling
        console.error('❌ VideoPlayer: Fatal HLS error', { 
          type: data.type, 
          details: data.details, 
          error: data.error,
          url: data.url
        });
        
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.error('❌ VideoPlayer: Fatal network error, attempting recovery');
            setError('Network error loading video');
            try {
              hls.startLoad();
            } catch (e) {
              console.error('Failed to restart HLS:', e);
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.error('❌ VideoPlayer: Fatal media error, attempting recovery');
            setError('Media error loading video');
            try {
              hls.recoverMediaError();
            } catch (e) {
              console.error('Failed to recover from media error:', e);
              // Try destroying and recreating
              hls.destroy();
              hlsRef.current = null;
            }
            break;
          default:
            console.error('❌ VideoPlayer: Fatal error, destroying HLS instance');
            setError('Fatal error loading video');
            try {
              hls.destroy();
            } catch (e) {
              console.error('Error destroying HLS:', e);
            }
            hlsRef.current = null;
            break;
        }
      });
      
      // Listen for connection changes and adjust quality
      const connectionChangeCleanup = createConnectionChangeListener((newQuality) => {
        setConnectionQuality(newQuality);
        
        // If connection degraded, HLS.js will automatically switch to lower quality
        // If connection improved, we can manually trigger a level switch
        if (hls && hls.levels && hls.levels.length > 0) {
          const currentLevel = hls.currentLevel;
          const isSlow = newQuality === 'slow-2g' || newQuality === '2g' || newQuality === '3g';
          
          if (isSlow && currentLevel > 0) {
            // Connection degraded - switch to lower quality
            hls.currentLevel = Math.max(0, currentLevel - 1);
          }
        }
      });
      
      // Cleanup connection listener on unmount
      if (connectionChangeCleanup) {
        // Store cleanup function to call later
        (hls as any)._connectionChangeCleanup = connectionChangeCleanup;
      }
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      video.src = proxiedUrl;
      video.addEventListener('loadedmetadata', () => {
        setIsLoading(false);
        setError(null);
        
        // Get video duration when metadata is available
        if (video.duration && !isNaN(video.duration) && isFinite(video.duration) && onDurationChange) {
          onDurationChange(video.duration);
        }
        
        // Seek to startTime if provided
        if (startTime !== undefined && startTime > 0) {
          video.currentTime = startTime;
        }
      });
    } else {
      // Fallback for non-HLS videos
      video.src = proxiedUrl;
      video.addEventListener('loadedmetadata', () => {
        setIsLoading(false);
        setError(null);
        
        // Get video duration when metadata is available
        if (video.duration && !isNaN(video.duration) && isFinite(video.duration) && onDurationChange) {
          onDurationChange(video.duration);
        }
        
        // Seek to startTime if provided
        if (startTime !== undefined && startTime > 0) {
          video.currentTime = startTime;
        }
      });
    }

    // Handle time updates for chapter/segment playback
    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      
      if (onTimeUpdate) {
        onTimeUpdate(video.currentTime);
      }

      // Check if we've reached the end time for chapter playback
      if (endTime !== undefined && video.currentTime >= endTime) {
        video.pause();
        setIsPlaying(false);
        // Seek back slightly to prevent going past endTime
        if (video.currentTime > endTime) {
          video.currentTime = endTime;
        }
        if (onEnded) {
          onEnded();
        }
      }
      
      // Prevent seeking before startTime if chapter playback is active
      if (startTime !== undefined && startTime > 0 && endTime !== undefined) {
        if (video.currentTime < startTime) {
          video.currentTime = startTime;
        }
      }
    };
    
    // Handle play/pause events
    const handlePlay = () => {
      setIsPlaying(true);
      if (onPlay) {
        onPlay();
      }
    };
    const handlePause = () => {
      setIsPlaying(false);
      if (onPause) {
        onPause();
      }
    };
    
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    // Handle picture-in-picture events
    const handleEnterPictureInPicture = () => {
      setIsPictureInPicture(true);
    };
    const handleLeavePictureInPicture = () => {
      setIsPictureInPicture(false);
    };

    // Handle fullscreen events
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement === video ||
        (document as any).webkitFullscreenElement === video ||
        (document as any).mozFullScreenElement === video ||
        (document as any).msFullscreenElement === video
      );
      setIsFullscreen(isCurrentlyFullscreen);
    };

    video.addEventListener('enterpictureinpicture', handleEnterPictureInPicture);
    video.addEventListener('leavepictureinpicture', handleLeavePictureInPicture);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // Handle video ended
    const handleEnded = () => {
      if (onEnded) {
        onEnded();
      }
    };

    // Handle errors gracefully (including abort errors)
    const handleError = () => {
      if (video.error) {
        // Don't show error for abort errors (normal during navigation/unmount)
        // MEDIA_ERR_ABORTED = 1
        if (video.error.code === 1 || video.error.message?.toLowerCase().includes('abort')) {
          setIsLoading(false);
          return;
        }
        setError(`Video error: ${video.error.message}`);
        setIsLoading(false);
      }
    };
    
    // Handle abort errors from fetch/load operations
    const handleAbort = () => {
      setIsLoading(false);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    video.addEventListener('abort', handleAbort);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      video.removeEventListener('abort', handleAbort);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('enterpictureinpicture', handleEnterPictureInPicture);
      video.removeEventListener('leavepictureinpicture', handleLeavePictureInPicture);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      
      // Clean up HLS instance more carefully to avoid abort errors
      if (hlsRef.current) {
        try {
          // Cleanup connection change listener if it exists
          const cleanup = (hlsRef.current as any)._connectionChangeCleanup;
          if (cleanup) {
            cleanup();
          }
          
          // Stop loading before destroying
          hlsRef.current.stopLoad();
          hlsRef.current.detachMedia();
          hlsRef.current.destroy();
        } catch (error) {
          // Ignore cleanup errors (e.g., already destroyed)
        }
        hlsRef.current = null;
      }
    };
    // Depend on videoUrl, startTime, endTime, isMobile, and connectionQuality
    // Callbacks are stable or handled via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, startTime, endTime, isMobile, connectionQuality]);

  // Handle external seek requests (from global now playing bar)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || seekTime === undefined || seekTime === lastSeekTimeRef.current) {
      return;
    }

    // Convert chapter-relative time to absolute time if playing a chapter segment
    let absoluteSeekTime = seekTime;
    if (startTime !== undefined && startTime > 0) {
      absoluteSeekTime = startTime + seekTime;
      // Clamp to chapter bounds
      if (endTime !== undefined) {
        absoluteSeekTime = Math.max(startTime, Math.min(endTime, absoluteSeekTime));
      }
    }

    // Only seek if the time is different from current time (avoid feedback loops)
    if (Math.abs(video.currentTime - absoluteSeekTime) > 0.5) {
      video.currentTime = absoluteSeekTime;
      lastSeekTimeRef.current = seekTime;
    }
  }, [seekTime, startTime, endTime]);

  // Show controls when paused, hide when playing (with auto-hide)
  useEffect(() => {
    if (!isPlaying) {
      // Always show controls when paused
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    } else {
      // When playing, show controls temporarily then auto-hide
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  }, [isPlaying]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // Calculate duration and current time
  // For chapter playback, use chapter duration/time; otherwise use full video duration/time
  const displayDuration = startTime !== undefined && endTime !== undefined 
    ? endTime - startTime 
    : videoDuration;
  const displayCurrentTime = startTime !== undefined 
    ? Math.max(0, currentTime - startTime) 
    : currentTime;
  
  // Format time helper
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Handle seeking
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    
    const seekPercent = parseFloat(e.target.value);
    if (startTime !== undefined && endTime !== undefined) {
      // Chapter playback: seek within chapter bounds
      const seekTime = startTime + (seekPercent / 100) * (endTime - startTime);
      const clampedTime = Math.max(startTime, Math.min(endTime, seekTime));
      video.currentTime = clampedTime;
    } else {
      // Full video: seek within full duration
      const seekTime = (seekPercent / 100) * videoDuration;
      video.currentTime = Math.max(0, Math.min(videoDuration, seekTime));
    }
    // Show controls when seeking
    showControlsTemporarily();
  };
  
  // Show controls temporarily
  const showControlsTemporarily = () => {
    setShowControls(true);
    // Clear existing timeout
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    // Auto-hide after 3 seconds of inactivity (only if playing)
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  // Handle mouse enter/leave
  const handleMouseEnter = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
  };

  const handleMouseLeave = () => {
    // Only hide if playing, keep visible if paused
    if (isPlaying) {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  // Handle mouse move (show controls on interaction)
  const handleMouseMove = () => {
    showControlsTemporarily();
  };

  // Toggle play/pause
  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
    // Show controls when toggling
    showControlsTemporarily();
  };
  
  // Skip forward (30 seconds) / backward (10 seconds)
  const skipForward = () => {
    const video = videoRef.current;
    if (!video) return;
    
    const newTime = Math.min(
      video.duration || 0,
      (startTime !== undefined && endTime !== undefined)
        ? Math.min(endTime, video.currentTime + 30)
        : video.currentTime + 30
    );
    video.currentTime = newTime;
    // Show controls when skipping
    showControlsTemporarily();
  };
  
  const skipBackward = () => {
    const video = videoRef.current;
    if (!video) return;
    
    const newTime = Math.max(
      startTime !== undefined && startTime > 0 ? startTime : 0,
      video.currentTime - 10
    );
    video.currentTime = newTime;
    // Show controls when skipping
    showControlsTemporarily();
  };

  // Picture-in-Picture toggle
  const togglePictureInPicture = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      // Check if PiP API is supported
      if (!document.pictureInPictureEnabled) {
        return;
      }

      if (document.pictureInPictureElement) {
        // Exit PiP
        await document.exitPictureInPicture();
      } else {
        // Enter PiP
        await video.requestPictureInPicture();
      }
    } catch (error) {
      console.error('Error toggling picture-in-picture:', error);
    }
  };

  // Fullscreen toggle
  const toggleFullscreen = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      // Check if we're on iOS (Safari on iOS)
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      
      // iOS Safari uses webkitEnterFullscreen() method on the video element
      if (isIOS && (video as any).webkitEnterFullscreen) {
        // iOS Safari: Use native fullscreen method
        (video as any).webkitEnterFullscreen();
        return;
      }

      const isCurrentlyFullscreen = !!(
        document.fullscreenElement === video ||
        (document as any).webkitFullscreenElement === video ||
        (document as any).mozFullScreenElement === video ||
        (document as any).msFullscreenElement === video
      );

      if (isCurrentlyFullscreen) {
        // Exit fullscreen
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
          await (document as any).mozCancelFullScreen();
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen();
        }
      } else {
        // Enter fullscreen
        if (video.requestFullscreen) {
          await video.requestFullscreen();
        } else if ((video as any).webkitRequestFullscreen) {
          await (video as any).webkitRequestFullscreen();
        } else if ((video as any).mozRequestFullScreen) {
          await (video as any).mozRequestFullScreen();
        } else if ((video as any).msRequestFullscreen) {
          await (video as any).msRequestFullscreen();
        }
      }
    } catch (error) {
      console.error('Error toggling fullscreen:', error);
    }
  };

  return (
    <div 
      className={`relative w-full ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      onTouchStart={showControlsTemporarily}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-10">
          <div className="text-white text-center">
            <div className="mb-2">Loading video...</div>
            {isMobile && isSlowConnection && (
              <div className="text-xs text-white/60">
                Slow connection detected ({connectionQuality})
              </div>
            )}
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900/80 z-10">
          <div className="text-white">{error}</div>
        </div>
      )}
      <video
        ref={videoRef}
        controls={false}
        className="w-full h-auto rounded-lg"
        playsInline
        onClick={togglePlayPause}
      />
      
      {/* Custom controls overlaid on video */}
      <div 
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-4 rounded-b-lg transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
      >
        {/* Custom progress bar */}
        <div className="mb-3">
          <input
            type="range"
            min="0"
            max="100"
            value={displayDuration > 0 ? (displayCurrentTime / displayDuration) * 100 : 0}
            onChange={handleSeek}
            className={`w-full ${isMobile ? 'h-3' : 'h-2'} bg-white/20 rounded-lg appearance-none cursor-pointer touch-manipulation`}
            style={{
              background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(displayDuration > 0 ? (displayCurrentTime / displayDuration) * 100 : 0)}%, rgba(255,255,255,0.2) ${(displayDuration > 0 ? (displayCurrentTime / displayDuration) * 100 : 0)}%, rgba(255,255,255,0.2) 100%)`
            }}
          />
        </div>
          
        {/* Time display and controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={skipBackward}
              className={`${isMobile ? 'p-3 min-w-[44px] min-h-[44px]' : 'p-2'} hover:bg-white/10 rounded-lg transition-colors touch-manipulation`}
              aria-label="Skip backward 10 seconds"
              title="Skip backward 10 seconds"
            >
                <svg className={`${isMobile ? 'w-6 h-6' : 'w-5 h-5'} text-white`} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                </svg>
            </button>
            <button
              onClick={togglePlayPause}
              className={`${isMobile ? 'p-3 min-w-[44px] min-h-[44px]' : 'p-2'} hover:bg-white/10 rounded-lg transition-colors touch-manipulation`}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
                {isPlaying ? (
                  <svg className={`${isMobile ? 'w-6 h-6' : 'w-5 h-5'} text-white`} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                  </svg>
                ) : (
                  <svg className={`${isMobile ? 'w-6 h-6' : 'w-5 h-5'} text-white`} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                )}
            </button>
            <button
              onClick={skipForward}
              className={`${isMobile ? 'p-3 min-w-[44px] min-h-[44px]' : 'p-2'} hover:bg-white/10 rounded-lg transition-colors touch-manipulation`}
              aria-label="Skip forward 30 seconds"
              title="Skip forward 30 seconds"
            >
                <svg className={`${isMobile ? 'w-6 h-6' : 'w-5 h-5'} text-white`} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/>
                </svg>
            </button>
            {/* Picture-in-Picture button - only show if supported */}
            {typeof document !== 'undefined' && document.pictureInPictureEnabled && (
              <button
                onClick={togglePictureInPicture}
                className={`${isMobile ? 'p-3 min-w-[44px] min-h-[44px]' : 'p-2'} hover:bg-white/10 rounded-lg transition-colors touch-manipulation ${
                  isPictureInPicture ? 'bg-white/20' : ''
                }`}
                aria-label={isPictureInPicture ? 'Exit picture-in-picture' : 'Enter picture-in-picture'}
                title={isPictureInPicture ? 'Exit picture-in-picture' : 'Enter picture-in-picture'}
              >
                  <svg className={`${isMobile ? 'w-6 h-6' : 'w-5 h-5'} text-white`} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 7h-8v6h8V7zm0-2c1.1 0 2 .9 2 2v6c0 1.1-.9 2-2 2h-8c-1.1 0-2-.9-2-2V7c0-1.1.9-2 2-2h8zM9 5H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h5v2h2v-4H4V7h5V5zm7 10h2v2h-2v-2zm-4 0h2v2h-2v-2z"/>
                  </svg>
              </button>
            )}
            {/* Fullscreen button */}
            <button
              onClick={toggleFullscreen}
              className={`${isMobile ? 'p-3 min-w-[44px] min-h-[44px]' : 'p-2'} hover:bg-white/10 rounded-lg transition-colors touch-manipulation ${
                isFullscreen ? 'bg-white/20' : ''
              }`}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
                {isFullscreen ? (
                  <svg className={`${isMobile ? 'w-6 h-6' : 'w-5 h-5'} text-white`} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-6V5h-2v5h5V8h-3z"/>
                  </svg>
                ) : (
                  <svg className={`${isMobile ? 'w-6 h-6' : 'w-5 h-5'} text-white`} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                  </svg>
                )}
            </button>
            <div className={`${isMobile ? 'text-base' : 'text-sm'} text-white/80`}>
              <span>{formatTime(displayCurrentTime)}</span>
              <span className="text-white/40"> / {formatTime(displayDuration)}</span>
            </div>
          </div>
          {isMobile && isSlowConnection && (
            <div className="text-xs text-white/60">
              <span>📶 {connectionQuality}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

