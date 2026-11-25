/**
 * Server-side fetch for URLs that come from a feed or from an admin: the RSS
 * feeds that `lib/rss-parser.ts` parses, and the chapters files those feeds
 * name. Every such URL is untrusted — a podroll or remoteItem walk follows
 * whatever another feed says, and a public feed can name any chapters URL.
 *
 * Three limits, and each one closes a hole the plain `fetch(feedUrl)` had:
 *
 * - **Address guard.** `safeFetch` (lib/safe-fetch.ts) refuses loopback,
 *   RFC 1918, link-local, cloud metadata and the other special-use ranges, in
 *   every spelling, on every redirect hop, and again on each address DNS
 *   returns. It also forces `cache: 'no-store'`, so Next's data cache cannot
 *   read a body around the size cap.
 * - **Time limit.** One `AbortSignal.timeout` covers the connection, every
 *   redirect and the body, so a server that drips one byte a second cannot
 *   hold a function open.
 * - **Size limit.** `readCappedText` (lib/capped-body.ts) counts bytes as they
 *   arrive and stops past the cap; a missing or lying Content-Length does not
 *   help.
 *
 * `safe-fetch.ts` and `capped-body.ts` are the PC20-Nostr catalog recipe
 * `safe-feed-fetch` (boostmebitch 815c551f, MIT), byte-identical. Keep them that
 * way, so a fix there can be copied over. Their own tests live in
 * `scripts/check-feed-fetch.ts`, with the tests for this file.
 *
 * Server only: safe-fetch imports `node:dns/promises`. Nothing in a browser
 * bundle may import this file, or `lib/rss-parser.ts`, other than for types.
 */
import { safeFetch } from './safe-fetch';
import { readCappedText } from './capped-body';

/** Per request, redirects and body included. Real ITDV feeds answer in well under 2 s. */
export const FEED_TIMEOUT_MS = 10_000;
/** Larger than any real RSS feed (the biggest ITDV album feed is well under 1 MB). */
export const FEED_MAX_BYTES = 8 * 1024 * 1024;
/** A chapters JSON file is a few KB. */
export const CHAPTERS_MAX_BYTES = 1024 * 1024;

const USER_AGENT = 'ITDV-Lightning/1.0 (+https://itdv.podtards.com)';

export type FeedFetchReason = 'refused' | 'timeout' | 'too-large' | 'http' | 'network';

/**
 * Why a fetch failed. `reason` lets a caller decide whether to retry: a refused
 * address or an oversized body will not get better on a second try.
 * The message can name the host; it is for logs, not for an HTTP answer.
 */
export class FeedFetchError extends Error {
  constructor(
    message: string,
    public readonly reason: FeedFetchReason,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'FeedFetchError';
  }
}

function classify(error: unknown): FeedFetchError {
  if (error instanceof FeedFetchError) return error;
  const e = error as { name?: string; message?: string; cause?: { name?: string } } | undefined;
  const message = String(e?.message ?? error);
  // The two vendored files throw plain Errors with these fixed prefixes;
  // scripts/check-feed-fetch.ts pins both, so a change there fails the check.
  if (message.startsWith('unsafe fetch url')) return new FeedFetchError(message, 'refused');
  if (message.startsWith('response too large')) return new FeedFetchError(message, 'too-large');
  // AbortSignal.timeout rejects with a DOMException named TimeoutError; undici
  // can wrap it as the cause of a TypeError while the body is streaming.
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || e?.cause?.name === 'TimeoutError') {
    return new FeedFetchError('feed fetch timed out', 'timeout');
  }
  return new FeedFetchError(message, 'network');
}

export interface FeedFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
}

/**
 * Fetch an untrusted URL and return its body as text, inside all three limits.
 * Throws a {@link FeedFetchError} for a refused address, a timeout, an
 * oversized body, a non-2xx answer or a network failure.
 */
export async function fetchUntrustedText(url: string, options: FeedFetchOptions = {}): Promise<string> {
  const {
    timeoutMs = FEED_TIMEOUT_MS,
    maxBytes = FEED_MAX_BYTES,
    accept = 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
  } = options;

  let res: Response;
  try {
    res = await safeFetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
    });
  } catch (error) {
    throw classify(error);
  }

  if (!res.ok) {
    // Release the socket; the body of an error page is not needed.
    await res.body?.cancel().catch(() => {});
    throw new FeedFetchError(`feed answered ${res.status}`, 'http', res.status);
  }

  try {
    return await readCappedText(res, maxBytes);
  } catch (error) {
    throw classify(error);
  }
}

/** {@link fetchUntrustedText} for a JSON file (a chapters file), with a 1 MB cap by default. */
export async function fetchUntrustedJson(url: string, options: FeedFetchOptions = {}): Promise<unknown> {
  const text = await fetchUntrustedText(url, {
    maxBytes: CHAPTERS_MAX_BYTES,
    accept: 'application/json, */*;q=0.8',
    ...options,
  });
  return JSON.parse(text);
}
