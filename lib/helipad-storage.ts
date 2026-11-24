import { randomUUID } from 'crypto';
import { db, sql } from '@vercel/postgres';
import { neonConfig } from '@neondatabase/serverless';
import {
  assignPaymentKey,
  LIVE_WINDOW_SECONDS,
  PAYMENT_WINDOW_SECONDS,
  type NormalizedRecord,
  type PaymentCandidate,
  type RecordSource,
  type StreamSummaryRow,
} from './stream-records';

// Dev and test only: send the driver to scripts/local-neon-ws-proxy.mjs, which stands in for
// Neon's proxy in front of a plain local Postgres (scripts/local-db.md). Production never sets
// LOCAL_NEON_PROXY. @vercel/postgres does not re-export neonConfig; this is the same module
// instance it configures, because it imports the package it depends on.
const LOCAL_NEON_PROXY = process.env.LOCAL_NEON_PROXY;
if (LOCAL_NEON_PROXY) {
  neonConfig.wsProxy = LOCAL_NEON_PROXY;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
  neonConfig.fetchEndpoint = `http://${LOCAL_NEON_PROXY}/sql`;
}

/**
 * The Helipad records the site keeps (table helipad_boosts). TJ's Helipad webhook and BoostBot
 * (Chad's Helipad) send them to /api/helipad-webhook; lib/stream-records.ts normalises each one.
 * Rows from before the Streams tab have no source, kind or payment key, and count as boosts.
 */
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
  source: RecordSource | null;
  paymentKey: string | null;
}

/** The database could not be reached or refused the query. Routes answer 503. */
export class StoreUnavailableError extends Error {
  readonly reason: unknown;
  constructor(reason: unknown) {
    super(`Helipad store unavailable: ${reason instanceof Error ? reason.message : String(reason)}`);
    this.name = 'StoreUnavailableError';
    this.reason = reason;
    // tsconfig targets es5, where a subclass of Error loses its prototype without this.
    Object.setPrototypeOf(this, StoreUnavailableError.prototype);
  }
}

const NEW_COLUMNS = [
  'source TEXT', 'payment_key TEXT', 'kind TEXT', 'identity TEXT', 'feed_guid TEXT', 'item_key TEXT',
  'listener TEXT', 'show_title TEXT', 'item_title TEXT', 'via_show TEXT', 'recipient TEXT', 'playback_ts INTEGER',
];

// One string, sent in one round trip. CREATE TABLE is the schema from before the Streams tab, so an
// old table and a new one end up the same.
const SCHEMA_SQL = `
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
  );
  CREATE INDEX IF NOT EXISTS idx_helipad_boosts_timestamp ON helipad_boosts(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_helipad_boosts_index ON helipad_boosts(boost_index);
  CREATE INDEX IF NOT EXISTS idx_helipad_boosts_uuid ON helipad_boosts(boost_uuid);
  ${NEW_COLUMNS.map(c => `ALTER TABLE helipad_boosts ADD COLUMN IF NOT EXISTS ${c};`).join('\n  ')}
  CREATE INDEX IF NOT EXISTS idx_helipad_boosts_payment_key ON helipad_boosts(payment_key);
  CREATE INDEX IF NOT EXISTS idx_helipad_boosts_identity_time ON helipad_boosts(identity, boost_time);
  CREATE INDEX IF NOT EXISTS idx_helipad_boosts_kind_timestamp ON helipad_boosts(kind, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_helipad_boosts_source_index ON helipad_boosts(source, boost_index);
`;

let schemaReady: Promise<void> | null = null;

async function migrate(): Promise<void> {
  // Cheap check first: ALTER TABLE locks the table even when the column is already there. The
  // columns and indexes go in one transaction, so all four columns present means all of it is.
  const present = await sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'helipad_boosts' AND column_name IN ('payment_key', 'playback_ts', 'source', 'kind')`;
  if (Number(present.rows[0]?.n) === 4) return;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Two cold starts can migrate at once; the second waits and then finds nothing to do.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('helipad_boosts_schema'))`);
    await client.query(SCHEMA_SQL);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = migrate().catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

