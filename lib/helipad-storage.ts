import fs from 'fs';
import path from 'path';

// File-based persistent storage for Helipad boosts
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

// Storage file path
const STORAGE_DIR = path.join(process.cwd(), 'data');
const STORAGE_FILE = path.join(STORAGE_DIR, 'helipad-boosts.json');

// Ensure storage directory exists
function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

// Load boosts from file
function loadBoostsFromFile(): StoredHelipadBoost[] {
  try {
    ensureStorageDir();
    if (!fs.existsSync(STORAGE_FILE)) {
      console.log('📁 Helipad boosts file not found, starting with empty storage');
      return [];
    }
    
    const fileContent = fs.readFileSync(STORAGE_FILE, 'utf-8');
    const boosts: StoredHelipadBoost[] = JSON.parse(fileContent);
    console.log(`📂 Loaded ${boosts.length} Helipad boosts from file`);
    return boosts;
  } catch (error) {
    console.error('❌ Error loading Helipad boosts from file:', error);
    // Return empty array if file is corrupted or doesn't exist
    return [];
  }
}

// Save boosts to file
function saveBoostsToFile(boosts: StoredHelipadBoost[]) {
  try {
    ensureStorageDir();
    // Sort by timestamp descending before saving
    const sortedBoosts = [...boosts].sort((a, b) => b.timestamp - a.timestamp);
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(sortedBoosts, null, 2), 'utf-8');
    console.log(`💾 Saved ${sortedBoosts.length} Helipad boosts to file`);
  } catch (error) {
    console.error('❌ Error saving Helipad boosts to file:', error);
    // Don't throw - allow in-memory storage to continue working
  }
}

// Initialize storage from file
let helipadBoostsStorage: StoredHelipadBoost[] = loadBoostsFromFile();

// Add a boost to storage
export function addHelipadBoost(boostData: StoredHelipadBoost) {
  console.log('💾 Storing Helipad boost:', boostData.index || boostData.uuid);
  
  // Check if boost already exists (by index or uuid) to prevent duplicates
  const existingIndex = helipadBoostsStorage.findIndex(
    boost => (boost.index && boost.index === boostData.index) || 
             (boost.uuid && boost.uuid === boostData.uuid)
  );
  
  if (existingIndex >= 0) {
    // Update existing boost
    helipadBoostsStorage[existingIndex] = boostData;
    console.log('🔄 Updated existing Helipad boost');
  } else {
    // Add new boost
    helipadBoostsStorage.push(boostData);
  }
  
  // Save to file immediately
  saveBoostsToFile(helipadBoostsStorage);
}

// Get all stored boosts
export function getHelipadBoosts(limit: number = 50): StoredHelipadBoost[] {
  const sortedBoosts = [...helipadBoostsStorage].sort((a, b) => b.timestamp - a.timestamp);
  return sortedBoosts.slice(0, limit);
}

// Clear all stored boosts
export function clearHelipadBoosts() {
  helipadBoostsStorage = [];
  saveBoostsToFile(helipadBoostsStorage);
  console.log('🗑️ Cleared all Helipad boosts from storage');
}

// Get total count
export function getHelipadBoostsCount(): number {
  return helipadBoostsStorage.length;
}
