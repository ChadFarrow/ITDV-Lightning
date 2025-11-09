import { sql } from '@vercel/postgres';

// Postgres-based persistent storage for Helipad boosts
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

// Initialize database table if it doesn't exist
let tableInitialized = false;

async function ensureTableExists() {
  if (tableInitialized) return;
  
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS helipad_boosts (
        id SERIAL PRIMARY KEY,
        boost_index INTEGER,
        boost_uuid VARCHAR(255),
        value_msat BIGINT,
        value_msat_total BIGINT,
        action INTEGER,
        sender TEXT,
        app TEXT,
        message TEXT,
        podcast TEXT,
        episode TEXT,
        boost_time BIGINT,
        remote_podcast TEXT,
        remote_episode TEXT,
        tlv TEXT,
        reply_sent BOOLEAN,
        custom_key TEXT,
        custom_value TEXT,
        payment_info JSONB,
        platform VARCHAR(20) NOT NULL DEFAULT 'helipad',
        timestamp BIGINT NOT NULL,
        stored_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        nostr_event_id TEXT,
        nevent TEXT,
        nostr_error TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    
    // Create indexes for better query performance
    await sql`
      CREATE INDEX IF NOT EXISTS idx_helipad_boosts_timestamp ON helipad_boosts(timestamp DESC)
    `;
    
    await sql`
      CREATE INDEX IF NOT EXISTS idx_helipad_boosts_index ON helipad_boosts(boost_index)
    `;
    
    await sql`
      CREATE INDEX IF NOT EXISTS idx_helipad_boosts_uuid ON helipad_boosts(boost_uuid)
    `;
    
    tableInitialized = true;
    console.log('✅ Helipad boosts table initialized');
  } catch (error) {
    console.error('❌ Error initializing helipad_boosts table:', error);
    throw error;
  }
}

// Add a boost to storage
export async function addHelipadBoost(boostData: StoredHelipadBoost) {
  try {
    await ensureTableExists();
    
    console.log('💾 Storing Helipad boost:', boostData.index || boostData.uuid);
    
    // Check if boost already exists (by index/uuid + value_msat) to prevent duplicates
    // For splits: same index/uuid but different value_msat should be stored separately
    // We store all splits separately for record keeping, but group them when displaying
    let existingBoost = null;
    
    if (boostData.index && boostData.value_msat !== undefined) {
      const result = await sql`
        SELECT id FROM helipad_boosts 
        WHERE boost_index = ${boostData.index} AND value_msat = ${boostData.value_msat} 
        LIMIT 1
      `;
      if (result.rows.length > 0) {
        existingBoost = result.rows[0];
      }
    }
    
    if (!existingBoost && boostData.uuid && boostData.value_msat !== undefined) {
      const result = await sql`
        SELECT id FROM helipad_boosts 
        WHERE boost_uuid = ${boostData.uuid} AND value_msat = ${boostData.value_msat} 
        LIMIT 1
      `;
      if (result.rows.length > 0) {
        existingBoost = result.rows[0];
      }
    }
    
    if (existingBoost) {
      // Update existing boost
      await sql`
        UPDATE helipad_boosts SET
          value_msat = ${boostData.value_msat},
          value_msat_total = ${boostData.value_msat_total},
          action = ${boostData.action},
          sender = ${boostData.sender},
          app = ${boostData.app},
          message = ${boostData.message},
          podcast = ${boostData.podcast},
          episode = ${boostData.episode},
          boost_time = ${boostData.time},
          remote_podcast = ${boostData.remote_podcast},
          remote_episode = ${boostData.remote_episode},
          tlv = ${boostData.tlv},
          reply_sent = ${boostData.reply_sent},
          custom_key = ${boostData.custom_key},
          custom_value = ${boostData.custom_value},
          payment_info = ${JSON.stringify(boostData.payment_info || null)}::jsonb,
          timestamp = ${boostData.timestamp},
          stored_at = ${boostData.storedAt}::timestamp with time zone,
          nostr_event_id = ${boostData.nostrEventId},
          nevent = ${boostData.nevent},
          nostr_error = ${boostData.nostrError}
        WHERE id = ${existingBoost.id}
      `;
      console.log('🔄 Updated existing Helipad boost');
    } else {
      // Insert new boost
      await sql`
        INSERT INTO helipad_boosts (
          boost_index, boost_uuid, value_msat, value_msat_total, action,
          sender, app, message, podcast, episode, boost_time,
          remote_podcast, remote_episode, tlv, reply_sent,
          custom_key, custom_value, payment_info, platform,
          timestamp, stored_at, nostr_event_id, nevent, nostr_error
        ) VALUES (
          ${boostData.index}, ${boostData.uuid}, ${boostData.value_msat},
          ${boostData.value_msat_total}, ${boostData.action},
          ${boostData.sender}, ${boostData.app}, ${boostData.message},
          ${boostData.podcast}, ${boostData.episode}, ${boostData.time},
          ${boostData.remote_podcast}, ${boostData.remote_episode},
          ${boostData.tlv}, ${boostData.reply_sent},
          ${boostData.custom_key}, ${boostData.custom_value},
          ${JSON.stringify(boostData.payment_info || null)}::jsonb,
          ${boostData.platform}, ${boostData.timestamp},
          ${boostData.storedAt}::timestamp with time zone,
          ${boostData.nostrEventId}, ${boostData.nevent}, ${boostData.nostrError}
        )
      `;
      console.log('✅ Added new Helipad boost');
    }
  } catch (error) {
    console.error('❌ Error storing Helipad boost:', error);
    throw error;
  }
}

