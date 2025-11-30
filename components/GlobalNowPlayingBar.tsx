'use client';

import React from 'react';
import Image from 'next/image';
import { useAudio } from '@/contexts/AudioContext';
import { useVideo } from '@/contexts/VideoContext';
import { useSwipeGestures } from '@/hooks/useSwipeGestures';
import NowPlayingScreen from './NowPlayingScreen';

const GlobalNowPlayingBar: React.FC = React.memo(function GlobalNowPlayingBar() {
  const audioContext = useAudio();
  const videoContext = useVideo();
  
  // Determine if video or audio is active
  // Show video in now playing bar if there's a current video (playing or paused)
  const hasVideo = videoContext.currentVideo !== null;
  const isVideoPlaying = hasVideo && videoContext.isPlaying;
  const isAudioPlaying = audioContext.currentTrack !== null && !hasVideo;
  
  // Use video context if video is active, otherwise use audio context
  // For video tracks, don't set a url since it's not an audio track
  const currentTrack = hasVideo 
    ? {
        title: videoContext.currentVideo?.title || '',
        artist: videoContext.currentVideo?.artist || videoContext.currentAlbum || '',
        image: videoContext.currentVideo?.image || videoContext.currentVideo?.imageUrl,
        url: '', // Don't set url for video tracks - they're not audio tracks
        album: videoContext.currentAlbum || ''
      }
    : audioContext.currentTrack;
  
  const currentAlbum = hasVideo 
    ? videoContext.currentAlbum 
    : audioContext.currentAlbum;
  
  const isPlaying = hasVideo 
    ? videoContext.isPlaying 
    : audioContext.isPlaying;
  
  const currentTime = hasVideo 
    ? videoContext.currentTime 
    : audioContext.currentTime;
  
  const duration = hasVideo 
    ? videoContext.duration 
    : audioContext.duration;
  
  const volume = hasVideo 
    ? videoContext.volume 
    : audioContext.volume;
  
  const pause = hasVideo 
    ? videoContext.pause 
    : audioContext.pause;
  
  const resume = hasVideo 
    ? videoContext.resume 
    : audioContext.resume;
  
  const seekTo = hasVideo 
    ? videoContext.seekTo 
    : audioContext.seekTo;
  
  const setVolume = hasVideo 
    ? videoContext.setVolume 
    : audioContext.setVolume;
  
  // Audio-only controls
  const isShuffling = audioContext.isShuffling;
  const isRepeating = audioContext.isRepeating;
  const isNowPlayingOpen = audioContext.isNowPlayingOpen;
  const openNowPlaying = audioContext.openNowPlaying;
  const closeNowPlaying = audioContext.closeNowPlaying;
  const nextTrack = hasVideo 
    ? videoContext.nextVideo 
    : audioContext.nextTrack;
  const previousTrack = hasVideo 
    ? videoContext.previousVideo 
    : audioContext.previousTrack;
  const toggleShuffle = audioContext.toggleShuffle;
  const toggleRepeat = audioContext.toggleRepeat;

  // Add swipe gestures for mobile
  const swipeRef = useSwipeGestures({
    onSwipeLeft: nextTrack,
    onSwipeRight: previousTrack,
    onSwipeUp: () => {
      // Swipe up to toggle shuffle
      toggleShuffle();
    },
    onSwipeDown: () => {
      // Swipe down to toggle repeat
      toggleRepeat();
    },
    threshold: 30,
    velocityThreshold: 0.2
  });

  // Show bar if either audio or video is active
  // For video, we need to check if there's actually a video set with a valid URL
  if (!currentTrack && !hasVideo) return null;
  
  // If video is active but track object is invalid, don't show bar
  if (hasVideo && (!videoContext.currentVideo || !videoContext.currentVideo.videoUrl)) {
    return null;
  }

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    const target = e.target as HTMLInputElement;
    const newTime = parseFloat(target.value);
    seekTo(newTime);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
  };

  // Video skip functions
  const skipVideoForward = () => {
    if (hasVideo && seekTo) {
      const newTime = Math.min(duration || 0, (currentTime || 0) + 30);
      seekTo(newTime);
    }
  };

  const skipVideoBackward = () => {
    if (hasVideo && seekTo) {
      const newTime = Math.max(0, (currentTime || 0) - 10);
      seekTo(newTime);
    }
  };

  return (
    <>
      <NowPlayingScreen 
        isOpen={isNowPlayingOpen} 
        onClose={closeNowPlaying} 
      />
      
      <div 
        ref={swipeRef}
        className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-sm border-t border-white/10 p-4 z-50 touch-pan-y"
      >
      <div className="max-w-7xl mx-auto">
        {/* Mobile Layout */}
        <div className="block sm:hidden">
          {/* Main controls row */}
          <div className="flex items-center gap-3 mb-3">
            {/* Track Info - Clickable to open full screen */}
            <div 
              className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
              onClick={openNowPlaying}
            >
              {currentTrack?.image && (
                <div className="w-10 h-10 relative overflow-hidden rounded border border-white/20">
                  <Image
                    src={currentTrack.image}
                    alt={currentTrack.title || ''}
                    fill
                    className="object-cover"
                    sizes="40px"
                  />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-semibold text-white truncate">
                  {currentTrack?.title || ''}
                </h4>
                <p className="text-xs text-gray-400 truncate">
                  {currentTrack?.artist || 'Unknown Artist'}
                </p>
              </div>
            </div>

            {/* Main controls */}
            <div className="flex items-center gap-1">
              {hasVideo ? (
                // Video skip buttons (mobile)
                <>
                  <button
                    onClick={skipVideoBackward}
                    className="p-2 text-gray-400 hover:text-white transition-colors"
                    title="Skip backward 10 seconds"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                    </svg>
                  </button>

                  <button
                    onClick={isPlaying ? pause : resume}
                    className="p-2 bg-white text-black rounded-full hover:bg-gray-200 transition-colors"
                    title={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    )}
                  </button>

                  <button
                    onClick={skipVideoForward}
                    className="p-2 text-gray-400 hover:text-white transition-colors"
                    title="Skip forward 30 seconds"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/>
                    </svg>
                  </button>
                </>
              ) : (
                // Audio track skip buttons (mobile)
                <>
                  <button
                    onClick={previousTrack}
                    className="p-2 text-gray-400 hover:text-white transition-colors"
                    title="Previous track"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                    </svg>
                  </button>

                  <button
                    onClick={isPlaying ? pause : resume}
                    className="p-2 bg-white text-black rounded-full hover:bg-gray-200 transition-colors"
                    title={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    )}
                  </button>

                  <button
                    onClick={nextTrack}
                    className="p-2 text-gray-400 hover:text-white transition-colors"
                    title="Next track"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                    </svg>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-gray-400 w-8 text-right">
              {formatTime(currentTime)}
            </span>
            <div className="flex-1">
              <input
                type="range"
                min="0"
                max={duration || 0}
                value={currentTime}
                onChange={handleSeek}
                onInput={handleSeek}
                onTouchEnd={handleSeek}
                className="w-full h-2 sm:h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer slider touch-manipulation"
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(currentTime / (duration || 1)) * 100}%, #374151 ${(currentTime / (duration || 1)) * 100}%, #374151 100%)`,
                  WebkitTapHighlightColor: 'transparent'
                }}
              />
            </div>
            <span className="text-xs text-gray-400 w-8">
              {formatTime(duration)}
            </span>
          </div>

          {/* Secondary controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={toggleShuffle}
                className={`p-1 transition-colors ${
                  isShuffling ? 'text-blue-400' : 'text-gray-400'
                }`}
                title="Toggle shuffle"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                </svg>
              </button>

              <button
                onClick={toggleRepeat}
                className={`p-1 transition-colors ${
                  isRepeating ? 'text-blue-400' : 'text-gray-400'
                }`}
                title="Toggle repeat"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
                </svg>
              </button>
            </div>

            {/* Volume control - hide for video */}
            {!hasVideo && (
              <div className="flex items-center gap-1">
                <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                </svg>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={handleVolumeChange}
                  className="w-16 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                  style={{
                    background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${volume * 100}%, #374151 ${volume * 100}%, #374151 100%)`
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Desktop Layout */}
        <div className="hidden sm:flex items-center gap-4">
          {/* Track Info - Clickable to open full screen */}
          <div 
            className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
            onClick={openNowPlaying}
          >
            {currentTrack?.image && (
              <div className="w-12 h-12 relative overflow-hidden rounded border border-white/20">
                <Image
                  src={currentTrack.image}
                  alt={currentTrack.title || ''}
                  fill
                  className="object-cover"
                  sizes="48px"
                />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-white truncate">
                {currentTrack?.title || ''}
              </h4>
              <p className="text-xs text-gray-400 truncate">
                {currentTrack?.artist || 'Unknown Artist'}
                {currentAlbum && ` • ${currentAlbum}`}
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleShuffle}
              className={`p-2 transition-colors ${
                isShuffling ? 'text-blue-400' : 'text-gray-400 hover:text-white'
              }`}
              title="Toggle shuffle"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
              </svg>
            </button>

            {hasVideo ? (
              // Video skip buttons
              <>
                <button
                  onClick={skipVideoBackward}
                  className="p-2 text-gray-400 hover:text-white transition-colors"
                  title="Skip backward 10 seconds"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                  </svg>
                </button>

                <button
                  onClick={isPlaying ? pause : resume}
                  className="p-3 bg-white text-black rounded-full hover:bg-gray-200 transition-colors"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  )}
                </button>

                <button
                  onClick={skipVideoForward}
                  className="p-2 text-gray-400 hover:text-white transition-colors"
                  title="Skip forward 30 seconds"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/>
                  </svg>
                </button>
              </>
            ) : (
              // Audio track skip buttons
              <>
                <button
                  onClick={previousTrack}
                  className="p-2 text-gray-400 hover:text-white transition-colors"
                  title="Previous track"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                  </svg>
                </button>

                <button
                  onClick={isPlaying ? pause : resume}
                  className="p-3 bg-white text-black rounded-full hover:bg-gray-200 transition-colors"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  )}
                </button>

                <button
                  onClick={nextTrack}
                  className="p-2 text-gray-400 hover:text-white transition-colors"
                  title="Next track"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                  </svg>
                </button>
              </>
            )}

            <button
              onClick={toggleRepeat}
              className={`p-2 transition-colors ${
                isRepeating ? 'text-blue-400' : 'text-gray-400 hover:text-white'
              }`}
              title="Toggle repeat"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
              </svg>
            </button>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-xs text-gray-400 w-10 text-right">
              {formatTime(currentTime)}
            </span>
            <div className="flex-1 min-w-0">
              <input
                type="range"
                min="0"
                max={duration || 0}
                value={currentTime}
                onChange={handleSeek}
                onInput={handleSeek}
                onTouchEnd={handleSeek}
                className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer slider touch-manipulation"
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(currentTime / (duration || 1)) * 100}%, #374151 ${(currentTime / (duration || 1)) * 100}%, #374151 100%)`,
                  WebkitTapHighlightColor: 'transparent'
                }}
              />
            </div>
            <span className="text-xs text-gray-400 w-10">
              {formatTime(duration)}
            </span>
          </div>

          {/* Volume - hide for video */}
          {!hasVideo && (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={handleVolumeChange}
                className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${volume * 100}%, #374151 ${volume * 100}%, #374151 100%)`
                }}
              />
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 12px;
          width: 12px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid #ffffff;
          box-shadow: 0 0 0 1px rgba(0,0,0,0.1);
        }
        .slider::-moz-range-thumb {
          height: 12px;
          width: 12px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid #ffffff;
          box-shadow: 0 0 0 1px rgba(0,0,0,0.1);
        }
      `}</style>
      </div>
    </>
  );
});

export default GlobalNowPlayingBar;