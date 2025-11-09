// Mobile video optimization utilities

export type ConnectionQuality = 'slow-2g' | '2g' | '3g' | '4g' | 'wifi' | 'unknown';

export interface VideoOptimizationConfig {
  isMobile: boolean;
  connectionQuality: ConnectionQuality;
  isSlowConnection: boolean;
}

export interface HLSConfig {
  enableWorker: boolean;
  lowLatencyMode: boolean;
  backBufferLength: number;
  maxBufferLength: number;
  maxMaxBufferLength: number;
  capLevelToPlayerSize: boolean;
  startLevel: number;
  abrEwmaDefaultEstimate: number;
  levelLoadingTimeOut: number;
  manifestLoadingTimeOut: number;
}

/**
 * Detect connection quality from Network Information API
 */
export function getConnectionQuality(): ConnectionQuality {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'unknown';
  }

  const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  
  if (!connection) {
    return 'unknown';
  }

  const effectiveType = connection.effectiveType || 'unknown';
  const type = connection.type || 'unknown';
  
  // Check if on WiFi
  if (type === 'wifi' || effectiveType === '4g') {
    // Additional check: if downlink is high, likely WiFi
    const downlink = connection.downlink || 0;
    if (downlink > 10) {
      return 'wifi';
    }
    return '4g';
  }

  // Map effectiveType to our ConnectionQuality type
  switch (effectiveType) {
    case 'slow-2g':
      return 'slow-2g';
    case '2g':
      return '2g';
    case '3g':
      return '3g';
    case '4g':
      return '4g';
    default:
      return 'unknown';
  }
}

/**
 * Check if connection is slow
 */
export function isSlowConnection(connectionQuality: ConnectionQuality): boolean {
  return connectionQuality === 'slow-2g' || connectionQuality === '2g' || connectionQuality === '3g';
}

/**
 * Get optimal HLS.js configuration based on device and connection
 */
export function getOptimalHLSConfig(
  isMobile: boolean,
  connectionQuality: ConnectionQuality,
  startTime?: number
): Partial<HLSConfig> {
  const isSlow = isSlowConnection(connectionQuality);
  
  // Base configuration
  const baseConfig: Partial<HLSConfig> = {
    enableWorker: true,
    lowLatencyMode: false,
  };

  if (isMobile) {
    // Mobile-optimized settings
    if (isSlow) {
      // Slow connection (2G, 3G, slow-2G)
      return {
        ...baseConfig,
        backBufferLength: 30,
        maxBufferLength: 10,
        maxMaxBufferLength: 60,
        capLevelToPlayerSize: true,
        startLevel: -1, // Let HLS.js choose, but it will prefer lower quality
        abrEwmaDefaultEstimate: 500000, // Lower estimate for slow connections (500 kbps)
        levelLoadingTimeOut: 5000, // Shorter timeout for slow connections
        manifestLoadingTimeOut: 5000,
      };
    } else {
      // Fast mobile connection (4G, WiFi)
      return {
        ...baseConfig,
        backBufferLength: 60,
        maxBufferLength: 20,
        maxMaxBufferLength: 120,
        capLevelToPlayerSize: true, // Match video size to player on mobile
        startLevel: -1, // Let HLS.js choose
        abrEwmaDefaultEstimate: 2000000, // Higher estimate for fast connections (2 Mbps)
        levelLoadingTimeOut: 10000,
        manifestLoadingTimeOut: 10000,
      };
    }
  } else {
    // Desktop settings
    if (isSlow) {
      // Slow connection on desktop
      return {
        ...baseConfig,
        backBufferLength: 60,
        maxBufferLength: 15,
        maxMaxBufferLength: 120,
        capLevelToPlayerSize: false,
        startLevel: -1,
        abrEwmaDefaultEstimate: 1000000, // 1 Mbps for slow desktop
        levelLoadingTimeOut: 8000,
        manifestLoadingTimeOut: 8000,
      };
    } else {
      // Fast desktop connection
      return {
        ...baseConfig,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 600,
        capLevelToPlayerSize: false,
        startLevel: -1,
        abrEwmaDefaultEstimate: 5000000, // 5 Mbps for fast desktop
        levelLoadingTimeOut: 10000,
        manifestLoadingTimeOut: 10000,
      };
    }
  }
}

/**
 * Get initial quality level based on connection
 */
export function getInitialQualityLevel(
  connectionQuality: ConnectionQuality,
  availableLevels: number
): number {
  // Return -1 to let HLS.js auto-select, but we can influence it
  // by setting startLevel in the config
  if (connectionQuality === 'slow-2g' || connectionQuality === '2g') {
    // Start with lowest quality
    return 0;
  } else if (connectionQuality === '3g') {
    // Start with low-medium quality
    return Math.max(0, Math.floor(availableLevels * 0.3));
  } else {
    // Let HLS.js auto-select for 4G/WiFi
    return -1;
  }
}

/**
 * Create connection change listener
 */
export function createConnectionChangeListener(
  callback: (quality: ConnectionQuality) => void
): (() => void) | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return null;
  }

  const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  
  if (!connection) {
    return null;
  }

  const handleChange = () => {
    const quality = getConnectionQuality();
    callback(quality);
  };

  // Listen for connection changes
  connection.addEventListener('change', handleChange);

  // Return cleanup function
  return () => {
    connection.removeEventListener('change', handleChange);
  };
}

/**
 * Get video optimization config for current device
 */
export function getVideoOptimizationConfig(
  isMobile: boolean,
  connectionType?: string
): VideoOptimizationConfig {
  const connectionQuality = connectionType && connectionType !== 'unknown' 
    ? (connectionType as ConnectionQuality)
    : getConnectionQuality();
  
  return {
    isMobile,
    connectionQuality,
    isSlowConnection: isSlowConnection(connectionQuality),
  };
}

