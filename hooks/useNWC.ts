import { useState, useEffect, useCallback } from 'react';
import { getNWCService, type NWCConnection } from '@/lib/nwc-service';
import { safeLocalStorage } from '@/lib/safe-storage';

interface UseNWCReturn {
  isConnected: boolean;
  connectionString: string;
  balance: number | null;
  error: string | null;
  loading: boolean;
  connect: (connectionString: string) => Promise<void>;
  disconnect: () => void;
  payInvoice: (invoice: string) => Promise<{ success: boolean; preimage?: string; error?: string }>;
  makeInvoice: (amount: number, description?: string) => Promise<{ invoice?: string; error?: string }>;
  refreshBalance: () => Promise<void>;
  payKeysend: (pubkey: string, amount: number, description?: string) => Promise<{ success: boolean; preimage?: string; error?: string }>;
}

const NWC_STORAGE_KEY = 'nwc_connection_string';

export function useNWC(): UseNWCReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionString, setConnectionString] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const nwcService = getNWCService();

  // Check service connection status on mount and periodically
  useEffect(() => {
    const checkConnectionStatus = () => {
      const serviceConnected = nwcService.isConnected();
      console.log('🔄 Checking NWC service connection status:', serviceConnected);
      if (serviceConnected !== isConnected) {
        setIsConnected(serviceConnected);
      }
    };
    
    checkConnectionStatus();
    const interval = setInterval(checkConnectionStatus, 1000);
    return () => clearInterval(interval);
  }, [nwcService, isConnected]);

  // Load saved connection on mount
  useEffect(() => {
    const savedConnection = safeLocalStorage.getItem(NWC_STORAGE_KEY);
    if (savedConnection) {
      console.log('🔄 Auto-connecting with saved connection...');
      connect(savedConnection);
    }
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!isConnected) return;
    
    try {
      const response = await nwcService.getBalance();
      console.log('🔍 Raw balance response:', response);
      if (response.error) {
        console.error('Failed to fetch balance:', response.error);
      } else if (response.balance !== undefined) {
        console.log('💰 Raw balance value:', response.balance, typeof response.balance);
        // Convert from msats to sats if needed (NWC often returns msats)
        const balanceInSats = Math.floor(response.balance / 1000);
        console.log('💰 Balance in sats:', balanceInSats);
        setBalance(balanceInSats);
      }
    } catch (err) {
      console.error('Error fetching balance:', err);
    }
  }, [isConnected, nwcService]);

  const connect = useCallback(async (connString: string) => {
    setLoading(true);
    setError(null);
    
    try {
      await nwcService.connect(connString);
      setConnectionString(connString);
      setIsConnected(true);
      console.log('✅ NWC wallet connected successfully');
      
      // Save to localStorage
      safeLocalStorage.setItem(NWC_STORAGE_KEY, connString);
      
      // Fetch initial balance
      await refreshBalance();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to connect';
      setError(errorMsg);
      setIsConnected(false);
      console.error('❌ NWC connection error:', err);
    } finally {
      setLoading(false);
    }
  }, [nwcService, refreshBalance]);

  const disconnect = useCallback(() => {
    nwcService.disconnect();
    setIsConnected(false);
    setConnectionString('');
    setBalance(null);
    setError(null);
    
    // Remove from localStorage
    safeLocalStorage.removeItem(NWC_STORAGE_KEY);
  }, [nwcService]);

  const payInvoice = useCallback(async (invoice: string) => {
    if (!isConnected) {
      return { success: false, error: 'Wallet not connected' };
    }

    console.log('⚡ Attempting to pay invoice:', invoice.substring(0, 20) + '...');
    setLoading(true);
    try {
      const response = await nwcService.payInvoice(invoice);
      console.log('💳 Payment response:', response);
      
      if (response.error) {
        console.error('❌ Payment failed:', response.error);
        return { success: false, error: response.error };
      }
      
      // Refresh balance after payment
      await refreshBalance();
      
      console.log('✅ Payment successful');
      return { success: true, preimage: response.preimage };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Payment failed';
      console.error('💥 Payment exception:', err);
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  }, [isConnected, nwcService, refreshBalance]);

  const makeInvoice = useCallback(async (amount: number, description?: string) => {
    if (!isConnected) {
      return { error: 'Wallet not connected' };
    }

    setLoading(true);
    try {
      const response = await nwcService.makeInvoice(amount, description);
      return response;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to create invoice';
      return { error: errorMsg };
    } finally {
      setLoading(false);
    }
  }, [isConnected, nwcService]);

  const payKeysend = useCallback(async (pubkey: string, amount: number, description?: string) => {
    if (!isConnected) {
      return { success: false, error: 'Wallet not connected' };
    }

    setLoading(true);
    try {
      // Add TLV record for description if provided (as array format)
      const tlvRecords = description ? [
        {
          "type": 7629169, // Standard message TLV record type (as number)
          "value": Buffer.from(description, 'utf8').toString('hex') // Convert to hex
        }
      ] : [];
      
      const response = await nwcService.payKeysend(pubkey, amount, tlvRecords);
      
      if (response.error) {
        return { success: false, error: response.error };
      }
      
      // Refresh balance after payment
      await refreshBalance();
      
      return { success: true, preimage: response.preimage };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Keysend payment failed';
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  }, [isConnected, nwcService, refreshBalance]);

  // Auto-refresh balance every 30 seconds when connected
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      refreshBalance();
    }, 30000);

    return () => clearInterval(interval);
  }, [isConnected, refreshBalance]);

  return {
    isConnected,
    connectionString,
    balance,
    error,
    loading,
    connect,
    disconnect,
    payInvoice,
    makeInvoice,
    refreshBalance,
    payKeysend
  };
}