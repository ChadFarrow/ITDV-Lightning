/**
 * Shared safety checks for the media proxy routes (`/api/proxy-image`,
 * `/api/proxy-audio`, `/api/proxy-video`).
 *
 * These routes fetch a caller-supplied URL server-side and stream the result
 * back from our own origin. Three things follow from that and all are handled
 * here rather than in each route:
 *
 * 1. **The response is same-origin.** Passing an upstream `Content-Type`
 *    straight through means anyone could serve arbitrary HTML — and therefore
 *    script — from this domain via `?url=https://evil.example/x.html`. The
 *    media-type check below is what stops that, and every route applies it to
 *    the final response, after any redirect.
 * 2. **The fetch originates from our server.** The destination must be a
 *    public address. The address rules are NOT written here: they are the
 *    ones in `lib/safe-fetch.ts`, the same guard the feed parser uses, so
 *    there is one list. `validateProxyTarget` runs its literal check on the
 *    URL as written; `fetchProxyTarget` then goes through `safeFetch`, which
 *    resolves the name, checks every address DNS returns, and follows
 *    redirects by hand (at most 5), checking each hop the same way.
 * 3. **The upstream decides how long and how much.** `fetchProxyTarget` puts
 *    one time limit over the connection, every redirect and the body, and
 *    counts the body as it streams through, so a slow or endless upstream
 *    cannot hold a function open or push an unbounded body through it.
 *
 * Server only: `safe-fetch.ts` imports `node:dns/promises`.
 */
import { assertSafeFetchUrl, safeFetch } from './safe-fetch';

/**
 * IPv6 multicast (ff00::/8). The shared list in `safe-fetch.ts` has no rule for
 * it, and that file is a byte-identical copy of the PC20-Nostr recipe, so the
 * literal is refused here. TCP cannot connect to a multicast address, so a name
 * that resolves to one fails at connect; this only makes the refusal explicit.
 */
function isIPv6Multicast(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host.includes(':') && host.startsWith('ff');
}

export type ProxyTargetResult =
  | { ok: true; url: URL }
  | { ok: false; error: string; status: number };

/**
 * Parse and vet a caller-supplied proxy target, before any request is made.
 * Returns the parsed URL, or the reason it was rejected.
 *
 * HTTPS only on the way in. A redirect hop may be plain http: `safeFetch`
 * allows it (real podcast hosts still use it), and it checks the address of
 * that hop exactly as it checks the first one.
 */
export function validateProxyTarget(rawUrl: string | null | undefined): ProxyTargetResult {
  if (!rawUrl) {
    return { ok: false, error: 'Missing url parameter', status: 400 };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'Invalid URL format', status: 400 };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Only HTTPS URLs are allowed', status: 400 };
  }

  try {
    assertSafeFetchUrl(url.href);
  } catch {
    return { ok: false, error: 'Destination not allowed', status: 403 };
  }
  if (isIPv6Multicast(url.hostname)) {
    return { ok: false, error: 'Destination not allowed', status: 403 };
  }

  return { ok: true, url };
}

const MB = 1024 * 1024;

/**
 * Time and size limits per kind of media. The time limit covers the
 * connection, every redirect and the whole body: it is the same budget these
 * routes had before (15 s, 30 s for a GIF, 30 s for audio and video), because
 * it already ended streamed bodies in production and a shorter one would cut
 * playback. The size limit is per response (a Range request counts its own
 * part only) and sits well above the real files: on 2026-11-25 the largest
 * proxied GIF was 41.7 MB and the largest audio track 21.3 MB.
 */
export const MEDIA_LIMITS = {
  image: { timeoutMs: 15_000, maxBytes: 64 * MB },
  gif: { timeoutMs: 30_000, maxBytes: 64 * MB },
  audio: { timeoutMs: 30_000, maxBytes: 200 * MB },
  video: { timeoutMs: 30_000, maxBytes: 200 * MB },
  /**
   * An HLS playlist is read whole to rewrite it. A long video's media playlist
   * is large: on 2026-11-25 the CityBeach set (2.5 h) had 1.53 MB playlists.
   */
  playlist: { timeoutMs: 30_000, maxBytes: 8 * MB },
  /** A SplitKit page, read whole to find the stream in it. */
  page: { timeoutMs: 15_000, maxBytes: 2 * MB },
  /** A HEAD probe has no body. */
  probe: { timeoutMs: 10_000, maxBytes: 0 },
} as const;

export interface ProxyFetchLimits {
  timeoutMs: number;
  maxBytes: number;
}

export type ProxyFetchResult =
  | { ok: true; response: Response; body: ReadableStream<Uint8Array> | null }
  | { ok: false; status: number; error: string };

/**
 * Pass a body through while counting it. Past `maxBytes` the stream errors and
 * the upstream read is cancelled, which closes its socket. Pull-driven, so it
 * reads from upstream only as fast as the client takes the bytes, and it never
 * holds more than one chunk. Bytes delivered never exceed `maxBytes`.
 */
