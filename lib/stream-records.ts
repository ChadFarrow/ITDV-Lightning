// Helipad records for the /boosts Streams tab: what kind a record is, whether it belongs to an
// ITDV feed, and which listener payment it is part of.
//
// Client-safe on purpose (no fs, no Node imports): the page imports the summary row type. tsconfig
// targets es5, so no for..of over a Map or Set and no post-ES5 regex syntax here.
//
// One listener payment arrives as several records. TJ's node gets one per split addressed to it
// (an album pays Ben, Kurt, Joey and DoerfelVerse_Node there), Chad's node gets ChadF's split, and
// when Chad is the listener his Helipad lists one sent record per split. The records share the
// boostagram (feed, item, sender, app, total, playback position) and arrive within about 90 s of
// each other — BoostBot measured a spread of up to 86 s, and a minute bucket once split one boost
// in two (2026-10-30). So a record joins a payment by identity and time, never by bucket.

/** How the Streams tab and the boost list sort a record. */
export type StreamKind = 'stream' | 'auto' | 'boost';

/** Who sent the record to the site: the token that matched says it. */
export type RecordSource = 'tj-helipad' | 'boostbot';

/** Records of one payment arrive within this many seconds of each other. */
export const PAYMENT_WINDOW_SECONDS = 120;
/** A summary row whose last payment is this recent shows as live. */
export const LIVE_WINDOW_SECONDS = 180;

/** A Helipad webhook record (Helipad dbif BoostRecord, as its webhook sends it). */
export interface HelipadRecord {
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
  remote_podcast?: string | null;
  remote_episode?: string | null;
  tlv?: string;
  reply_sent?: boolean;
  custom_key?: string | number | null;
  custom_value?: string | null;
  payment_info?: { pubkey?: string; custom_key?: string | number | null; custom_value?: string | null; [k: string]: unknown } | null;
  direction?: string;
  memo?: string | null;
  list_type?: number;
}

/** The bLIP-10 fields this feature reads from a record's raw boostagram. */
export interface Boostagram {
  feedGuid?: string;
  remoteFeedGuid?: string;
  itemGuid?: string;
  episode?: string;
  podcast?: string;
  senderName?: string;
  appName?: string;
  valueMsatTotal?: number;
  /** Playback position in seconds. 0 or less counts as missing: some apps send `ts: 0`. */
  ts?: number;
}


export interface ItdvFeedIndex {
  /** Lower-cased, trimmed feed GUIDs. */
  guids: Set<string>;
  /** Lower-cased, trimmed title -> the title as written. */
  titles: Map<string, string>;
  /** Lower-cased, trimmed feed GUID -> the feed's title, so a remote song can name its album. */
  titleByGuid: Map<string, string>;
}

export interface ItdvMatch {
  feedGuid: string | null;
  showTitle: string;
  /** The other show a song played in, when only the song's feed (remote_feed_guid) is ITDV. */
  viaShow: string | null;
}

export type NormalizedRecord = HelipadRecord & {
  source: RecordSource;
  kind: StreamKind;
  feedGuid: string | null;
  itemKey: string;
  listener: string;
  showTitle: string;
  itemTitle: string;
  viaShow: string | null;
  recipient: string;
  playbackTs: number | null;
  identity: string;
  time: number;
};

export interface PaymentCandidate {
  paymentKey: string;
  source: RecordSource;
  recipient: string;
  time: number;
  playbackTs: number | null;
}

export interface StreamSummaryRow {
  listener: string;
  itemTitle: string;
  showTitle: string;
  viaShow: string | null;
  totalSats: number;
  streams: number;
  autos: number;
  apps: string[];
  firstTime: number;
  lastTime: number;
  live: boolean;
}

function key(text: string | null | undefined): string {
  return (text || '').trim().toLowerCase();
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof n === 'number' && isFinite(n) ? n : undefined;
}

export function parseBoostagram(tlv: string | undefined | null): Boostagram | null {
  if (!tlv) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(tlv);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  // The store keeps ts in an INTEGER column: a fractional ts is floored, and a value too large for a
  // playback position (a millisecond epoch) counts as missing, like 0.
  const rawTs = num(o.ts);
  const ts = rawTs !== undefined ? Math.floor(rawTs) : undefined;
  const total = num(o.value_msat_total);
  return {
    // A keysend boostagram (bLIP-10) names the feed `guid`. A Lightning-address payment's
    // x-rss-payment JSON, which Helipad stores as tlv, names it `feed_guid` and has no ts.
    feedGuid: str(o.guid) || str(o.feed_guid),
    remoteFeedGuid: str(o.remote_feed_guid),
    itemGuid: str(o.episode_guid) || str(o.item_guid),
    episode: str(o.episode),
    podcast: str(o.podcast),
    senderName: str(o.sender_name),
    appName: str(o.app_name),
    valueMsatTotal: total !== undefined ? Math.floor(total) : undefined,
    ts: ts !== undefined && ts > 0 && ts <= 2147483647 ? ts : undefined,
  };
}

export function classifyRecord(r: HelipadRecord): StreamKind {
  if (r.action === 1) return 'stream';
  if (r.action === 4) return 'auto';
  return 'boost';
}

export function buildItdvFeedIndex(
  albums: { feedGuid?: string; title?: string }[],
  podcastGuid: string,
  podcastTitle: string,
): ItdvFeedIndex {
  const index: ItdvFeedIndex = { guids: new Set(), titles: new Map(), titleByGuid: new Map() };
  const add = (guid: string | undefined, title: string | undefined) => {
    if (guid) index.guids.add(key(guid));
    if (title) index.titles.set(key(title), title);
    if (guid && title) index.titleByGuid.set(key(guid), title);
  };
  add(podcastGuid, podcastTitle);
  albums.forEach(album => add(album.feedGuid, album.title));
  return index;
}

