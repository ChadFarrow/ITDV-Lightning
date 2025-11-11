'use client';

import { useState, useRef, useEffect, memo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Play, Pause, Music, Zap, Video } from 'lucide-react';
import type { RSSValue, RSSValueRecipient } from '@/lib/rss-parser';
import { useLightning } from '@/contexts/LightningContext';
import CDNImage from '@/components/CDNImage';

interface Track {
  title: string;
  duration: string;
  url: string;
  videoUrl?: string; // Video enclosure URL (HLS .m3u8 files)
  trackNumber: number;
  image?: string;
  value?: RSSValue; // Track-level podcast:value data
  // Podcast GUIDs for Nostr boost tagging
  guid?: string; // Item GUID from RSS <guid> element  
  podcastGuid?: string; // podcast:guid at item level
  feedGuid?: string; // Feed GUID from podcast namespace
  feedUrl?: string; // Feed URL for this track
  publisherGuid?: string; // Publisher GUID
  publisherUrl?: string; // Publisher URL
  imageUrl?: string; // Track artwork URL
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
  funding?: any[];
  value?: RSSValue;
  podroll?: any[];
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

interface AlbumCardProps {
  album: Album;
  isPlaying?: boolean;
  onPlay: (album: Album, e: React.MouseEvent | React.TouchEvent) => void;
  onBoostClick?: (album: Album) => void;
  className?: string;
  priority?: boolean; // Prioritize image loading for above-the-fold images
}

function AlbumCard({ album, isPlaying = false, onPlay, onBoostClick, className = '', priority = false }: AlbumCardProps) {
  const { isLightningEnabled } = useLightning();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);


