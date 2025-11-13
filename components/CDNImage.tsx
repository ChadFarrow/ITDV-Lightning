'use client';

import Image from 'next/image';
import { useState, useEffect, useRef, useCallback } from 'react';

interface CDNImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png' | 'gif' | 'auto';
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  onError?: () => void;
  onLoad?: () => void;
  fallbackSrc?: string;
  sizes?: string;
  placeholder?: 'blur' | 'empty';
  style?: React.CSSProperties;
}

export default function CDNImage({
  src,
  alt,
  width,
  height,
  className,
  priority = false,
  quality = 85,
  onError,
  onLoad,
  fallbackSrc,
  sizes,
  placeholder = 'empty',
  style,
  ...props
}: CDNImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(src);
  const [retryCount, setRetryCount] = useState(0);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);
  const [isGif, setIsGif] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [gifLoaded, setGifLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  // Check if we're on mobile
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [userAgent, setUserAgent] = useState('');
  
  // Detect if the image is a GIF
  useEffect(() => {
    const isGifImage = Boolean((src && typeof src === 'string' && src.toLowerCase().includes('.gif')) || 
                      (currentSrc && typeof currentSrc === 'string' && currentSrc.toLowerCase().includes('.gif')));
    setIsGif(isGifImage);
  }, [src, currentSrc]);

  // Check if image should bypass Next.js optimization (for problematic PNGs)
  const shouldBypassOptimization = useCallback(() => {
    const url = currentSrc || src;
    if (!url || typeof url !== 'string') return false;
    
    // Bypass optimization for doerfelverse.com PNGs (they get corrupted by Next.js optimization)
    if (url.includes('doerfelverse.com') && url.toLowerCase().includes('.png')) {
      return true;
    }
    
    // Bypass for GIFs and already optimized images
    if (isGif || url.includes('/api/optimized-images/')) {
      return true;
    }
    
    return false;
  }, [currentSrc, src, isGif]);
  
  useEffect(() => {
    setIsClient(true);
    const checkDevice = () => {
      const width = window.innerWidth;
      const ua = navigator.userAgent;
      setIsMobile(width <= 768);
      setIsTablet(width > 768 && width <= 1024);
      setUserAgent(ua);
      
      // Mobile detection without logging for performance
    };
    
    checkDevice();
    const handleResize = () => checkDevice();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Preload priority GIFs immediately with fetchpriority hint
  useEffect(() => {
    if (isGif && priority && isClient) {
      // Preload priority GIFs immediately - use src directly for preload
      const preloadLink = document.createElement('link');
      preloadLink.rel = 'preload';
      preloadLink.as = 'image';
      preloadLink.href = src;
      // Add fetchpriority for better browser prioritization
      if ('fetchPriority' in preloadLink) {
        (preloadLink as any).fetchPriority = 'high';
      }
      document.head.appendChild(preloadLink);
      setShowGif(true);
      
      // Also create an img element to start loading immediately
      const img = document.createElement('img');
      img.src = src;
      img.loading = 'eager';
      if ('fetchPriority' in img) {
        (img as any).fetchPriority = 'high';
      }
      
      return () => {
        // Cleanup is optional - browser will handle it
      };
    }
  }, [isGif, priority, isClient, src]);

  // Intersection Observer for GIF lazy loading with aggressive preloading
  useEffect(() => {
    if (!isGif || !isClient) {
      return;
    }

    // Priority GIFs should load immediately
    if (priority) {
      setShowGif(true);
      return;
    }

    // For non-priority GIFs, use intersection observer with smaller rootMargin
    // Large GIFs (5MB+) should only load when actually needed to avoid blocking
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShowGif(true);
            // Preload the GIF when it's about to be visible
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'image';
            link.href = src;
            document.head.appendChild(link);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '100px', // Reduced from 300px - only load when closer to viewport for large GIFs
        threshold: 0.01 // Trigger as soon as any part is visible
      }
    );

    if (imageRef.current) {
      observer.observe(imageRef.current);
    }

    return () => observer.disconnect();
  }, [isGif, isClient, priority, src]);

  // Generate optimized image URL
  const getOptimizedUrl = useCallback((originalUrl: string, targetWidth?: number, targetHeight?: number) => {
    // If it's already an optimized URL, return as is
    if (originalUrl.includes('/api/optimized-images/')) {
      return originalUrl;
    }
    
    // For large images, use optimized endpoint
    const largeImages = [
      'you-are-my-world.gif',
      'HowBoutYou.gif', 
      'autumn.gif',
      'WIldandfreecover-copy-2.png',
      'alandace.gif',
      'doerfel-verse-idea-9.png',
      'SatoshiStreamer-track-1-album-art.png',
      'dvep15-art.png',
      'disco-swag.png',
      'first-christmas-art.jpg',
      'let-go-art.png'
    ];
    
    const filename = originalUrl.split('/').pop();
    if (filename && largeImages.some(img => filename.includes(img.replace(/\.(png|jpg|gif)$/, '')))) {
      const optimizedFilename = largeImages.find(img => filename.includes(img.replace(/\.(png|jpg|gif)$/, '')));
      if (optimizedFilename) {
        let optimizedUrl = `https://re.podtards.com/api/optimized-images/${optimizedFilename}`;
        
        // Add size parameters for responsive loading
        if (targetWidth || targetHeight) {
          const params = new URLSearchParams();
          if (targetWidth) params.set('w', targetWidth.toString());
          if (targetHeight) params.set('h', targetHeight.toString());
          params.set('q', quality.toString());
          
          // Use WebP for better compression if supported (but not for GIFs)
          if (typeof window !== 'undefined' && window.navigator.userAgent.includes('Chrome') && !isGif) {
            params.set('f', 'webp');
          }
          
          optimizedUrl += `?${params.toString()}`;
        }
        
        return optimizedUrl;
      }
    }
    
    return originalUrl;
  }, [width, height]);

  const getResponsiveSizes = useCallback(() => {
    if (sizes) return sizes;
    
    // For GIFs, use smaller sizes to improve performance
    if (isGif) {
      if (isMobile) {
        return '(max-width: 768px) 200px, (max-width: 1024px) 300px, 400px';
      } else if (isTablet) {
        return '(max-width: 1024px) 300px, 400px';
      } else {
        return '(max-width: 768px) 200px, (max-width: 1024px) 300px, 400px';
      }
    }
    
    if (isMobile) {
      return '(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw';
    } else if (isTablet) {
      return '(max-width: 1024px) 50vw, 33vw';
    } else {
      return '(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw';
    }
  }, [sizes, isGif, isMobile, isTablet]);

  const getImageDimensions = useCallback(() => {
    if (width && height) {
      return { width, height };
    }
    
    // For GIFs, use smaller dimensions to improve performance
    if (isGif) {
      if (isMobile) {
        return { width: 200, height: 200 };
      } else if (isTablet) {
        return { width: 300, height: 300 };
      } else {
        return { width: 400, height: 400 };
      }
    }
    
    // Default dimensions for mobile optimization
    if (isMobile) {
      return { width: 300, height: 300 };
    } else if (isTablet) {
      return { width: 400, height: 400 };
    } else {
      return { width: 500, height: 500 };
    }
  }, [width, height, isGif]);


  const getOriginalUrl = useCallback((imageUrl: string) => {
    if (imageUrl.includes('/api/optimized-images/')) {
      // Extract original URL from optimized URL
      const filename = imageUrl.split('/').pop()?.split('?')[0];
      if (filename) {
        // This is a simplified fallback - in practice, you'd need a mapping
        return fallbackSrc || imageUrl;
      }
    }
    return fallbackSrc || imageUrl;
  }, [fallbackSrc]);

  const handleError = useCallback(() => {
    // Prevent recursion by checking if component is unmounted or src changed
    if (!src) return;
    
    // Minimal error handling for performance
    setIsLoading(false);
    
    // Clear timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }
    
    // First try the fallback URL if provided and different
    if (retryCount === 0 && fallbackSrc && fallbackSrc !== currentSrc) {
      setCurrentSrc(fallbackSrc);
      setHasError(false);
      setIsLoading(true);
      setRetryCount(1);
      return;
    }
    
    // If fallbackSrc is the same as currentSrc, skip to proxy attempt
    if (retryCount === 0 && fallbackSrc === currentSrc) {
      setRetryCount(1);
      return;
    }
    
    // Try image proxy for CORS errors (all devices)
    if (retryCount === 1 && !currentSrc.includes('/api/')) {
      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(currentSrc)}`;
      setCurrentSrc(proxyUrl);
      setHasError(false);
      setIsLoading(true);
      setRetryCount(2);
      return;
    }
    
    // Then try without optimization
    if (retryCount === 2 && currentSrc.includes('/api/optimized-images/')) {
      const originalUrl = getOriginalUrl(currentSrc);
      if (originalUrl && originalUrl !== currentSrc) {
        setCurrentSrc(originalUrl);
        setHasError(false);
        setIsLoading(true);
        setRetryCount(3);
        return;
      }
    }
    
    // All retry attempts have failed - only now call onError and show placeholder
    setHasError(true);
    onError?.(); // Only call onError after all retries have failed
  }, [src, currentSrc, retryCount, fallbackSrc, onError]);

  const handleLoad = () => {
    setIsLoading(false);
    setHasError(false);
    setGifLoaded(true);
    
    // Clear timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }
    
    onLoad?.();
  };

  // Use ref to track the last processed src to prevent infinite loops
  const lastProcessedSrcRef = useRef<string>('');
  
  // Reset state when src changes
  useEffect(() => {
    if (!src) return;
    
    // Skip if we've already processed this exact src
    if (lastProcessedSrcRef.current === src) {
      return;
    }
    
    const dims = getImageDimensions();
    let imageSrc = src;
    
    // Check if it's a GIF by looking at the src directly (more reliable than state)
    const isGifFile = src && typeof src === 'string' && src.toLowerCase().includes('.gif');
    
    // Mobile-first approach: bypass optimization, go straight to proxy if external
    // BUT: For GIFs, always use the original URL directly (don't proxy) to avoid issues with large files
    if (isClient && isMobile && !isGifFile) {
      // For mobile, if it's an external URL, use proxy immediately (but not for GIFs)
      if (src && !src.includes('re.podtards.com') && !src.includes('/api/')) {
        imageSrc = `/api/proxy-image?url=${encodeURIComponent(src)}`;
      } else {
        // For internal URLs, use as-is or with light optimization
        imageSrc = getOptimizedUrl(src, dims.width, dims.height);
      }
    } else {
      // For desktop or GIFs, use original URL directly (bypass proxy for GIFs)
      if (isGifFile) {
        // For GIFs, always use the original URL directly to avoid proxy issues with large files
        imageSrc = src;
      } else {
        imageSrc = getOptimizedUrl(src, dims.width, dims.height);
      }
    }
    
    // Mark this src as processed and update state
    lastProcessedSrcRef.current = src;
    setCurrentSrc((prevSrc) => {
      // Only update if different to prevent unnecessary re-renders
      return prevSrc !== imageSrc ? imageSrc : prevSrc;
    });
    setIsLoading(true);
    setHasError(false);
    setRetryCount(0);
    setGifLoaded(false);
    
    // Clear existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, width, height, isClient, isMobile]); // Don't include currentSrc to prevent loops

  // Separate effect for handling timeouts to prevent recursion
  useEffect(() => {
    if (hasError || !isLoading || !currentSrc) return;
    
    // Clear existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }
    
    // Set timeout based on retry count and whether it's a GIF
    // Large GIFs (like Autumn Rust at 39MB) need longer timeouts
    let timeout: NodeJS.Timeout;
    if (retryCount === 0) {
      // Initial load timeout - longer for GIFs to handle large files
      timeout = setTimeout(() => handleError(), isGif ? 30000 : 15000);
    } else if (retryCount === 1) {
      // Fallback/proxy timeout
      timeout = setTimeout(() => handleError(), isGif ? 20000 : 10000);
    } else if (retryCount === 2) {
      // Proxy timeout
      timeout = setTimeout(() => handleError(), isGif ? 25000 : 12000);
    } else if (retryCount === 3) {
      // Original URL timeout
      timeout = setTimeout(() => handleError(), isGif ? 30000 : 15000);
    } else {
      // No more retries
      return;
    }
    
    setTimeoutId(timeout);
    
    return () => {
      if (timeout) clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSrc, retryCount, isLoading, hasError, isGif]); // Removed handleError and timeoutId from deps to prevent loops

  const dims = getImageDimensions();

  return (
    <div className={`relative ${className || ''}`} ref={imageRef}>
      {isLoading && (
        <div className="absolute inset-0 bg-gray-800/50 animate-pulse rounded flex items-center justify-center">
          <div className="w-6 h-6 bg-white/20 rounded-full animate-spin"></div>
          {isGif && (
            <div className="absolute bottom-1 right-1 bg-black/50 text-white text-xs px-1 py-0.5 rounded">
              🎬 GIF
            </div>
          )}
        </div>
      )}
      
      {hasError && (
        <div className="absolute inset-0 bg-gray-800/50 rounded flex items-center justify-center">
          <div className="text-white/60 text-sm">Image unavailable</div>
        </div>
      )}
      
      {isClient && isMobile ? (
        // Enhanced mobile image handling
        // Only render Image if we have a valid src (for GIFs, only when showGif is true)
        (isGif ? showGif : true) && currentSrc ? (
          <Image
            src={currentSrc}
            alt={alt}
            width={dims.width}
            height={dims.height}
            className={`${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300 ${className || ''}`}
            onError={handleError}
            onLoad={handleLoad}
            loading={priority ? 'eager' : 'lazy'}
            priority={priority} // Priority set for above-the-fold images
            unoptimized={shouldBypassOptimization()} // Don't optimize GIFs, problematic PNGs, or already optimized images
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
            style={{ 
              objectFit: 'cover',
              width: '100%',
              height: '100%',
              display: 'block',
              ...style
            }}
            {...props}
          />
        ) : null
      ) : (
        // Use Next.js Image for desktop with full optimization
        // Only render Image if we have a valid src (for GIFs, only when showGif is true)
        (isGif ? showGif : true) && currentSrc ? (
          <Image
            src={currentSrc}
            alt={alt}
            width={dims.width}
            height={dims.height}
            className={`${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
            priority={priority} // Priority set for above-the-fold images
            quality={quality}
            sizes={getResponsiveSizes()}
            onError={handleError}
            onLoad={handleLoad}
            placeholder={placeholder}
            unoptimized={shouldBypassOptimization()} // Don't optimize GIFs, problematic PNGs, or already optimized images
            style={style}
            {...props}
          />
        ) : null
      )}
      
      {/* Debug info removed for performance */}
    </div>
  );
} 