/** Run a store operation; any database failure becomes StoreUnavailableError. */
async function guarded<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    await ensureSchema();
    return await run();
  } catch (error) {
    if (error instanceof StoreUnavailableError) throw error;
    console.error(`helipad-store ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new StoreUnavailableError(error);
  }
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return isFinite(n) ? n : undefined;
}

/**
 * Store one normalised record. One transaction, locked on the record's payment identity, so the
 * split records of one payment that arrive together see each other and share one key.
 */
export async function addHelipadRecord(n: NormalizedRecord): Promise<{ stored: true; paymentKey: string; updated: boolean }> {
  return guarded('insert', async () => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [n.identity]);

      // A retry of the same record (same sender, same Helipad index) updates it. Helipad numbers
      // received and sent records in two tables, so one index can be both; a sent record carries
      // payment_info, a received one does not.
      let existing: { id: number; payment_key: string | null } | undefined;
      if (n.index !== undefined && n.index !== null) {
        const found = await client.query(
          `SELECT id, payment_key FROM helipad_boosts
           WHERE source = $1 AND boost_index = $2 AND coalesce(jsonb_typeof(payment_info) = 'object', false) = $3
           LIMIT 1`,
          [n.source, n.index, !!n.payment_info],
        );
        existing = found.rows[0];
      }

      let paymentKey: string;
      if (existing && existing.payment_key) {
        paymentKey = existing.payment_key;
      } else {
        // Every record of each payment that has a record inside the window: a payment that already
        // holds this source and recipient, even from a record outside the window, is taken.
        const found = await client.query(
          `SELECT payment_key, source, recipient, boost_time FROM helipad_boosts
           WHERE identity = $1 AND payment_key IN (
             SELECT payment_key FROM helipad_boosts
             WHERE identity = $1 AND abs(boost_time - $2) <= $3 AND payment_key IS NOT NULL)`,
          [n.identity, n.time, PAYMENT_WINDOW_SECONDS],
        );
        const candidates: PaymentCandidate[] = found.rows.map(row => ({
          paymentKey: row.payment_key,
          source: row.source,
          recipient: row.recipient,
          time: Number(row.boost_time),
        }));
        paymentKey = assignPaymentKey(n, candidates, () => randomUUID());
      }

      const values = [
        n.index ?? null, n.uuid ?? null, n.value_msat ?? null, n.value_msat_total ?? null, n.action ?? null,
        n.sender ?? null, n.app ?? null, n.message ?? null, n.podcast ?? null, n.episode ?? null, n.time,
        n.remote_podcast ?? null, n.remote_episode ?? null,
        // Streams and auto boosts keep no raw boostagram: the page never shows it, and they are many.
        n.kind === 'boost' ? n.tlv ?? null : null,
        n.reply_sent ?? null,
        n.custom_key === undefined || n.custom_key === null ? null : String(n.custom_key), n.custom_value ?? null,
        n.payment_info ? JSON.stringify(n.payment_info) : null, Date.now(),
        n.source, paymentKey, n.kind, n.identity, n.feedGuid, n.itemKey, n.listener, n.showTitle, n.itemTitle,
        n.viaShow, n.recipient, n.playbackTs,
      ];
      if (existing) {
        await client.query(
          `UPDATE helipad_boosts SET
             boost_index = $1, boost_uuid = $2, value_msat = $3, value_msat_total = $4, action = $5,
             sender = $6, app = $7, message = $8, podcast = $9, episode = $10, boost_time = $11,
             remote_podcast = $12, remote_episode = $13, tlv = $14, reply_sent = $15,
             custom_key = $16, custom_value = $17, payment_info = $18::jsonb, timestamp = $19,
             source = $20, payment_key = $21, kind = $22, identity = $23, feed_guid = $24, item_key = $25,
             listener = $26, show_title = $27, item_title = $28, via_show = $29, recipient = $30, playback_ts = $31
           WHERE id = $32`,
          values.concat([existing.id]),
        );
      } else {
        await client.query(
          `INSERT INTO helipad_boosts (
             boost_index, boost_uuid, value_msat, value_msat_total, action,
             sender, app, message, podcast, episode, boost_time,
             remote_podcast, remote_episode, tlv, reply_sent,
             custom_key, custom_value, payment_info, timestamp,
             source, payment_key, kind, identity, feed_guid, item_key,
             listener, show_title, item_title, via_show, recipient, playback_ts, platform
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19,
             $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, 'helipad'
           )`,
          values,
        );
      }
      await client.query('COMMIT');
      return { stored: true as const, paymentKey, updated: !!existing };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });
}

/** The newest boosts, newest first. Streams and auto boosts are not boosts here. */
export async function getHelipadBoosts(limit: number = 50): Promise<StoredHelipadBoost[]> {
  return guarded('read boosts', async () => {
    const result = await sql`
      SELECT boost_index, boost_uuid, value_msat, value_msat_total, action, sender, app, message,
             podcast, episode, boost_time, remote_podcast, remote_episode, tlv, reply_sent,
             custom_key, custom_value, payment_info, timestamp, stored_at::text AS stored_at,
             source, payment_key
      FROM helipad_boosts
      WHERE kind = 'boost' OR kind IS NULL
      ORDER BY timestamp DESC
      LIMIT ${limit}`;
    return result.rows.map(row => ({
      index: toNumber(row.boost_index),
      uuid: row.boost_uuid ?? undefined,
      value_msat: toNumber(row.value_msat),
      value_msat_total: toNumber(row.value_msat_total),
      action: toNumber(row.action),
      sender: row.sender ?? undefined,
      app: row.app ?? undefined,
      message: row.message ?? undefined,
      podcast: row.podcast ?? undefined,
      episode: row.episode ?? undefined,
      time: toNumber(row.boost_time),
      remote_podcast: row.remote_podcast ?? undefined,
      remote_episode: row.remote_episode ?? undefined,
      tlv: row.tlv ?? undefined,
      reply_sent: row.reply_sent ?? undefined,
      custom_key: row.custom_key,
      custom_value: row.custom_value,
      payment_info: row.payment_info,
      platform: 'helipad' as const,
      timestamp: Number(row.timestamp),
      storedAt: row.stored_at,
      source: row.source ?? null,
      paymentKey: row.payment_key ?? null,
    }));
  });
}

/**
 * One row per listener and item for the Streams tab, newest first. Each payment counts once, however
 * many split records it arrived as: DISTINCT ON payment_key keeps its first record.
 */
export async function getStreamSummary(opts: { limit: number; offset: number; nowSeconds: number }): Promise<StreamSummaryRow[]> {
  return guarded('read streams', async () => {
    const result = await sql`
      WITH payments AS (
        SELECT DISTINCT ON (payment_key)
          payment_key, kind, listener, item_key, item_title, show_title, via_show, app,
          coalesce(value_msat_total, value_msat, 0) AS msat, boost_time
        FROM helipad_boosts
        WHERE kind IN ('stream', 'auto') AND payment_key IS NOT NULL
        ORDER BY payment_key, boost_time
      )
      SELECT max(listener) AS listener, max(item_title) AS item_title, show_title, via_show,
             floor(sum(msat) / 1000)::bigint AS total_sats,
             count(*) FILTER (WHERE kind = 'stream')::int AS streams,
             count(*) FILTER (WHERE kind = 'auto')::int AS autos,
             array_remove(array_agg(DISTINCT nullif(app, '')), NULL) AS apps,
             min(boost_time) AS first_time, max(boost_time) AS last_time
      FROM payments
      GROUP BY lower(listener), item_key, show_title, via_show
      ORDER BY max(boost_time) DESC
      LIMIT ${opts.limit} OFFSET ${opts.offset}`;
    return result.rows.map(row => {
      const lastTime = Number(row.last_time);
      return {
        listener: row.listener,
        itemTitle: row.item_title,
        showTitle: row.show_title,
        viaShow: row.via_show ?? null,
        totalSats: Number(row.total_sats),
        streams: Number(row.streams),
        autos: Number(row.autos),
        apps: ((row.apps || []) as string[]).slice().sort(),
        firstTime: Number(row.first_time),
        lastTime,
        live: opts.nowSeconds - lastTime <= LIVE_WINDOW_SECONDS,
      };
    });
  });
}

/** How many boosts the boost list can show (streams and auto boosts excluded). */
export async function getHelipadBoostsCount(): Promise<number> {
  return guarded('count boosts', async () => {
    const result = await sql`SELECT count(*)::int AS count FROM helipad_boosts WHERE kind = 'boost' OR kind IS NULL`;
    return Number(result.rows[0]?.count ?? 0);
  });
}

/** Delete every stored record. Only the admin-guarded DELETE of /api/helipad-boosts calls this. */
export async function clearHelipadBoosts(): Promise<void> {
  await guarded('clear', async () => {
    await sql`DELETE FROM helipad_boosts`;
  });
}
