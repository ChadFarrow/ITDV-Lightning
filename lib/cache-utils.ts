export const CACHE_KEYS = {
  ALBUMS: 'cachedAlbums',
  ALBUMS_TIMESTAMP: 'albumsCacheTimestamp',
  CRITICAL_ALBUMS: 'cachedCriticalAlbums',
  CRITICAL_TIMESTAMP: 'criticalAlbumsCacheTimestamp',
} as const;

export const CACHE_DURATION = {
  SHORT: 5 * 60 * 1000,  // 5 minutes
  MEDIUM: 10 * 60 * 1000, // 10 minutes
  LONG: 30 * 60 * 1000,   // 30 minutes
  DAY: 24 * 60 * 60 * 1000, // 1 day
} as const;

export interface CacheOptions {
  key: string;
  duration?: number;
}

export function getCachedData<T>(key: string, maxAge: number = CACHE_DURATION.MEDIUM): T | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const cached = localStorage.getItem(key);
    const timestamp = localStorage.getItem(`${key}_timestamp`);
    
    if (!cached || !timestamp) return null;
    
    const age = Date.now() - parseInt(timestamp);
    if (age > maxAge) return null;
    
    return JSON.parse(cached);
  } catch (error) {
    console.warn(`Failed to read cache for ${key}:`, error);
    return null;
  }
}

export function setCachedData<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(`${key}_timestamp`, Date.now().toString());
  } catch (error) {
    console.warn(`Failed to cache data for ${key}:`, error);
    // Clear cache if storage is full
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      clearExpiredCache();
      // Try again
      try {
        localStorage.setItem(key, JSON.stringify(data));
        localStorage.setItem(`${key}_timestamp`, Date.now().toString());
      } catch {
        // Give up
      }
    }
  }
}

export function clearExpiredCache(): void {
  if (typeof window === 'undefined') return;
  
  const keys = Object.keys(localStorage);
  const now = Date.now();
  
  keys.forEach(key => {
    if (key.endsWith('_timestamp')) {
      const timestamp = parseInt(localStorage.getItem(key) || '0');
      if (now - timestamp > CACHE_DURATION.DAY) {
        const dataKey = key.replace('_timestamp', '');
        localStorage.removeItem(dataKey);
        localStorage.removeItem(key);
      }
    }
  });
}

export function preloadStaticAssets(): void {
  if (typeof window === 'undefined') return;
  
  // Preload critical images
  const criticalImages = [
    '/bloodshot-lies-big.png',
    '/HPM-lightning-logo.jpg',
  ];
  
  criticalImages.forEach(src => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = src;
    document.head.appendChild(link);
  });
}