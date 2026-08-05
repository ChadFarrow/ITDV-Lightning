'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft } from 'lucide-react';
import { useAudio } from '@/contexts/AudioContext';
import { getDisplayYear, type AlbumDateInfo } from '@/lib/album-date';

interface Track {
  title: string;
  duration: string;
  url: string;
  trackNumber: number;
  image?: string;
}

interface Album {
  title: string;
  artist: string;
  description: string;
  coverArt: string;
  tracks: Track[];
  releaseDate: string;
  originalRelease?: AlbumDateInfo;
  feedId: string;
  feedUrl?: string;
  funding?: any[];
  podroll?: any[];
  publisher?: {
    feedGuid: string;
    feedUrl: string;
    medium: string;
  };
}

interface Publisher {
  name: string;
  guid: string;
  feedUrl: string;
  medium: string;
  albums: Album[];
}

interface PublisherDetailClientProps {
  publisherName: string;
  initialPublisher: Publisher | null;
}

export default function PublisherDetailClient({ publisherName, initialPublisher }: PublisherDetailClientProps) {
  const [publisher, setPublisher] = useState<Publisher | null>(initialPublisher);
  const [publisherArtwork, setPublisherArtwork] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!initialPublisher);
  const [error, setError] = useState<string | null>(null);
  const { playAlbum } = useAudio();

  const loadPublisherArtwork = useCallback(async () => {
    try {
      const response = await fetch('/publishers.json');
      if (response.ok) {
        const publishers = await response.json();
        const decodedName = decodeURIComponent(publisherName);
        const currentPublisher = publishers.find((pub: any) => 
          pub.name.toLowerCase() === decodedName.toLowerCase() ||
          pub.name.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') === 
          decodedName.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
        );
        
        if (currentPublisher?.latestAlbum?.coverArt) {
          setPublisherArtwork(currentPublisher.latestAlbum.coverArt);
        }
      }
    } catch (error) {
      console.warn('Could not load artist artwork:', error);
    }
  }, [publisherName]);

  const loadPublisher = useCallback(async () => {
    try {
      setIsLoading(true);
      // Use static cached endpoint for fast loading
      const response = await fetch('/api/albums-static-cached');
      
      if (!response.ok) {
        throw new Error('Failed to load albums');
      }

      const data = await response.json();
      const albums = data.albums || [];
      
      // Create slug for matching
      const createSlug = (name: string) => 
        name.toLowerCase()
          .replace(/[^\w\s-]/g, '') // Remove punctuation except spaces and hyphens
          .replace(/\s+/g, '-')     // Replace spaces with hyphens
          .replace(/-+/g, '-')      // Collapse multiple hyphens
          .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
      
      const decodedName = decodeURIComponent(publisherName);
      const nameSlug = createSlug(decodedName);
      
      // Find albums by this publisher
      const publisherAlbums = albums.filter((album: Album) => {
        // Match by artist name (since publishers are usually artists)
        const artistSlug = createSlug(album.artist);
        const artistLower = album.artist.toLowerCase();
        const decodedLower = decodedName.toLowerCase();
        
        // Exact match or slug match, but exclude if this artist is just featured
        if (artistSlug === nameSlug || artistLower === decodedLower) {
          return true;
        }
        
        // Don't include albums where this artist is just featured (contains "feat." or "featuring")
        return false;
      });

      if (publisherAlbums.length > 0) {
        const firstAlbum = publisherAlbums[0];
        // Find an album with publisher data, or use defaults
        const albumWithPublisher = publisherAlbums.find((album: Album) => album.publisher) || firstAlbum;
        const publisherInfo: Publisher = {
          name: firstAlbum.artist,
          guid: albumWithPublisher.publisher?.feedGuid || 'no-guid',
          feedUrl: albumWithPublisher.publisher?.feedUrl || '',
          medium: albumWithPublisher.publisher?.medium || 'music',
          albums: publisherAlbums
        };
        
        setPublisher(publisherInfo);
        setError(null);
      } else {
        setError('Artist not found');
      }
    } catch (err) {
      console.error('Error loading artist:', err);
      setError('Failed to load artist');
    } finally {
      setIsLoading(false);
    }
  }, [publisherName]);

  // Declared after both loaders on purpose: naming them in the dependency array
  // evaluates at render time, so with the effect above their `const`
  // declarations this would throw a TDZ ReferenceError. Both are
  // useCallback([publisherName]), so they only change when publisherName does —
  // which is already a dependency here, meaning this still runs once per
  // publisher rather than on every render.
  useEffect(() => {
    if (!initialPublisher) {
      loadPublisher();
    }
    loadPublisherArtwork();
  }, [initialPublisher, loadPublisher, loadPublisherArtwork]);

  const getAlbumSlug = (album: Album) => {
    return album.title
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const getReleaseYear = (album: Album) => getDisplayYear(album);

  const handlePlayAlbum = (album: Album, e: React.MouseEvent) => {
    e.preventDefault(); // Prevent navigation when clicking play button
    e.stopPropagation();
    
    // Map album tracks to the expected format
    const tracks = album.tracks.map(track => ({
      ...track,
      artist: album.artist,
      album: album.title,
      image: track.image || album.coverArt
    }));
    
    playAlbum(tracks, 0, album.title);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-white"></div>
      </div>
    );
  }

  if (error || !publisher) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
        <h1 className="text-2xl font-semibold mb-4">{error || 'Artist not found'}</h1>
        <Link 
          href="/"
          className="text-blue-400 hover:text-blue-300 transition-colors"
        >
          ← Back to albums
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white relative overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 z-0">
        {/* Use artist artwork as background */}
        {(publisherArtwork || publisher.albums[0]?.coverArt) && (
          <Image
            src={publisherArtwork || publisher.albums[0].coverArt}
            alt={`${publisher.name} background`}
            fill
            className="object-cover w-full h-full"
            priority
          />
        )}
        
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900/95 via-black/90 to-gray-900/95"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/60"></div>
      </div>

      {/* Content */}
      <div className="relative z-10">
        {/* Header */}
        <header className="bg-black/20 backdrop-blur-sm border-b border-white/10 sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link
                  href="/"
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors group"
                  title="Back to albums"
                >
                  <ArrowLeft className="w-5 h-5 group-hover:scale-110 transition-transform" />
                </Link>
                
                <div className="hidden sm:flex items-center gap-2 text-sm">
                  <Link href="/" className="text-gray-400 hover:text-white transition-colors">
                    Into the Doerfel-Verse
                  </Link>
                  <span className="text-gray-600">/</span>
                  <span className="font-medium truncate max-w-[200px]">{publisher.name}</span>
                </div>
              </div>

              {/* Desktop Info */}
              <div className="hidden sm:block text-xs text-gray-400">
                {publisher.albums.length} albums
              </div>
            </div>
          </div>
        </header>

        {/* Artist Hero Section */}
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="flex flex-col lg:flex-row gap-8 items-start">
              {/* Artist Artwork */}
              <div className="flex-shrink-0 mx-auto lg:mx-0">
                <div className="w-64 h-64 lg:w-80 lg:h-80 relative rounded-xl shadow-2xl overflow-hidden border border-white/20">
                  <Image
                    src={publisherArtwork || publisher.albums[0]?.coverArt || '/placeholder-episode.jpg'}
                    alt={publisher.name}
                    fill
                    className="object-cover"
                    priority
                    sizes="(min-width: 1024px) 320px, 256px"
                  />
                </div>
              </div>

              {/* Artist Info */}
              <div className="flex-1 text-center lg:text-left">
                <div className="mb-6">
                  <h1 className="text-4xl lg:text-5xl font-bold mb-2 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    {publisher.name}
                  </h1>
                  <p className="text-xl lg:text-2xl text-gray-300 mb-4">Artist</p>
                  
                  <div className="flex items-center justify-center lg:justify-start gap-4 text-sm text-gray-400 mb-6">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                      {publisher.albums.length} albums
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w2 h-2 bg-green-400 rounded-full"></span>
                      {publisher.medium}
                    </span>
                  </div>

                  <div className="max-w-2xl mx-auto lg:mx-0 mb-6">
                    <p className="text-gray-300 leading-relaxed">
                      All albums by {publisher.name}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Albums Grid */}
        <div className="container mx-auto px-4 pb-8">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold mb-6">Albums</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {publisher.albums.map((album, index) => (
                <div
                  key={`${album.feedId}-${index}`}
                  className="group relative"
                >
                  <Link
                    href={`/album/${getAlbumSlug(album)}`}
                    className="block"
                  >
                    <div className="bg-white/5 backdrop-blur-sm rounded-lg p-4 hover:bg-white/10 transition-colors border border-white/10">
                      <div className="aspect-square mb-3 rounded overflow-hidden relative">
                        <Image
                          src={album.coverArt}
                          alt={album.title}
                          width={200}
                          height={200}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        
                        {/* Play Button Overlay */}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button
                            onClick={(e) => handlePlayAlbum(album, e)}
                            className="p-3 bg-white text-black rounded-full hover:scale-110 transition-transform shadow-lg"
                            title={`Play ${album.title}`}
                          >
                            <svg className="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                      <h3 className="font-semibold text-sm mb-1 truncate group-hover:text-blue-400 transition-colors">
                        {album.title}
                      </h3>
                      <p className="text-xs text-gray-400 truncate">{album.artist}</p>
                      {getReleaseYear(album) && (
                        <p className="text-xs text-gray-500 mt-1">{getReleaseYear(album)}</p>
                      )}
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom spacing for audio player */}
        <div className="h-24" />
      </div>
    </div>
  );
}