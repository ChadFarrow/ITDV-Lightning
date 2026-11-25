/**
 * Rewrite the links in an HLS playlist so the player fetches every one of them
 * through `/api/proxy-video`.
 *
 * The rule is the playlist format's own (RFC 8216, section 4.1), not a guess
 * from file names: each line is blank, a comment or tag (starts with `#`), or a
 * URI; and a tag carries its links as a `URI="…"` attribute (`EXT-X-MEDIA`,
 * `EXT-X-MAP`, `EXT-X-KEY`, `EXT-X-SESSION-KEY`, `EXT-X-I-FRAME-STREAM-INF`,
 * `EXT-X-PART`, `EXT-X-PRELOAD-HINT`, `EXT-X-RENDITION-REPORT` …). Each link is
 * resolved against the playlist's own URL, so relative (`seg_1.ts`,
 * `../../<id>/video/720/seg_1.mp4?p=…`), root-relative and absolute links all
 * take one path.
 *
 * Until 2026-11-25 the route proxied a line only when its name matched a list
 * of patterns (`.m3u8`, `.ts`, `segment_N.ts` …). Cloudflare Stream's media
 * playlists name their segments `../../<id>/video/<n>/seg_N.mp4?p=…`, so those
 * lines stayed relative, the player resolved them against this site, got a 404
 * and stopped after the init segment.
 *
 * The rewritten links are root-relative (`/api/proxy-video?url=…`): the player
 * resolves them against the playlist URL, which is on this site. So the body
 * does not depend on the request's Host header, and it is smaller.
 *
 * This module only writes links. It makes no request and does not decide what
 * may be fetched: each rewritten link comes back to the video route, which
 * checks it with the shared guard (host allow-list, address check after DNS,
 * every redirect, media type, time and size limits) like any other request.
 * Only `http:` and `https:` links are rewritten; `data:`, `skd:` and other
 * schemes are left as they are.
 */

export const PROXY_VIDEO_PATH = '/api/proxy-video';

/** The proxy link for one absolute upstream URL. */
export function proxiedVideoUrl(absoluteUrl: string): string {
  return `${PROXY_VIDEO_PATH}?url=${encodeURIComponent(absoluteUrl)}`;
}

/** Resolve one playlist reference and return its proxy link, or null to leave it. */
function proxyRef(ref: string, base: URL): string | null {
  let resolved: URL;
  try {
    resolved = new URL(ref, base);
  } catch {
    return null;
  }
  if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return null;
  return proxiedVideoUrl(resolved.href);
}

/** A `URI="…"` attribute, at the start of the attribute list or after a comma. */
const URI_ATTRIBUTE = /(^|[:,])URI="([^"]*)"/g;

/**
 * Rewrite every link in `text`, a playlist fetched from `playlistUrl` (the URL
 * of the final response, after any redirect). Line endings (LF or CRLF) and
 * every other byte of the playlist are kept.
 */
export function rewriteHlsPlaylist(text: string, playlistUrl: string | URL): string {
  const base = new URL(String(playlistUrl));
  return text
    .split('\n')
    .map((line) => {
      const cr = line.endsWith('\r') ? '\r' : '';
      const content = cr ? line.slice(0, -1) : line;
      const trimmed = content.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        // A tag (#EXT…) may carry links; any other # line is a comment.
        if (!trimmed.startsWith('#EXT')) return line;
        return (
          content.replace(URI_ATTRIBUTE, (match, lead: string, ref: string) => {
            const proxied = proxyRef(ref, base);
            return proxied === null ? match : `${lead}URI="${proxied}"`;
          }) + cr
        );
      }
      const proxied = proxyRef(trimmed, base);
      return proxied === null ? line : proxied + cr;
    })
    .join('\n');
}
