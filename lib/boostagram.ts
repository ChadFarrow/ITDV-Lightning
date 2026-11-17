/**
 * The boostagram that rides on every ITDV keysend: bLIP-10 metadata in TLV 7629169, the
 * message in 7629171, and the Sphinx record 133773310.
 *
 * The manual boost (components/BitcoinConnect.tsx) and the auto boost
 * (utils/payment-utils.ts) both build their records here. They used to keep separate
 * copies, and the copies drifted: the auto boost lost the feed, the GUIDs and the album,
 * and sent hex where WebLN wants text.
 *
 * Field choices, checked against bLIP-10 and against what reads them on 2026-11-16:
 * - `podcast` is the feed title. A music feed's title is the album, so that is
 *   `album`; it used to carry the artist.
 * - `guid` is the feed's podcast:guid, which bLIP-10 names for this purpose.
 * - `remote_feed_guid`/`remote_item_guid` stay, holding this feed's own GUIDs. bLIP-10
 *   means them for a remote item, but Helipad looks the pair up in Podcast Index to
 *   name the song, and Helipad-to-Nostr-BoostBot builds its lnbeats album link from
 *   `remote_feed_guid`. StableKraft sends them the same way.
 * - No `feedID`. The two numbers once hard-coded here were the Into The Doerfel-Verse
 *   podcast (6590182) and an unrelated Spanish podcast (6590183), and nothing in the
 *   album data holds the real Podcast Index id. Neither Helipad nor the BoostBot read
 *   the lowercase `feedId` that was sent.
 * - `feed`/`url` only when the feed URL is known. They used to fall back to the Into The
 *   Doerfel-Verse podcast feed, which named the wrong feed (auto-boost tracks carry no
 *   feed URL); `guid` identifies the feed either way.
 * - `value_msat` is what this one payment carries, `value_msat_total` the whole boost.
 *
 * Keep this module free of Node-only APIs and post-ES5 syntax: it runs in the browser
 * and tsconfig targets es5. `scripts/check-boost-messages.ts` holds its assertions.
 */

export const TLV_BOOSTAGRAM = 7629169;
export const TLV_TIP_NOTE = 7629171;
export const TLV_SPHINX = 133773310;

export interface BoostMetadata {
  title?: string;
  artist?: string;
  album?: string;
  imageUrl?: string;
  podcastFeedGuid?: string;
  podcastGuid?: string; // podcast:guid at item level
  episode?: string;
  feedUrl?: string;
  itemGuid?: string;
  timestamp?: number;
  senderName?: string;
  appName?: string;
  url?: string;
  publisherGuid?: string;
  publisherUrl?: string;
  message?: string; // Boostagram message
}

/** bLIP-10 actions this app sends. An auto boost is "auto", as in StableKraft. */
export type BoostAction = 'boost' | 'auto';

export interface BoostPayment {
  action: BoostAction;
  /** Sats in this one keysend. */
  amountSats: number;
  /** Sats in the whole boost, across every split. */
  totalSats: number;
  /** The split recipient this keysend pays. */
  recipientName?: string;
}

/** Placeholders the UI passes as an album: the shuffle playlist and the fallbacks. */
const NOT_AN_ALBUM: { [lowerCased: string]: true } = {
  'shuffle all': true,
  'unknown album': true,
};

/** The album title, or undefined when the value is a playlist name or a placeholder. */
export function realAlbumTitle(meta: BoostMetadata): string | undefined {
  const album = meta.album ? meta.album.trim() : '';
  return album && !NOT_AN_ALBUM[album.toLowerCase()] ? album : undefined;
}

/**
 * The bLIP-10 `podcast` value: the feed title. Each ITDV album is its own feed, so this
 * is the album title. Without a real album it falls back to the artist, as before.
 */
export function feedTitleOf(meta: BoostMetadata): string {
  return realAlbumTitle(meta) || meta.artist || 'Unknown Artist';
}

/** The JSON object for TLV 7629169 on one keysend. */
export function buildBoostagram(meta: BoostMetadata, payment: BoostPayment): Record<string, string | number> {
  const album = realAlbumTitle(meta);
  const record: Record<string, string | number> = {
    podcast: feedTitleOf(meta),
    episode: meta.title || 'Unknown Title',
    action: payment.action,
    app_name: meta.appName || 'ITDV App',
  };
  if (meta.feedUrl) {
    record.feed = meta.feedUrl;
    record.url = meta.feedUrl;
  }
  record.message = meta.message || '';
  if (meta.timestamp) record.ts = meta.timestamp;
  if (meta.podcastFeedGuid) record.guid = meta.podcastFeedGuid;
  if (meta.itemGuid) {
    record.episode_guid = meta.itemGuid;
    record.remote_item_guid = meta.itemGuid;
  }
  if (meta.podcastFeedGuid) record.remote_feed_guid = meta.podcastFeedGuid;
  if (album) record.album = album;
  record.value_msat_total = payment.totalSats * 1000;
  record.sender_name = meta.senderName || 'Anonymous';
  record.uuid = `boost-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  record.app_version = '1.0.0';
  record.value_msat = payment.amountSats * 1000;
  record.name = payment.recipientName || 'ITDV App';
  return record;
}

/**
 * Every record a manual boost sends on one keysend, as UTF-8 text keyed by TLV type.
 * That is the shape WebLN's `keysend({ customRecords })` takes: the wallet encodes each
 * value itself. Use `toHexTlvRecords` for the NWC `tlv_records` shape.
 */
export function buildBoostRecords(meta: BoostMetadata, payment: BoostPayment): Record<number, string> {
  const records: Record<number, string> = {};
  records[TLV_BOOSTAGRAM] = JSON.stringify(buildBoostagram(meta, payment));

  if (meta.message) {
    records[TLV_TIP_NOTE] = meta.message;
  }

  const sphinx: Record<string, string | number> = {
    podcast: feedTitleOf(meta),
    episode: meta.title || 'Unknown Title',
    action: payment.action,
    app: meta.appName || 'ITDV App',
    message: meta.message || '',
    amount: payment.totalSats,
    sender: meta.senderName || 'Anonymous',
  };
  if (meta.timestamp) sphinx.timestamp = meta.timestamp;
  records[TLV_SPHINX] = JSON.stringify(sphinx);

  return records;
}

function utf8ToHex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  }
  return hex;
}

/** Text records → the `[{ type, value: hex }]` array that NWC `pay_keysend` takes. */
export function toHexTlvRecords(records: Record<number, string>): Array<{ type: number; value: string }> {
  return Object.keys(records).map((type) => ({
    type: Number(type),
    value: utf8ToHex(records[Number(type)]),
  }));
}

/**
 * The comment on an LNURL-pay invoice for a Lightning-address split. `description` is
 * already "Boost for … by …", so it is used as it is, then the sender and the message.
 * It used to wrap the description in a second "Boost for …", and it left out both.
 */
export function buildLnurlComment(description: string, meta?: BoostMetadata): string {
  let comment = description;
  if (meta && meta.senderName) comment += ` from ${meta.senderName}`;
  if (meta && meta.message) comment += `: ${meta.message}`;
  return comment;
}