/**
 * Whether a record is for an ITDV feed: the feed the listener plays (`guid`), or a song inside it
 * (`remote_feed_guid`, through valueTimeSplit). Without any guid in the boostagram, an exact
 * title match (case and outer spaces ignored) decides.
 */
export function matchItdvFeed(r: HelipadRecord, b: Boostagram | null, index: ItdvFeedIndex): ItdvMatch | null {
  const podcast = str(r.podcast) || (b ? b.podcast : undefined);
  if (b && b.feedGuid && index.guids.has(key(b.feedGuid))) {
    return { feedGuid: b.feedGuid, showTitle: index.titleByGuid.get(key(b.feedGuid)) || podcast || b.feedGuid, viaShow: null };
  }
  if (b && b.remoteFeedGuid && index.guids.has(key(b.remoteFeedGuid))) {
    const album = index.titleByGuid.get(key(b.remoteFeedGuid)) || str(r.remote_podcast) || b.remoteFeedGuid;
    return { feedGuid: b.remoteFeedGuid, showTitle: album, viaShow: podcast || null };
  }
  if (b && (b.feedGuid || b.remoteFeedGuid)) return null;
  const title = index.titles.get(key(podcast));
  return title ? { feedGuid: null, showTitle: title, viaShow: null } : null;
}

function isSent(r: HelipadRecord): boolean {
  return r.direction === 'outgoing' || !!r.payment_info;
}

/** Which split of the payment this record is: the receiving wallet's key, or the sent split's destination. */
function recipientOf(r: HelipadRecord): string {
  if (isSent(r) && r.payment_info) {
    return `${r.payment_info.pubkey || ''}:${r.payment_info.custom_value || ''}`;
  }
  return `${r.custom_key == null ? '' : r.custom_key}:${r.custom_value || ''}`;
}

/**
 * What every record of one listener payment shares. The playback position (ts) is not part of it:
 * a Lightning-address record (x-rss-payment) has none while the keysend splits of the same payment
 * do. assignPaymentKey uses ts instead to keep apart two payments that both carry one.
 */
export function paymentIdentity(n: NormalizedRecord): string {
  return [
    n.feedGuid ? key(n.feedGuid) : key(n.showTitle),
    n.itemKey,
    key(n.listener),
    key(n.app),
    n.value_msat_total == null ? '' : String(n.value_msat_total),
  ].join('|');
}

/** The record ready to store, or null when it is not for an ITDV feed. */
export function normalizeRecord(
  r: HelipadRecord,
  source: RecordSource,
  index: ItdvFeedIndex,
  nowSeconds: number,
): NormalizedRecord | null {
  const b = parseBoostagram(r.tlv);
  const match = matchItdvFeed(r, b, index);
  if (!match) return null;
  const itemTitle = str(r.episode) || (b ? b.episode : undefined) || '';
  const total = num(r.value_msat_total);
  const n: NormalizedRecord = {
    ...r,
    sender: str(r.sender) || (b ? b.senderName : undefined) || '',
    app: str(r.app) || (b ? b.appName : undefined) || '',
    value_msat_total: total !== undefined && total > 0 ? total : b ? b.valueMsatTotal : undefined,
    source,
    kind: classifyRecord(r),
    feedGuid: match.feedGuid,
    itemKey: (b && b.itemGuid ? key(b.itemGuid) : '') || key(itemTitle),
    listener: str(r.sender) || (b ? b.senderName : undefined) || 'Anonymous',
    showTitle: match.showTitle,
    itemTitle: itemTitle || match.showTitle,
    viaShow: match.viaShow,
    recipient: recipientOf(r),
    playbackTs: b && b.ts !== undefined ? b.ts : null,
    identity: '',
    time: num(r.time) || nowSeconds,
  };
  n.identity = paymentIdentity(n);
  return n;
}

/**
 * The payment key for a record, given the stored records with the same identity. A record joins
 * the oldest payment that has a record within PAYMENT_WINDOW_SECONDS and is still open to it:
 * - no record yet from the same source and recipient (a repeat is the next payment), and
 * - no record with another playback position, when both know one.
 * Otherwise a new key. The oldest, not the nearest: with a split that arrives up to ~90 s late,
 * the nearest open payment is often the next one, and a session would count one payment too many.
 */
export function assignPaymentKey(
  n: NormalizedRecord,
  candidates: PaymentCandidate[],
  newKey: () => string,
): string {
  const closed: Record<string, boolean> = {};
  const inWindow: Record<string, boolean> = {};
  const oldest: Record<string, number> = {};
  candidates.forEach(c => {
    if (c.source === n.source && c.recipient === n.recipient) closed[c.paymentKey] = true;
    if (n.playbackTs != null && c.playbackTs != null && c.playbackTs !== n.playbackTs) closed[c.paymentKey] = true;
    if (Math.abs(c.time - n.time) <= PAYMENT_WINDOW_SECONDS) inWindow[c.paymentKey] = true;
    if (oldest[c.paymentKey] === undefined || c.time < oldest[c.paymentKey]) oldest[c.paymentKey] = c.time;
  });
  let best: string | null = null;
  Object.keys(inWindow).forEach(k => {
    if (closed[k]) return;
    if (best === null || oldest[k] < oldest[best]) best = k;
  });
  return best === null ? newKey() : best;
}
