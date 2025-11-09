import { useState, useEffect } from 'react';
import { logger } from '../logger';
import { getConnectionQuality, isSlowConnection, type ConnectionQuality } from '../video-utils';

interface DeviceInfo {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
  height: number;
  userAgent: string;
  platform: string;
  vendor: string;
  connectionType?: string;
  connectionQuality?: ConnectionQuality;
  isSlowConnection?: boolean;
}

interface UseDeviceDetectionOptions {
  mobileBreakpoint?: number;
  tabletBreakpoint?: number;
  logDeviceInfo?: boolean;
}

export function useDeviceDetection(options: UseDeviceDetectionOptions = {}) {
  const {
    mobileBreakpoint = 768,
    tabletBreakpoint = 1024,
    logDeviceInfo = false
  } = options;

  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    width: 0,
    height: 0,
    userAgent: '',
    platform: '',
    vendor: ''
  });

  const [isClient, setIsClient] = useState(false);
  
  const log = logger.component('useDeviceDetection');

  useEffect(() => {
    setIsClient(true);
    
    const checkDevice = () => {
      if (typeof window === 'undefined') return;

      const width = window.innerWidth;
      const height = window.innerHeight;
      const ua = navigator.userAgent;
      const platform = navigator.platform;
      const vendor = navigator.vendor;
      const connection = (navigator as any).connection?.effectiveType || 'unknown';
      const connectionQuality = getConnectionQuality();
      const isSlow = isSlowConnection(connectionQuality);

      const isMobile = width <= mobileBreakpoint;
      const isTablet = width > mobileBreakpoint && width <= tabletBreakpoint;
      const isDesktop = width > tabletBreakpoint;

      const newDeviceInfo: DeviceInfo = {
        isMobile,
        isTablet,
        isDesktop,
        width,
        height,
        userAgent: ua,
        platform,
        vendor,
        connectionType: connection,
        connectionQuality,
        isSlowConnection: isSlow
      };

      setDeviceInfo(newDeviceInfo);

      // Log device info if requested
      if (logDeviceInfo && isMobile) {
        log.debug('Device detected:', {
          width,
          userAgent: ua.substring(0, 100),
          platform,
          vendor,
          connection,
          connectionQuality,
          isSlowConnection: isSlow
        });
      }
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    
    // Listen for connection changes
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (connection) {
      connection.addEventListener('change', checkDevice);
    }
    
    return () => {
      window.removeEventListener('resize', checkDevice);
      if (connection) {
        connection.removeEventListener('change', checkDevice);
      }
    };
  }, [mobileBreakpoint, tabletBreakpoint, logDeviceInfo, log]);

  return {
    ...deviceInfo,
    isClient
  };
} 