// Get all stored boosts
export async function getHelipadBoosts(limit: number = 50): Promise<StoredHelipadBoost[]> {
  try {
    await ensureTableExists();
    
    const result = await sql`
      SELECT 
        boost_index as index,
        boost_uuid as uuid,
        value_msat,
        value_msat_total,
        action,
        sender,
        app,
        message,
        podcast,
        episode,
        boost_time as time,
        remote_podcast,
        remote_episode,
        tlv,
        reply_sent,
        custom_key,
        custom_value,
        payment_info,
        platform,
        timestamp,
        stored_at::text as storedAt,
        nostr_event_id as nostrEventId,
        nevent,
        nostr_error as nostrError
      FROM helipad_boosts
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;
    
    return result.rows.map((row: any) => ({
      index: row.index,
      uuid: row.uuid,
      value_msat: row.value_msat,
      value_msat_total: row.value_msat_total,
      action: row.action,
      sender: row.sender,
      app: row.app,
      message: row.message,
      podcast: row.podcast,
      episode: row.episode,
      time: row.time,
      remote_podcast: row.remote_podcast,
      remote_episode: row.remote_episode,
      tlv: row.tlv,
      reply_sent: row.reply_sent,
      custom_key: row.custom_key,
      custom_value: row.custom_value,
      payment_info: row.payment_info,
      platform: 'helipad' as const,
      timestamp: row.timestamp,
      storedAt: row.storedat || new Date().toISOString(),
      nostrEventId: row.nostr_event_id,
      nevent: row.nevent,
      nostrError: row.nostr_error
    })) as StoredHelipadBoost[];
  } catch (error) {
    console.error('❌ Error fetching Helipad boosts:', error);
    return [];
  }
}

// Clear all stored boosts
export async function clearHelipadBoosts() {
  try {
    await ensureTableExists();
    
    await sql`DELETE FROM helipad_boosts`;
    console.log('🗑️ Cleared all Helipad boosts from storage');
  } catch (error) {
    console.error('❌ Error clearing Helipad boosts:', error);
    throw error;
  }
}

// Get total count
export async function getHelipadBoostsCount(): Promise<number> {
  try {
    await ensureTableExists();
    
    const result = await sql`SELECT COUNT(*) as count FROM helipad_boosts`;
    return parseInt(result.rows[0]?.count || '0', 10);
  } catch (error) {
    console.error('❌ Error getting Helipad boosts count:', error);
    return 0;
  }
}
