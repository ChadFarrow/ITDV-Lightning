// In-memory storage for Helipad boosts (in production, use a database)
export interface StoredHelipadBoost {
  index?: number;
  uuid?: string;
  value_msat?: number;
  value_msat_total?: number;
  action?: number;
  sender?: string;
  app?: string;
  message?: string;
  podcast?: string;
  episode?: string;
  time?: number;
  remote_podcast?: string;
  remote_episode?: string;
  tlv?: string;
  reply_sent?: boolean;
  custom_key?: string | null;
  custom_value?: string | null;
  payment_info?: any;
  platform: 'helipad';
  timestamp: number;
  storedAt: string;
  nostrEventId?: string;
  nevent?: string;
  nostrError?: string;
}

let helipadBoostsStorage: StoredHelipadBoost[] = [];

// Add a boost to storage
export function addHelipadBoost(boostData: StoredHelipadBoost) {
  console.log('💾 Storing Helipad boost:', boostData.index || boostData.uuid);
  helipadBoostsStorage.unshift(boostData); // Add to beginning for newest first
  // Keep only the most recent 100 boosts in memory to prevent unbounded growth
  if (helipadBoostsStorage.length > 100) {
    helipadBoostsStorage.sort((a, b) => b.timestamp - a.timestamp);
    helipadBoostsStorage.splice(100);
  }
}

// Get all stored boosts
export function getHelipadBoosts(limit: number = 50): StoredHelipadBoost[] {
  const sortedBoosts = [...helipadBoostsStorage].sort((a, b) => b.timestamp - a.timestamp);
  return sortedBoosts.slice(0, limit);
}

// Clear all stored boosts
export function clearHelipadBoosts() {
  helipadBoostsStorage = [];
  console.log('🗑️ Cleared all Helipad boosts from storage');
}

// Get total count
export function getHelipadBoostsCount(): number {
  return helipadBoostsStorage.length;
}
