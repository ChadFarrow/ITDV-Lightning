'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { useAudio } from './AudioContext';
import { type ConnectionQuality } from '@/lib/video-utils';

interface VideoTrack {
  title: string;
  duration: string;
  videoUrl: string;
  trackNumber: number;
  image?: string;
  artist?: string;
  album?: string;
  startTime?: number; // Chapter/segment start time
  endTime?: number; // Chapter/segment end time
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
  guid?: string;
  podcastGuid?: string;
  feedGuid?: string;
  feedUrl?: string;
  publisherGuid?: string;
  publisherUrl?: string;
  imageUrl?: string;
}

interface VideoContextType {
  // Current video info
  currentVideo: VideoTrack | null;
  currentAlbum: string | null;
  
  // Playback state
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  seekRequest: number | null; // Explicit seek request (chapter-relative if playing chapter)
  
  // Connection and quality state
  connectionQuality: ConnectionQuality;
  currentQualityLevel: number; // Current HLS quality level (-1 for auto)
  
  // Playlist
  playlist: VideoTrack[];
  currentVideoIndex: number;
  
  // Actions
  playVideo: (video: VideoTrack, album?: string) => void;
  playVideoList: (videos: VideoTrack[], startIndex?: number, album?: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  nextVideo: () => void;
  previousVideo: () => void;
  seekTo: (time: number) => void;
  updateCurrentTime: (time: number) => void; // Update current time from VideoPlayer
  updateDuration: (duration: number) => void; // Update duration from VideoPlayer
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  updateConnectionQuality: (quality: ConnectionQuality) => void; // Update connection quality
  updateQualityLevel: (level: number) => void; // Update current quality level
}

const VideoContext = createContext<VideoContextType | undefined>(undefined);

export const useVideo = () => {
  const context = useContext(VideoContext);
  if (!context) {
    throw new Error('useVideo must be used within a VideoProvider');
  }
  return context;
};

export const VideoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentVideo, setCurrentVideo] = useState<VideoTrack | null>(null);
  const [currentAlbum, setCurrentAlbum] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playlist, setPlaylist] = useState<VideoTrack[]>([]);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [seekRequest, setSeekRequest] = useState<number | null>(null);
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>('unknown');
  const [currentQualityLevel, setCurrentQualityLevel] = useState<number>(-1);
  
  // Get audio context to coordinate playback
  const { pause: pauseAudio } = useAudio();

  const playVideo = useCallback((video: VideoTrack, album?: string) => {
    // Pause audio when video starts
    pauseAudio();

    setCurrentVideo(video);
    setCurrentAlbum(album || null);
    setPlaylist([video]);
    setCurrentVideoIndex(0);
    setIsPlaying(true);
  }, [pauseAudio]);

  const playVideoList = useCallback((videos: VideoTrack[], startIndex = 0, album?: string) => {
    if (videos.length === 0) return;

    // Pause audio when video starts
    pauseAudio();

    const video = videos[startIndex];
    setCurrentVideo(video);
    setCurrentAlbum(album || null);
    setPlaylist(videos);
    setCurrentVideoIndex(startIndex);
    setIsPlaying(true);
  }, [pauseAudio]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const resume = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const stop = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setCurrentVideo(null);
  }, []);

  const nextVideo = useCallback(() => {
    if (playlist.length === 0) return;

    const nextIndex = currentVideoIndex + 1;
    if (nextIndex >= playlist.length) {
      return; // No more videos
    }

    const nextVideo = playlist[nextIndex];
    setCurrentVideo(nextVideo);
    setCurrentVideoIndex(nextIndex);
  }, [playlist, currentVideoIndex]);

  const previousVideo = useCallback(() => {
    if (playlist.length === 0) return;

    const prevIndex = currentVideoIndex - 1;
    if (prevIndex < 0) {
      return; // No previous video
    }

    const prevVideo = playlist[prevIndex];
    setCurrentVideo(prevVideo);
    setCurrentVideoIndex(prevIndex);
  }, [playlist, currentVideoIndex]);

  const seekTo = useCallback((time: number) => {
    setCurrentTime(time);
    setSeekRequest(time); // Set seek request to trigger video seek
  }, []);

  // Update current time (called from VideoPlayer)
  const updateCurrentTime = useCallback((time: number) => {
    setCurrentTime(time);
    // Clear seek request after time update to avoid feedback loops
    setSeekRequest(null);
  }, []);

  // Update duration (called from VideoPlayer)
  const updateDuration = useCallback((dur: number) => {
    setDuration(dur);
  }, []);

  const setVolume = useCallback((newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clampedVolume);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted(!isMuted);
  }, [isMuted]);

  const updateConnectionQuality = useCallback((quality: ConnectionQuality) => {
    setConnectionQuality(quality);
  }, []);

  const updateQualityLevel = useCallback((level: number) => {
    setCurrentQualityLevel(level);
  }, []);

  const value: VideoContextType = {
    currentVideo,
    currentAlbum,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    seekRequest,
    connectionQuality,
    currentQualityLevel,
    playlist,
    currentVideoIndex,
    playVideo,
    playVideoList,
    pause,
    resume,
    stop,
    nextVideo,
    previousVideo,
    seekTo,
    updateCurrentTime,
    updateDuration,
    setVolume,
    toggleMute,
    updateConnectionQuality,
    updateQualityLevel,
  };

  return (
    <VideoContext.Provider value={value}>
      {children}
    </VideoContext.Provider>
  );
};