export function capStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        controller.error(error);
        return;
      }
      if (chunk.done) {
        controller.close();
        return;
      }
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        controller.error(new Error(`response too large (exceeded ${maxBytes} bytes)`));
        return;
      }
      controller.enqueue(chunk.value);
    },
    cancel(reason) {
      // The client went away: stop reading from upstream too.
      return reader.cancel(reason).catch(() => {});
    },
  });
}

/**
 * Fetch a vetted proxy target inside the limits.
 *
 * - The address guard, DNS check and redirect checks are `safeFetch`'s.
 * - One `AbortSignal.timeout` covers connection, redirects and body.
 * - A declared `Content-Length` over the cap is refused before any body is
 *   read; the body is counted as it streams in any case (a length can be
 *   missing or false).
 * - `Accept-Encoding: identity`: media is already compressed, and a
 *   compressed upstream would make the forwarded `Content-Length` wrong and let
 *   a small download expand past the cap's intent.
 *
 * Failures come back as one fixed message per kind, never the underlying
 * error: those name the host and tell "does not resolve" from "resolves to a
 * private address".
 */
export async function fetchProxyTarget(
  url: URL | string,
  limits: ProxyFetchLimits,
  init: { method?: string; headers?: Record<string, string> } = {}
): Promise<ProxyFetchResult> {
  let response: Response;
  try {
    response = await safeFetch(String(url), {
      method: init.method,
      headers: { ...init.headers, 'Accept-Encoding': 'identity' },
      signal: AbortSignal.timeout(limits.timeoutMs),
    });
  } catch (error) {
    return { ok: false, ...describeFetchFailure(error) };
  }

  const declared = Number(response.headers.get('content-length'));
  if (init.method !== 'HEAD' && Number.isFinite(declared) && declared > limits.maxBytes) {
    await response.body?.cancel().catch(() => {});
    return { ok: false, status: 502, error: 'Upstream response too large' };
  }

  return {
    ok: true,
    response,
    body: response.body ? capStream(response.body, limits.maxBytes) : null,
  };
}

function describeFetchFailure(error: unknown): { status: number; error: string } {
  const e = error as { name?: string; message?: string; cause?: { name?: string } } | undefined;
  const message = String(e?.message ?? '');
  if (message.startsWith('unsafe fetch url (too many redirects)')) {
    return { status: 502, error: 'Too many redirects' };
  }
  if (message.startsWith('unsafe fetch url')) {
    return { status: 403, error: 'Destination not allowed' };
  }
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || e?.cause?.name === 'TimeoutError') {
    return { status: 504, error: 'Upstream timed out' };
  }
  return { status: 502, error: 'Upstream fetch failed' };
}

/**
 * The upstream `Content-Length`, when it is the length of the body we pass on.
 * With a `Content-Encoding` other than identity, `fetch` decodes the body, so
 * the declared (encoded) length would be wrong.
 */
export function forwardableLength(response: Response): string | null {
  const encoding = (response.headers.get('content-encoding') || '').trim().toLowerCase();
  if (encoding && encoding !== 'identity') return null;
  return response.headers.get('content-length');
}

/** Read a capped proxy body as text. Throws past the cap or on timeout. */
export async function readProxyText(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return '';
  return new Response(body).text();
}

/**
 * Media types a browser will execute or render as a document. Serving any of
 * these from our origin turns the proxy into an XSS primitive, so they are
 * refused outright regardless of which proxy route asked.
 */
const ACTIVE_CONTENT_TYPES = [
  'text/html',
  'application/xhtml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'application/pdf',
];

/**
 * Check an upstream Content-Type against what the route is willing to serve.
 *
 * `allowedPrefixes` are matched against the bare media type, e.g. `['image/']`.
 * `application/octet-stream` is accepted when `allowOctetStream` is set —
 * plenty of podcast hosts serve MP3s that way, and an opaque byte stream is not
 * something a browser will execute.
 */
export function isAllowedMediaType(
  contentType: string | null,
  allowedPrefixes: string[],
  { allowOctetStream = false }: { allowOctetStream?: boolean } = {}
): boolean {
  if (!contentType) return allowOctetStream;

  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  if (ACTIVE_CONTENT_TYPES.some((blocked) => mediaType.startsWith(blocked))) return false;
  if (allowOctetStream && mediaType === 'application/octet-stream') return true;

  return allowedPrefixes.some((prefix) => mediaType.startsWith(prefix));
}

/**
 * SVG is a legitimate `image/*` type that can carry script, so it can't just be
 * waved through by the media-type check. Callers serve it with these headers,
 * which stop it being used as a script host while still letting it render as
 * an image inside an `<img>` tag.
 */
export function hardeningHeadersFor(contentType: string | null): Record<string, string> {
  const mediaType = (contentType || '').split(';')[0].trim().toLowerCase();
  const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff' };

  if (mediaType === 'image/svg+xml') {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    headers['Content-Disposition'] = 'attachment';
  }

  return headers;
}
