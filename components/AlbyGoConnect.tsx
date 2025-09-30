'use client';

import { useState, useEffect } from 'react';
import { useBitcoinConnect } from '@/contexts/BitcoinConnectContext';

interface AlbyGoConnectProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
  className?: string;
}

export default function AlbyGoConnect({ onSuccess, onError, className = '' }: AlbyGoConnectProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const { checkConnection } = useBitcoinConnect();

  // Handle NWC connection from URL parameters (for one-tap return)
  useEffect(() => {
    const handleNWCFromURL = async () => {
      // Check if we have an NWC connection string in the URL (from Alby Go redirect)
      const urlParams = new URLSearchParams(window.location.search);
      const nwcString = urlParams.get('nwc') || urlParams.get('connectionString');
      
      if (nwcString) {
        setIsConnecting(true);
        
        try {
          // Store the connection string
          localStorage.setItem('nwc_connection_string', nwcString);
          
          // Import and connect the NWC service
          const { getNWCService } = await import('@/lib/nwc-service');
          const nwcService = getNWCService();
          
          await nwcService.connect(nwcString);
          await checkConnection();
          
          // Clean the URL
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.delete('nwc');
          newUrl.searchParams.delete('connectionString');
          window.history.replaceState({}, '', newUrl.toString());
          
          onSuccess?.();
        } catch (error) {
          console.error('Failed to connect with NWC from URL:', error);
          onError?.(error instanceof Error ? error.message : 'Connection failed');
        } finally {
          setIsConnecting(false);
        }
      }
    };

    handleNWCFromURL();
  }, [checkConnection, onSuccess, onError]);

  const handleAlbyGoConnect = async () => {
    setIsConnecting(true);
    
    try {
      // For Alby Hub one-tap connections, we need to create a proper connection request
      // The user should get this URL from their Alby Hub's one-tap connection setup
      
      const appName = 'HPM Lightning';
      const returnUrl = typeof window !== 'undefined' ? `${window.location.origin}?nwc=` : '';
      
      // Build the connection request for Alby Hub/Go
      // This URL format works with Alby Hub's one-tap connection feature
      const connectionParams = new URLSearchParams({
        name: appName,
        return_url: returnUrl,
        expires_at: String(Math.floor(Date.now() / 1000) + 31536000), // 1 year
        max_amount: '100000', // Maximum amount per payment in sats
        budget_renewal: 'monthly', // Budget renewal period
        request_methods: [
          'pay_invoice',
          'make_invoice', 
          'get_balance',
          'get_info',
          'pay_keysend',
          'pay_multi_invoice',
          'pay_multi_keysend',
          'list_transactions',
          'lookup_invoice',
          'sign_message'
        ].join(' ')
      });

      // The proper URL for Alby Hub one-tap connections
      const albyHubUrl = `https://nwc.getalby.com/apps/new?${connectionParams.toString()}`;
      
      // Check if we're on mobile
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      
      if (isMobile) {
        // On mobile, this will open Alby Go if installed, or the web version
        window.location.href = albyHubUrl;
      } else {
        // On desktop, open in a new window
        const popup = window.open(albyHubUrl, 'alby-connect', 'width=400,height=700');
        
        // Listen for the connection message
        const handleMessage = async (event: MessageEvent) => {
          // Accept messages from Alby domains
          if (!event.origin.includes('getalby.com')) return;
          
          if (event.data.type === 'nwc:connection_string' || event.data.connectionString) {
            const connectionString = event.data.connectionString || event.data.nwc;
            
            if (connectionString) {
              // Store the connection string
              localStorage.setItem('nwc_connection_string', connectionString);
              
              // Import and connect the NWC service
              const { getNWCService } = await import('@/lib/nwc-service');
              const nwcService = getNWCService();
              
              try {
                await nwcService.connect(connectionString);
                await checkConnection();
                onSuccess?.();
                
                // Close the popup if it's still open
                if (popup && !popup.closed) {
                  popup.close();
                }
              } catch (error) {
                console.error('Failed to connect with NWC:', error);
                onError?.(error instanceof Error ? error.message : 'Connection failed');
              }
              
              // Clean up
              window.removeEventListener('message', handleMessage);
              setIsConnecting(false);
            }
          }
        };
        
        window.addEventListener('message', handleMessage);
        
        // Clean up after 5 minutes if no response
        setTimeout(() => {
          window.removeEventListener('message', handleMessage);
          setIsConnecting(false);
          if (popup && !popup.closed) {
            popup.close();
          }
        }, 300000);
      }
      
    } catch (error) {
      console.error('Error initiating Alby connection:', error);
      onError?.(error instanceof Error ? error.message : 'Failed to connect');
      setIsConnecting(false);
    }
  };

  return (
    <button
      onClick={handleAlbyGoConnect}
      disabled={isConnecting}
      className={`flex items-center gap-3 px-6 py-3 bg-yellow-500 hover:bg-yellow-600 text-black font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {isConnecting ? (
        <>
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Connecting...</span>
        </>
      ) : (
        <>
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 2v11h3v9l7-12h-4l4-8z"/>
          </svg>
          <span>Connect Alby Hub</span>
          <span className="text-xs opacity-75">(One Tap)</span>
        </>
      )}
    </button>
  );
}