  // Minimum swipe distance (in px)
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart || !touchEnd) return;
    
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    // Only handle swipes, remove tap-to-play to prevent accidental plays
    if (isLeftSwipe) {
      // Left swipe - play next track (future enhancement)
    } else if (isRightSwipe) {
      // Right swipe - play previous track (future enhancement)
    }
  };

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);
  };

  const handleImageError = () => {
    setImageError(true);
    setImageLoaded(false);
  };



  const getAlbumUrl = (album: Album) => {
    // Create URL-friendly slug from album title
    // Handle special characters and punctuation more carefully
    const slug = album.title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')       // Remove punctuation except spaces and hyphens
      .replace(/\s+/g, '-')           // Replace spaces with dashes
      .replace(/-+/g, '-')            // Replace multiple consecutive dashes with single dash
      .replace(/^-+|-+$/g, '');       // Remove leading/trailing dashes
    return `/album/${encodeURIComponent(slug)}`;
  };
  
  const albumUrl = getAlbumUrl(album);
  
  // Removed console.log for production performance

  return (
    <div className={`group relative bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 overflow-hidden transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:scale-[1.02] active:scale-[0.98] block ${className}`}>
      
      <Link 
        href={albumUrl}
        aria-label={`View album details for ${album.title} by ${album.artist}`}
        className="block"
      >
      {/* Album Artwork */}
      <div 
        className="relative aspect-square overflow-hidden"
        onTouchStart={(e) => {
          // Only handle touch events on the artwork area, not on the play button
          if (!(e.target as HTMLElement).closest('button')) {
            onTouchStart(e);
          }
        }}
        onTouchMove={(e) => {
          if (!(e.target as HTMLElement).closest('button')) {
            onTouchMove(e);
          }
        }}
        onTouchEnd={(e) => {
          if (!(e.target as HTMLElement).closest('button')) {
            onTouchEnd(e);
          }
        }}
        onClick={(e) => {
          // Prevent navigation when clicking on the artwork area (play button handles its own clicks)
          if (!(e.target as HTMLElement).closest('button')) {
            // Let the Link handle the navigation
          }
        }}
      >
        {album.coverArt.toLowerCase().includes('.gif') ? (
          // Use CDNImage for GIFs with optimized loading
          <div className="absolute inset-0">
            <CDNImage
              src={album.coverArt}
              alt={`${album.title} by ${album.artist}`}
              width={400}
              height={400}
              className={`w-full h-full object-cover transition-opacity duration-300 ${
                imageLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              onLoad={handleImageLoad}
              onError={handleImageError}
              priority={priority}
              quality={85}
              sizes="(max-width: 768px) 50vw, (max-width: 1200px) 25vw, 20vw"
            />
          </div>
        ) : (
          // Use regular Image for non-GIF images
          <Image
            src={album.coverArt}
            alt={`${album.title} by ${album.artist}`}
            fill
            className={`object-cover transition-opacity duration-300 ${
              imageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={handleImageLoad}
            onError={handleImageError}
            priority={priority}
            quality={85}
            sizes="(max-width: 768px) 50vw, (max-width: 1200px) 25vw, 20vw"
          />
        )}
        
        {/* Loading placeholder */}
        {!imageLoaded && !imageError && (
          <div className="absolute inset-0 bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center">
            <Music className="w-8 h-8 text-gray-400 animate-pulse" />
          </div>
        )}
        
        {/* Error placeholder */}
        {imageError && (
          <div className="absolute inset-0 bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center">
            <Music className="w-8 h-8 text-gray-400" />
          </div>
        )}

        {/* Play/Pause Overlay - Always visible on mobile, hover-based on desktop */}
        <div className="absolute inset-0 bg-black/20 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center pointer-events-none">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              
              // Only trigger play if not scrolling
              const scrolling = document.body.classList.contains('is-scrolling');
              if (!scrolling) {
                onPlay(album, e);
              }
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              // Mark that we're interacting with button
              (e.currentTarget as HTMLElement).dataset.touched = 'true';
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              
              const button = e.currentTarget as HTMLElement;
              if (button.dataset.touched === 'true') {
                delete button.dataset.touched;
                // Small delay to ensure it's a deliberate tap, not accidental during scroll
                setTimeout(() => {
                  const scrolling = document.body.classList.contains('is-scrolling');
                  if (!scrolling) {
                    onPlay(album, e);
                  }
                }, 150);
              }
            }}
            className="w-16 h-16 md:w-12 md:h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-white/30 active:bg-white/40 transition-colors duration-200 touch-manipulation pointer-events-auto"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-6 h-6 text-white" />
            ) : (
              <Play className="w-6 h-6 text-white ml-1" />
            )}
          </button>
        </div>

        {/* Lightning tip button - moved to top left - only show when Lightning is enabled */}
        {isLightningEnabled && (
          <div className="absolute top-1 left-1 sm:top-2 sm:left-2 flex items-center gap-1 sm:gap-2">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onBoostClick) {
                  onBoostClick(album);
                }
              }}
              className="w-6 h-6 sm:w-7 sm:h-7 bg-yellow-500/90 hover:bg-yellow-600/90 backdrop-blur-sm rounded-full flex items-center justify-center transition-colors z-10"
              aria-label={`Boost ${album.artist}`}
            >
              <Zap className="w-3 h-3 sm:w-4 sm:h-4 text-black" />
            </button>
          </div>
        )}
        
        {/* Track count badge - kept on the right */}
        {album.tracks.length > 0 && (
          <div className="absolute top-1 right-1 sm:top-2 sm:right-2 bg-black/50 backdrop-blur-sm rounded-full px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs text-white flex items-center gap-1">
            <span>{album.tracks.length} {album.tracks.length !== 1 ? 'tracks' : 'track'}</span>
            {album.tracks.some(track => track.videoUrl) && (
              <span className="inline-flex items-center" title="Contains video tracks" aria-label="Contains video tracks">
                <Video className="w-3 h-3 text-purple-400" />
              </span>
            )}
          </div>
        )}
      </div>

      {/* Album Info */}
      <div className="p-2 sm:p-3 bg-black/70 backdrop-blur-sm">
        <h3 className="font-semibold text-white text-xs sm:text-sm leading-tight line-clamp-2 group-hover:text-blue-300 transition-colors duration-200">
          {album.title}
        </h3>
        <p className="text-gray-300 text-[10px] sm:text-xs mt-0.5 sm:mt-1 line-clamp-1">
          {album.artist}
        </p>
        
        {/* Release date and publisher indicator */}
        <div className="flex items-center justify-between mt-0.5 sm:mt-1">
          {album.releaseDate && (
            <p className="text-gray-400 text-[10px] sm:text-xs">
              {new Date(album.releaseDate).getFullYear()}
            </p>
          )}
        </div>
      </div>

      {/* Mobile touch feedback */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-white/5 opacity-0 group-active:opacity-100 transition-opacity duration-150" />
      </div>
      </Link>
    </div>
  );
}

// Wrap with React.memo to prevent unnecessary re-renders
export default memo(AlbumCard);