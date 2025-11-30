'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, memo } from 'react';

interface Publisher {
  name: string;
  feedGuid: string;
  feedUrl: string;
  medium: string;
  albumCount: number;
  latestAlbum?: {
    title: string;
    coverArt: string;
    releaseDate: string;
  };
}

interface PublisherCardProps {
  publisher: Publisher;
}

const PublisherCard = memo(function PublisherCard({ publisher }: PublisherCardProps) {
  const [imageError, setImageError] = useState(false);
  
  const publisherSlug = publisher.name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return (
    <Link
      href={`/publisher/${encodeURIComponent(publisherSlug)}`}
      className="group bg-white/5 backdrop-blur-sm rounded-xl p-4 hover:bg-white/10 transition-all duration-300 border border-white/10 hover:border-white/20 block"
    >
      <div className="flex items-center gap-4">
        {/* Publisher Avatar/Latest Album Cover */}
        <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-gray-800">
          {publisher.latestAlbum?.coverArt && !imageError ? (
            <Image
              src={publisher.latestAlbum.coverArt}
              alt={publisher.name}
              width={64}
              height={64}
              className="w-full h-full object-cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="w-full h-full bg-gray-800 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
              </svg>
            </div>
          )}
        </div>
        
        {/* Publisher Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg group-hover:text-blue-400 transition-colors truncate">
            {publisher.name}
          </h3>
          <div className="flex items-center gap-3 text-sm text-gray-400 mt-1">
            <span>{publisher.albumCount} release{publisher.albumCount !== 1 ? 's' : ''}</span>
            {publisher.medium === 'music' && (
              <span className="px-2 py-1 bg-white/10 rounded text-xs">
                Music
              </span>
            )}
          </div>
          {publisher.latestAlbum && (
            <p className="text-xs text-gray-500 mt-1 truncate">
              Latest: {publisher.latestAlbum.title}
            </p>
          )}
        </div>

        {/* Arrow Icon */}
        <div className="flex-shrink-0 text-gray-400 group-hover:text-white group-hover:translate-x-1 transition-all">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
});

export default PublisherCard;