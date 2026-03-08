'use client';

import { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react';
import { useLightning } from './LightningContext';
import { safeLocalStorage } from '@/lib/safe-storage';

interface BitcoinConnectContextType {
  isConnected: boolean;
  isInitializing: boolean;
  setIsConnected: (connected: boolean) => void;
  checkConnection: () => void;
}

const BitcoinConnectContext = createContext<BitcoinConnectContextType | undefined>(undefined);

export function BitcoinConnectProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const { isLightningEnabled } = useLightning();
  const lastCheckRef = useRef<number>(0);
  const checkInProgressRef = useRef<boolean>(false);

  const checkConnection = async () => {
    try {
      // Don't check connections if Lightning is disabled
      if (!isLightningEnabled) {
        setIsConnected(false);
        return false;
      }
      
      // Prevent concurrent checks and rate limit to once per 5 seconds
      if (checkInProgressRef.current) {
        return isConnected;
      }
      
      const now = Date.now();
      if (now - lastCheckRef.current < 5000) {
        return isConnected;
      }
      
      checkInProgressRef.current = true;
      lastCheckRef.current = now;
      // Check for WebLN (Alby, etc.)
      const weblnExists = !!(window as any).webln;
      const weblnEnabled = weblnExists && !!(window as any).webln?.enabled;
      
      // Check Bitcoin Connect state - enhanced for AlbyGo detection
      const bcConnected = safeLocalStorage.getItem('bc:connectorType');
      let bcConfig = null;
      let nwcConnected = safeLocalStorage.getItem('nwc_connection_string');

      try {
        const bcConfigRaw = safeLocalStorage.getItem('bc:config');
        if (bcConfigRaw) {
          // Clean up potential JSON formatting issues
          const cleanConfigRaw = bcConfigRaw.trim();
          if (cleanConfigRaw.startsWith('{') && cleanConfigRaw.endsWith('}')) {
            bcConfig = JSON.parse(cleanConfigRaw);
            // AlbyGo might store NWC URL in bc:config
            if (bcConfig && bcConfig.nwcUrl && !nwcConnected) {
              nwcConnected = bcConfig.nwcUrl;
            }
          } else {
            console.warn('bc:config is not valid JSON format:', bcConfigRaw);
            bcConfig = null;
          }
        }
      } catch (error) {
        console.warn('Failed to parse bc:config:', error, 'Raw value:', safeLocalStorage.getItem('bc:config'));
        bcConfig = null;
      }
      
      // Enhanced Bitcoin Connect detection - check for active connection state
      const bcConnectorConnected = !!(bcConnected || (bcConfig && (bcConfig.connectorType || bcConfig.nwcUrl)));
      
      // Additional check: if Bitcoin Connect library reports connected state
      // Check various possible Bitcoin Connect global objects
      let bcLibraryConnected = false;
      if (typeof window !== 'undefined') {
        // Check for Bitcoin Connect wallet connection indicators
        bcLibraryConnected = !!(
          (window as any).webbtc?.isConnected || 
          (window as any).bitcoin?.isConnected ||
          (window as any).bc?.connected ||
          // Check if there's an active wallet provider
          (window as any).bitcoinProvider ||
          // Check for Alby-specific indicators when connected through BC
          ((window as any).webln?.enabled && bcConfig && bcConfig.connectorType)
        );
      }
      
      // Debug: Log all Bitcoin Connect related localStorage items
      const storageKeys = safeLocalStorage.keys();
      console.log('🔍 Bitcoin Connect localStorage debug:', {
        bcConnectorType: bcConnected,
        bcConfig: bcConfig,
        nwcConnectionString: nwcConnected,
        allLocalStorageKeys: storageKeys.filter(k => k.startsWith('bc') || k.includes('nwc') || k.includes('alby')),
        allLocalStorageData: Object.fromEntries(
          storageKeys
            .filter(k => k.startsWith('bc') || k.includes('nwc') || k.includes('alby'))
            .map(k => [k, safeLocalStorage.getItem(k)])
        )
      });
      
      // Try to enable WebLN if it exists but isn't enabled
      let weblnEnabledAfter = weblnEnabled;
      if (weblnExists && !weblnEnabled) {
        try {
          await (window as any).webln.enable();
          // Wait a moment for the state to update
          await new Promise(resolve => setTimeout(resolve, 100));
          weblnEnabledAfter = !!(window as any).webln?.enabled;
          console.log('🔗 WebLN enabled successfully, new state:', weblnEnabledAfter);
        } catch (error) {
          console.log('🔗 WebLN enable failed or cancelled by user:', error);
          weblnEnabledAfter = false;
        }
      } else {
        weblnEnabledAfter = weblnEnabled;
      }
      
      // Check NWC service status without trying to import it here
      // to avoid chunk loading issues
      let nwcServiceConnected = false;
      try {
        // Only check if we have window and NWC connection
        if (typeof window !== 'undefined' && nwcConnected) {
          // Try to get the service if it's already loaded
          const nwcService = (window as any).__nwcService;
          if (nwcService && nwcService.isConnected) {
            nwcServiceConnected = nwcService.isConnected();
          }
        }
      } catch (error) {
        console.warn('NWC service check failed:', error);
        nwcServiceConnected = false;
      }
      
      // More strict WebLN checks - methods must exist AND be enabled
      const hasWeblnMethods = weblnExists && (
        typeof (window as any).webln?.makeInvoice === 'function' ||
        typeof (window as any).webln?.sendPayment === 'function' ||
        typeof (window as any).webln?.keysend === 'function'
      );
      
      // Only consider WebLN "connected" if it's actually enabled, not just if methods exist
      const finalWeblnStatus = weblnEnabledAfter && hasWeblnMethods;

      const anyConnection = finalWeblnStatus || bcConnectorConnected || bcLibraryConnected || nwcConnected || nwcServiceConnected;

      // Debug logging
      console.log('🔍 Connection check:', {
        weblnExists,
        weblnEnabled: weblnEnabledAfter, 
        hasWeblnMethods,
        finalWeblnStatus,
        bcConnected: !!bcConnected,
        bcConnectorConnected,
        bcLibraryConnected,
        nwcConnected: !!nwcConnected,
        nwcServiceConnected,
        anyConnection
      });
      
      // Only log if connection status actually changed to reduce console spam
      const currentStatus = !!anyConnection;
      if (isConnected !== currentStatus) {
        console.log('🔄 Bitcoin Connect status changed:', currentStatus ? 'connected' : 'disconnected');
      }
      
      setIsConnected(currentStatus);
      return !!anyConnection;
    } catch (error) {
      console.error('Error checking connection:', error);
      return false;
    } finally {
      checkInProgressRef.current = false;
    }
  };

  useEffect(() => {
    // Optimistic: if bc:config exists in localStorage, assume connected immediately
    const bcConfigRaw = safeLocalStorage.getItem('bc:config');
    if (bcConfigRaw) {
      try {
        const config = JSON.parse(bcConfigRaw.trim());
        if (config && (config.connectorType || config.nwcUrl)) {
          setIsConnected(true);
        }
      } catch { /* checkConnection will verify */ }
    }

    // Initial check — then mark initialization complete
    checkConnection().finally(() => setIsInitializing(false));
    
    // Listen for Bitcoin Connect events
    const handleConnected = () => {
      console.log('🔗 Global Bitcoin Connect wallet connected - FORCING IMMEDIATE CONNECTION STATE');
      // Force immediate state update when BC reports connected - bypass all checks
      setIsConnected(true);
      console.log('💡 INSTANT: Set isConnected = true immediately on bc:connected event');
      
      // Still do background verification, but don't wait for it
      setTimeout(() => {
        console.log('🔄 Background verification: Re-checking connection after wallet action');
        checkConnection();
      }, 100);
    };

    // Add comprehensive event monitoring to debug what's actually happening
    const debugEventHandler = (eventName: string) => (event: any) => {
      console.log(`🔍 EVENT DEBUG: ${eventName} fired`, event);
    };
    
    const handleDisconnected = () => {
      console.log('🔗 Global Bitcoin Connect wallet disconnected');
      // Auto-refresh: Check immediately, then again after a delay
      checkConnection();
      setTimeout(() => {
        console.log('🔄 Auto-refresh: Re-checking connection after disconnect');
        checkConnection();
      }, 1000);
    };

    // Core Bitcoin Connect events
    window.addEventListener('bc:connected', handleConnected);
    window.addEventListener('bc:disconnected', handleDisconnected);
    
    // Debug: Monitor ALL possible Bitcoin Connect related events
    const possibleEvents = [
      'bc:connecting', 'bc:connect', 'bc:ready', 'bc:initialized', 'bc:wallet-connected',
      'bitcoin-connect:connected', 'bitcoin-connect:ready', 'bitcoinconnect:connected',
      'wallet:connected', 'wallet:ready', 'alby:connected', 'webln:ready'
    ];
    
    possibleEvents.forEach(eventName => {
      window.addEventListener(eventName, debugEventHandler(eventName));
      console.log(`👂 Listening for event: ${eventName}`);
    });
    
    // Listen for storage changes (in case BC updates localStorage from another tab/component)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key && (e.key.startsWith('bc:') || e.key.includes('nwc') || e.key.includes('alby'))) {
        console.log('🔄 Bitcoin Connect storage changed:', e.key, 'new value:', e.newValue);
        
        // If bc:config appears with connection data, force immediate connection
        if (e.key === 'bc:config' && e.newValue) {
          try {
            const config = JSON.parse(e.newValue);
            if (config && (config.connectorType || config.nwcUrl)) {
              console.log('💡 INSTANT: bc:config detected with connection data - forcing immediate state');
              setIsConnected(true);
            }
          } catch (error) {
            console.log('Failed to parse bc:config:', error);
          }
        }
        
        // Auto-refresh: Check immediately, then again after a delay for storage changes
        checkConnection();
        setTimeout(() => {
          console.log('🔄 Auto-refresh: Re-checking connection after storage change');
          checkConnection();
        }, 1500);
      }
    };
    window.addEventListener('storage', handleStorageChange);

    // Listen for WebLN enable events (Alby extension connections)
    const handleWeblnEnabled = () => {
      console.log('🔗 WebLN enabled event detected');
      // Auto-refresh: Check immediately, then again after a delay for WebLN
      checkConnection();
      setTimeout(() => {
        console.log('🔄 Auto-refresh: Re-checking connection after WebLN enable');
        checkConnection();
      }, 1000);
    };
    
    // Monitor for WebLN changes if available
    if (typeof window !== 'undefined' && (window as any).webln) {
      window.addEventListener('webln:enabled', handleWeblnEnabled);
    }

    // Listen for visibility changes (when user returns to tab after wallet action)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('🔄 Tab became visible - checking wallet connection status');
        // Auto-refresh: Check connection when user returns to tab
        setTimeout(checkConnection, 500);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen for focus events (when user clicks back into the app)
    const handleFocus = () => {
      console.log('🔄 Window focused - checking wallet connection status');
      // Auto-refresh: Check connection when window gains focus
      setTimeout(checkConnection, 500);
    };
    window.addEventListener('focus', handleFocus);

    // Check connection status periodically (less frequently to avoid rate limiting)
    const interval = setInterval(checkConnection, 60000); // Every 60 seconds to avoid rate limits
    
    // More frequent checking when BC config exists but not yet connected (transitional state)
    let fastCheckInterval: NodeJS.Timeout | null = null;
    const startFastChecking = () => {
      if (fastCheckInterval) return; // Already checking
      console.log('🚀 Starting fast connection checking (BC in transitional state)');
      fastCheckInterval = setInterval(() => {
        const bcConfigExists = safeLocalStorage.getItem('bc:config');
        const alreadyConnected = !!(window as any).webln?.enabled ||
          !!safeLocalStorage.getItem('bc:connectorType');
        if (bcConfigExists && !alreadyConnected) {
          checkConnection();
        } else {
          // Stop fast checking once connected or no BC config
          if (fastCheckInterval) {
            clearInterval(fastCheckInterval);
            fastCheckInterval = null;
            console.log('🛑 Stopping fast connection checking');
          }
        }
      }, 1000); // Check every second when in transitional state
    };
    
    // Start fast checking if BC config exists (interval self-stops once connected)
    if (safeLocalStorage.getItem('bc:config')) {
      startFastChecking();
    }

    return () => {
      window.removeEventListener('bc:connected', handleConnected);
      window.removeEventListener('bc:disconnected', handleDisconnected);
      window.removeEventListener('storage', handleStorageChange);
      
      // Remove debug event listeners
      possibleEvents.forEach(eventName => {
        window.removeEventListener(eventName, debugEventHandler(eventName));
      });
      
      if (typeof window !== 'undefined' && (window as any).webln) {
        window.removeEventListener('webln:enabled', handleWeblnEnabled);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
      if (fastCheckInterval) {
        clearInterval(fastCheckInterval);
      }
    };
  }, [isLightningEnabled]);

  return (
    <BitcoinConnectContext.Provider value={{ isConnected, isInitializing, setIsConnected, checkConnection }}>
      {children}
    </BitcoinConnectContext.Provider>
  );
}

export function useBitcoinConnect() {
  const context = useContext(BitcoinConnectContext);
  if (context === undefined) {
    // Return a safe default instead of throwing when provider is not available
    // This can happen during SSR or when lightning is disabled
    return {
      isConnected: false,
      isInitializing: false,
      setIsConnected: () => {},
      checkConnection: async () => false
    };
  }
  return context;
}