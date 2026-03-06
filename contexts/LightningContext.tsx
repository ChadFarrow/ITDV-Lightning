'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { safeLocalStorage } from '@/lib/safe-storage';

interface LightningContextType {
  isLightningEnabled: boolean;
  toggleLightning: () => void;
  setLightningEnabled: (enabled: boolean) => void;
}

const LightningContext = createContext<LightningContextType | undefined>(undefined);

export function LightningProvider({ children }: { children: ReactNode }) {
  const [isLightningEnabled, setIsLightningEnabled] = useState(false);

  // Load Lightning setting from localStorage on mount
  useEffect(() => {
    const saved = safeLocalStorage.getItem('lightning_enabled');
    if (saved !== null) {
      setIsLightningEnabled(saved === 'true');
    }
    // If no saved preference exists, Lightning stays disabled by default
  }, []);

  // Save to localStorage when setting changes
  useEffect(() => {
    safeLocalStorage.setItem('lightning_enabled', isLightningEnabled.toString());
  }, [isLightningEnabled]);

  const toggleLightning = () => {
    setIsLightningEnabled(prev => !prev);
  };

  const setLightningEnabled = (enabled: boolean) => {
    setIsLightningEnabled(enabled);
  };

  return (
    <LightningContext.Provider value={{
      isLightningEnabled,
      toggleLightning,
      setLightningEnabled
    }}>
      {children}
    </LightningContext.Provider>
  );
}

export function useLightning() {
  const context = useContext(LightningContext);
  if (context === undefined) {
    throw new Error('useLightning must be used within a LightningProvider');
  }
  return context;
}