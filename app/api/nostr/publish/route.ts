import { NextRequest, NextResponse } from 'next/server';
import { nip19 } from 'nostr-tools';
import { BoostToNostrService, type TrackMetadata } from '@/lib/boost-to-nostr-service';
import { publishToRelays } from '@/lib/relay-publish';

/**
 * Sign and publish a boost note as the site's Nostr identity.
 *
 * The site key used to be read client-side from NEXT_PUBLIC_SITE_NOSTR_NSEC.
 * Next inlines every NEXT_PUBLIC_* value into the client bundle at build time,
 * so that shipped the site's *private* key to every visitor — and a Nostr
 * identity cannot be rotated without abandoning it. The key now lives in
 * SITE_NOSTR_NSEC (server-only) and never leaves this process.
 *
 * Because this endpoint signs as the site, it is deliberately narrow: it builds
 * the event itself from validated boost fields rather than signing a
 * caller-supplied event, so it can only ever emit a boost note.
 */

export const runtime = 'nodejs';
// Signing must never be served from a cache.
export const dynamic = 'force-dynamic';

const MAX_COMMENT_LENGTH = 500;
const MAX_FIELD_LENGTH = 300;
const MAX_AMOUNT_SATS = 100_000_000; // 1 BTC — a sanity bound, not a payment check

// Best-effort per-instance throttle. This endpoint posts under the site's
// identity, so it needs some ceiling even though the real limit would need a
// shared store to be robust across serverless instances.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const MAX_TRACKED_IPS = 5_000;
const recentPosts = new Map<string, number[]>();

function getClientIP(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;

  const timestamps = (recentPosts.get(ip) || []).filter((t) => t > cutoff);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    recentPosts.set(ip, timestamps);
    return true;
  }

  timestamps.push(now);
  recentPosts.set(ip, timestamps);

  // Drop IPs whose window has fully elapsed so the map cannot grow unbounded.
  if (recentPosts.size > MAX_TRACKED_IPS) {
    const stale: string[] = [];
    recentPosts.forEach((times, key) => {
      if (times.every((t) => t <= cutoff)) stale.push(key);
    });
    stale.forEach((key) => recentPosts.delete(key));
  }

  return false;
}

/** Coerce to a trimmed, length-capped string, or undefined if absent/not a string. */
function cleanString(value: unknown, maxLength = MAX_FIELD_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function decodeSiteSecretKey(): Uint8Array | null {
  const nsec = process.env.SITE_NOSTR_NSEC;
  if (!nsec) return null;

  try {
    const { type, data } = nip19.decode(nsec);
    if (type !== 'nsec' || !(data instanceof Uint8Array)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const secretKey = decodeSiteSecretKey();
  if (!secretKey) {
    // The client does not fall back to another key: when NEXT_PUBLIC_SITE_NOSTR_NPUB
    // is set, this is the only way a boost note gets posted, so a missing
    // SITE_NOSTR_NSEC means no notes at all. Say so without leaking whether the
    // var is unset or malformed.
    return NextResponse.json(
      { success: false, error: 'Site Nostr identity is not configured' },
      { status: 503 }
    );
  }

  if (isRateLimited(getClientIP(request))) {
    return NextResponse.json(
      { success: false, error: 'Too many boosts, please slow down' },
      { status: 429 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT_SATS) {
    return NextResponse.json({ success: false, error: 'Invalid amount' }, { status: 400 });
  }

  const title = cleanString(body?.track?.title);
  if (!title) {
    return NextResponse.json({ success: false, error: 'Track title is required' }, { status: 400 });
  }

  // Rebuild the track from known fields only — never spread caller input into
  // the event, or arbitrary keys could ride along into the signed note.
  const track: TrackMetadata = {
    title,
    artist: cleanString(body?.track?.artist) || '',
    album: cleanString(body?.track?.album),
    url: cleanString(body?.track?.url, 500),
    imageUrl: cleanString(body?.track?.imageUrl, 500),
    guid: cleanString(body?.track?.guid),
    podcastGuid: cleanString(body?.track?.podcastGuid),
    feedGuid: cleanString(body?.track?.feedGuid),
    feedUrl: cleanString(body?.track?.feedUrl, 500),
    publisherGuid: cleanString(body?.track?.publisherGuid),
    publisherUrl: cleanString(body?.track?.publisherUrl, 500),
  };

  const comment = cleanString(body?.comment, MAX_COMMENT_LENGTH);

  try {
    const service = new BoostToNostrService([], secretKey);
    const { event } = service.signBoost({
      amount,
      track,
      comment,
      tags: track.artist
        ? [`#${track.artist.replace(/\s+/g, '')}`, '#nowplaying']
        : ['#nowplaying'],
    });

    // Wait for the relays before answering. postBoost publishes in the background,
    // and a Vercel function stops once it has answered, so from 2026-08-04 to
    // 2026-10-30 every boost was signed, reported as a success, and never reached
    // a relay. Success now means at least one relay sent its OK.
    const published = await publishToRelays(event, service.getRelays());
    console.log(
      `Nostr boost ${event.id}: ${published.accepted.length} relay(s) accepted, ${published.failed.length} failed`,
      published.failed
    );

    if (published.accepted.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No relay accepted the boost note' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      eventId: event.id,
      event,
      relays: published.accepted,
    });
  } catch (error) {
    console.error('Nostr publish error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to publish boost' },
      { status: 500 }
    );
  }
}
