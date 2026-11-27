// Assertions for the media proxies (/api/proxy-image, /api/proxy-audio,
// /api/proxy-video): the address guard, the redirect checks, the time limit, the
// size limit and the media-type check, run against the route handlers
// themselves, not only the guard, so a route that went back to a plain fetch fails.
//
//   npx tsx scripts/check-media-proxy.ts
//   CHECK_SKIP_SLOW=1 npx tsx scripts/check-media-proxy.ts   # skip the ~30 s timeout cases
//
// No network except DNS: one group asks DNS about 127.0.0.1.nip.io (a public
// wildcard name that answers 127.0.0.1), and the video cases resolve op3.dev and
// the allowed video hosts, because the guard checks every address DNS returns.
// Without DNS those cases print SKIP, not ok.
//
// A real HTTP server on loopback plays the upstream. The guard refuses loopback,
// so to reach it a stub of globalThis.fetch sends the public address
// 93.184.215.14 and the allowed video host names to the local server and passes
// `init` through unchanged; the real AbortSignal and the real socket do the work.
// Any other host reaching the stub is a guard failure: the stub records it and
// rejects. Shipped code has no bypass.

import http from 'node:http';
import { lookup } from 'node:dns/promises';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { GET as imageGET } from '../app/api/proxy-image/route';
import { GET as audioGET } from '../app/api/proxy-audio/route';
import { GET as videoGET } from '../app/api/proxy-video/route';
import { MEDIA_LIMITS, validateProxyTarget } from '../lib/proxy-guard';
import { USER_AGENT } from '../lib/user-agent';

let bad = 0;
let passed = 0;
let skipped = 0;
const out = (m: string) => process.stdout.write(m + '\n');
const fail = (m: string) => { out('FAIL   ' + m); bad++; };
const ok = (m: string) => { out('ok     ' + m); passed++; };
const skip = (m: string) => { out('SKIP   ' + m); skipped++; };
const check = (cond: boolean, m: string) => (cond ? ok(m) : fail(m));
const SKIP_SLOW = process.env.CHECK_SKIP_SLOW === '1';

// The routes log; keep this output to the results.
const quiet = { log: console.log, warn: console.warn, error: console.error };
console.log = () => {}; console.warn = () => {}; console.error = () => {};

// --- the upstream: a real server on loopback ---------------------------------

const PUBLIC = '93.184.215.14';
const VIDEO_HOSTS = ['op3.dev', 'customer-dlnbepb8zpz7h846.cloudflarestream.com', 'www.thesplitkit.com'];
const hits: string[] = [];
const streams: Record<string, { written: number; closed: boolean }> = {};
let port = 0;

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const MP3 = Buffer.alloc(4096, 0x55);

function endless(req: http.IncomingMessage, res: http.ServerResponse, key: string, line?: string) {
  const stat: { written: number; closed: boolean } = { written: 0, closed: false };
  streams[key] = stat;
  const chunk = line ? Buffer.from(line.repeat(Math.ceil(65536 / line.length))) : Buffer.alloc(65536, 0x41);
  res.on('close', () => { stat.closed = true; });
  const pump = () => {
    while (!stat.closed) {
      stat.written += chunk.length;
      if (!res.write(chunk)) { res.once('drain', pump); return; }
    }
  };
  pump();
}

// Cloudflare Stream shapes (made-up tokens): a master, its media playlists with
// `../../<id>/video/240/seg_N.mp4?p=…` links, an init segment, a key, and links
// the guard must refuse once the player asks for them.
const SEG = Buffer.alloc(2048, 0x47).toString('latin1');
const INIT = 'ftyp-init-segment';
const HLS_TOKEN = 'p=eyJ0Ijoic2VnIn0+/=&s=AbC-d_e';
const HLS_FIXTURES: Record<string, [string, string]> = {
  '/0123abcd/manifest/video.m3u8': ['application/vnd.apple.mpegurl', [
    '#EXTM3U', '#EXT-X-VERSION:6',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="original",DEFAULT=YES,URI="stream_a.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1029326,CODECS="avc1.42c015,mp4a.40.2",AUDIO="a"', 'stream_v.m3u8', '',
  ].join('\n')],
  '/0123abcd/manifest/stream_v.m3u8': ['application/vnd.apple.mpegurl', [
    '#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-TARGETDURATION:5',
    `#EXT-X-MAP:URI="../../0123abcd/video/240/init.mp4?${HLS_TOKEN}"`,
    '#EXT-X-KEY:METHOD=AES-128,URI="../../0123abcd/key.bin"',
    '#EXTINF:4.0,', `../../0123abcd/video/240/seg_1.mp4?${HLS_TOKEN}`,
    '#EXTINF:4.0,', '../../0123abcd/video/240/evil.mp4',
    '#EXTINF:4.0,', 'https://127.0.0.1/secret-seg.mp4',
    '#EXTINF:4.0,', `https://${PUBLIC}/foreign.mp4`,
    '#EXTINF:4.0,', 'http://customer-dlnbepb8zpz7h846.cloudflarestream.com/plain.mp4',
    '#EXT-X-ENDLIST', '',
  ].join('\n')],
  '/0123abcd/manifest/stream_a.m3u8': ['application/vnd.apple.mpegurl',
    '#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:4.0,\n../../0123abcd/audio/131/seg_1.mp4?p=x\n#EXT-X-ENDLIST\n'],
  '/0123abcd/video/240/init.mp4': ['video/mp4', INIT],
  '/0123abcd/video/240/seg_1.mp4': ['video/mp4', SEG],
  '/0123abcd/video/240/evil.mp4': ['text/html', '<script>alert(1)</script>'],
  '/0123abcd/audio/131/seg_1.mp4': ['audio/mp4', SEG],
  '/0123abcd/key.bin': ['application/octet-stream', '0123456789abcdef'],
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://x');
  hits.push(u.pathname + u.search);
  const type = u.searchParams.get('type') || 'image/png';
  lastHeaders = req.headers;
  agents.push([`${req.method} ${u.pathname}`, String(req.headers['user-agent'])]);
  switch (u.pathname) {
    case '/img.png':
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length, ETag: '"v1"' });
      res.end(PNG);
      return;
    case '/etag.png':
      if (req.headers['if-none-match'] === '"v1"') { res.writeHead(304, { ETag: '"v1"' }); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'image/png', ETag: '"v1"' });
      res.end(PNG);
      return;
    case '/audio.mp3': {
      const m = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range || ''));
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : MP3.length - 1;
        res.writeHead(206, {
          'Content-Type': 'audio/mpeg',
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${MP3.length}`,
          'Accept-Ranges': 'bytes',
        });
        res.end(MP3.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': MP3.length });
      res.end(MP3);
      return;
    }
    case '/page.html':
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<script>alert(1)</script>');
      return;
    case '/redirect':
      res.writeHead(302, { Location: u.searchParams.get('to') || '/' });
      res.end();
      return;
    case '/loop':
      res.writeHead(302, { Location: '/loop' });
      res.end();
      return;
    case '/huge-declared':
      // Claims 10 GB, sends a little, then waits. The route must refuse on the header.
      streams['/huge-declared'] = { written: 0, closed: false };
      res.on('close', () => { streams['/huge-declared'].closed = true; });
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': String(10 * 1024 ** 3) });
      res.write(Buffer.alloc(1024));
      return;
    case '/huge-stream':
      res.writeHead(200, { 'Content-Type': type }); // chunked, no length
      endless(req, res, '/huge-stream' + type);
      return;
    case '/huge-playlist.m3u8':
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      endless(req, res, '/huge-playlist', 'segment_1.ts\n');
      return;
    case '/playlist.m3u8':
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment_1.ts\n#EXT-X-ENDLIST\n');
      return;
    case '/hang':
      streams['/hang' + u.search] = { written: 0, closed: false };
      req.socket.on('close', () => { streams['/hang' + u.search].closed = true; });
      return; // never answers
    case '/drip': {
      const key = '/drip' + u.search;
      streams[key] = { written: 0, closed: false };
      res.writeHead(200, { 'Content-Type': type });
      const t = setInterval(() => { res.write('x'); streams[key].written++; }, 500);
      res.on('close', () => { clearInterval(t); streams[key].closed = true; });
      return;
    }
    case '/live/huge-page':
      // An endless SplitKit page. Each request gets its own counter.
      res.writeHead(200, { 'Content-Type': 'text/html' });
      endless(req, res, `/live/huge-page#${++pageRequests}`, '<p>filler</p>');
      return;
    case '/live/probe-page':
      // No stream in the page, so the route probes /live/probe-page/*.m3u8.
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<p>no stream here</p>');
      return;
    case '/live/splitkit':
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<video src="http://127.0.0.1:${port}/secret.m3u8"></video>`);
      return;
    default:
      if (HLS_FIXTURES[u.pathname]) {
        const [ctype, body] = HLS_FIXTURES[u.pathname];
        res.writeHead(200, { 'Content-Type': ctype, 'Content-Length': Buffer.byteLength(body) });
        res.end(body);
        return;
      }
      if (u.pathname === '/a/b/c/d/redir.m3u8') {
        res.writeHead(302, { Location: '/0123abcd/manifest/stream_v.m3u8' });
        res.end();
        return;
      }
      if (u.pathname.startsWith('/live/probe-page/')) {
        res.writeHead(302, { Location: `http://127.0.0.1:${port}/secret-probe` });
        res.end();
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('no');
  }
});
let lastHeaders: http.IncomingHttpHeaders = {};
/** Method, path and User-Agent of every upstream request the routes made. */
const agents: [string, string][] = [];
let pageRequests = 0;

// --- the fetch stub -----------------------------------------------------------

const realFetch = globalThis.fetch;
const stubbed: string[] = []; // hosts the guard let through that the stub cannot serve
let fetchCalls = 0;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  fetchCalls++;
  const u = new URL(input instanceof Request ? input.url : String(input));
  if (u.hostname === PUBLIC || VIDEO_HOSTS.includes(u.hostname)) {
    // A real fetch reports the URL it asked for; the video route resolves
    // playlist links against it, so the stub must not show the loopback one.
    return realFetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, init).then((res) => {
      Object.defineProperty(res, 'url', { value: u.href });
      return res;
    });
  }
  stubbed.push(u.href);
  return Promise.reject(new Error('test stub: guard let through ' + u.hostname));
}) as typeof fetch;

type Handler = (req: NextRequest) => Promise<Response>;
const ROUTES: [string, Handler, string][] = [
  ['image', imageGET as Handler, '/api/proxy-image'],
  ['audio', audioGET as Handler, '/api/proxy-audio'],
  ['video', videoGET as Handler, '/api/proxy-video'],
];

function call(handler: Handler, route: string, target: string, headers: Record<string, string> = {}) {
  return handler(new NextRequest(`http://localhost${route}?url=${encodeURIComponent(target)}`, { headers }));
}

// Reads a body to its end or its error. Stops by itself past `maxRead`, so a
// route without its size limit fails the check instead of reading forever.
async function drain(res: Response, maxRead = 512 * 1024 * 1024): Promise<{ bytes: number; error: boolean }> {
  if (!res.body) return { bytes: 0, error: false };
  const reader = res.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { bytes, error: false };
      bytes += value.byteLength;
      if (bytes > maxRead) { await reader.cancel().catch(() => {}); return { bytes, error: false }; }
    }
  } catch {
    return { bytes, error: true };
  }
}

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}

async function hasDns(name: string): Promise<boolean> {
  try { await lookup(name); return true; } catch { return false; }
}

// Refused as written, before any request. Each line is one rule of the shared
// list in lib/safe-fetch.ts (or the local IPv6 multicast rule).
const LITERALS: [string, string][] = [
  ['https://localhost/x.png', 'localhost'],
  ['https://localhost./x.png', 'localhost. (trailing dot)'],
  ['https://app.localhost/x.png', '*.localhost'],
  ['https://printer.local/x.png', '*.local'],
  ['https://metadata.google.internal/x.png', '*.internal'],
  ['https://metadata.google.internal./x.png', '*.internal. (trailing dot)'],
  ['https://127.0.0.1/x.png', '127.0.0.1'],
  ['https://user@127.0.0.1/x.png', 'userinfo before 127.0.0.1'],
  ['https://0.0.0.0/x.png', '0.0.0.0 (unspecified)'],
  ['https://10.1.2.3/x.png', '10/8'],
  ['https://172.16.0.1/x.png', '172.16/12'],
  ['https://192.168.1.1/x.png', '192.168/16'],
  ['https://169.254.169.254/latest/meta-data/', '169.254.169.254 (metadata)'],
  ['https://100.64.0.1/x.png', '100.64/10 (CGNAT)'],
  ['https://224.0.0.1/x.png', '224/4 (multicast)'],
  ['https://240.0.0.1/x.png', '240/4 (reserved)'],
  ['https://192.0.0.1/x.png', '192.0.0/24'],
  ['https://192.0.2.1/x.png', 'TEST-NET-1'],
  ['https://198.51.100.1/x.png', 'TEST-NET-2'],
  ['https://203.0.113.1/x.png', 'TEST-NET-3'],
  ['https://198.18.0.1/x.png', '198.18/15'],
  ['https://192.88.99.1/x.png', '192.88.99/24'],
  ['https://2130706433/x.png', 'decimal 127.0.0.1'],
  ['https://0177.0.0.1/x.png', 'octal 127.0.0.1'],
  ['https://0x7f.0.0.1/x.png', 'hex 127.0.0.1'],
  ['https://127.1/x.png', 'short 127.0.0.1'],
  ['https://[::1]/x.png', '[::1]'],
  ['https://[::]/x.png', '[::] (unspecified)'],
  ['https://[::ffff:127.0.0.1]/x.png', '[::ffff:127.0.0.1] (mapped, dotted)'],
  ['https://[::ffff:7f00:1]/x.png', '[::ffff:7f00:1] (mapped, hex)'],
  ['https://[::ffff:a9fe:a9fe]/x.png', '[::ffff:a9fe:a9fe] (mapped metadata)'],
  ['https://[::7f00:1]/x.png', '[::7f00:1] (v4-compatible)'],
  ['https://[64:ff9b::7f00:1]/x.png', '[64:ff9b::7f00:1] (NAT64 127.0.0.1)'],
  ['https://[64:ff9b::a9fe:a9fe]/x.png', '[64:ff9b::a9fe:a9fe] (NAT64 metadata)'],
  ['https://[fe80::1]/x.png', 'fe80::/10 (link-local)'],
  ['https://[fec0::1]/x.png', 'fec0::/10 (site-local)'],
  ['https://[fd00::1]/x.png', 'fd00::/8 (unique-local)'],
  ['https://[fc00::1]/x.png', 'fc00::/8 (unique-local)'],
  ['https://[2002:7f00:1::]/x.png', '2002::/16 (6to4)'],
  ['https://[2001::1]/x.png', '2001::/32 (Teredo)'],
  ['https://[100::1]/x.png', '100::/64 (discard)'],
  ['https://[ff02::1]/x.png', 'ff00::/8 (IPv6 multicast)'],
];

const privateRedirects = () => [
  [`http://127.0.0.1:${port}/secret`, '127.0.0.1'],
  [`http://localhost:${port}/secret`, 'localhost'],
  ['http://169.254.169.254/latest/meta-data/', '169.254.169.254'],
  [`http://[::ffff:7f00:1]:${port}/secret`, '[::ffff:7f00:1]'],
  [`http://10.0.0.1:${port}/secret`, '10/8'],
];

async function main() {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as AddressInfo).port;
  const dnsNip = await hasDns('127.0.0.1.nip.io');
  const dnsVideo = (await Promise.all(VIDEO_HOSTS.map(hasDns))).every(Boolean);

  // --- 0. the guard itself -------------------------------------------------
  // safeFetch checks the first hop again, so the routes alone cannot show that
  // validateProxyTarget still calls the shared list. This does.
  out('== 0. validateProxyTarget refuses every private form');
  {
    const missed = LITERALS.filter(([url]) => {
      const r = validateProxyTarget(url);
      return r.ok || r.status !== 403;
    });
    check(missed.length === 0, `validateProxyTarget: ${LITERALS.length} forms refused with 403${missed.length ? ' (missed: ' + missed.map((m) => m[1]).join(', ') + ')' : ''}`);
    const pub = validateProxyTarget(`https://${PUBLIC}/x.png`);
    check(pub.ok, 'validateProxyTarget: a public https URL passes');
  }

  // --- 1. refused as written: no request leaves ---------------------------
  out('== 1. private addresses as written (every route, no request made)');
  for (const [name, handler, route] of ROUTES) {
    let allOk = true;
    for (const [url, label] of LITERALS) {
      const before = fetchCalls;
      const res = await call(handler, route, url);
      if (res.status !== 403 || fetchCalls !== before) {
        fail(`${name}: ${label} -> ${res.status}, fetch calls ${fetchCalls - before} (want 403, 0)`);
        allOk = false;
      }
    }
    if (allOk) ok(`${name}: ${LITERALS.length} private forms refused with 403, no fetch`);
    const http1 = await call(handler, route, `http://${PUBLIC}/x.png`);
    check(http1.status === 400, `${name}: plain http:// refused with 400 (got ${http1.status})`);
  }

  // --- 2. a public name that resolves to 127.0.0.1 ------------------------
  out('== 2. a name that resolves to a private address');
  if (!dnsNip) {
    skip('no DNS: 127.0.0.1.nip.io not checked');
  } else {
    for (const [name, handler, route] of ROUTES) {
      if (name === 'video') continue; // its host allowlist answers first
      const before = fetchCalls;
      const res = await call(handler, route, 'https://127.0.0.1.nip.io/x.png');
      const text = await res.text();
      check(res.status === 403 && fetchCalls === before,
        `${name}: 127.0.0.1.nip.io refused with 403 after DNS, no fetch (got ${res.status}, ${fetchCalls - before})`);
      check(text.includes('Destination not allowed') && !text.includes('nip.io') && !text.includes('resolve'),
        `${name}: the refusal does not name the host or say why (body ${text})`);
    }
  }

  // --- 3. redirects --------------------------------------------------------
  out('== 3. redirects are checked on every hop');
  for (const [name, handler, route] of ROUTES) {
    const origin = name === 'video' ? 'https://op3.dev' : `https://${PUBLIC}`;
    if (name === 'video' && !dnsVideo) { skip('video: no DNS for the allowed hosts'); continue; }
    for (const [to, label] of privateRedirects()) {
      const hitsBefore = hits.filter((h) => h.startsWith('/secret')).length;
      const strayBefore = stubbed.length;
      const res = await call(handler, route, `${origin}/redirect?to=${encodeURIComponent(to)}`);
      const secretHits = hits.filter((h) => h.startsWith('/secret')).length - hitsBefore;
      check(res.status === 403 && secretHits === 0 && stubbed.length === strayBefore,
        `${name}: redirect to ${label} refused with 403, target not fetched (got ${res.status})`);
    }
    if (dnsNip) {
      const res = await call(handler, route,
        `${origin}/redirect?to=${encodeURIComponent(`http://127.0.0.1.nip.io:${port}/secret`)}`);
      check(res.status === 403, `${name}: redirect to 127.0.0.1.nip.io refused with 403 (got ${res.status})`);
    } else {
      skip(`${name}: no DNS, redirect to 127.0.0.1.nip.io not checked`);
    }
    const loopHits = () => hits.filter((h) => h === '/loop').length;
    const before = loopHits();
    const loop = await call(handler, route, `${origin}/loop`);
    check(loop.status === 502 && loopHits() - before <= 6,
      `${name}: redirect loop stops with 502 after at most 6 requests (got ${loop.status}, ${loopHits() - before})`);
  }
  {
    const res = await call(imageGET as Handler, '/api/proxy-image',
      `https://${PUBLIC}/redirect?to=${encodeURIComponent(`https://${PUBLIC}/img.png`)}`);
    check(res.status === 200, `image: redirect to a public host still works (got ${res.status})`);
    const a = await call(audioGET as Handler, '/api/proxy-audio',
      `https://${PUBLIC}/redirect?to=${encodeURIComponent(`https://${PUBLIC}/audio.mp3`)}`, { range: 'bytes=0-99' });
    check(a.status === 206 && a.headers.get('content-length') === '100',
      `audio: redirect to a public host still streams 206 with Content-Length (got ${a.status}, ${a.headers.get('content-length')})`);
  }

  // --- 4. size limit ---------------------------------------------------------
  out('== 4. size limit');
  for (const [name, handler, route, type, cap] of [
    ['image', imageGET, '/api/proxy-image', 'image/png', MEDIA_LIMITS.image.maxBytes],
    ['audio', audioGET, '/api/proxy-audio', 'audio/mpeg', MEDIA_LIMITS.audio.maxBytes],
  ] as [string, Handler, string, string, number][]) {
    const declared = await call(handler, route, `https://${PUBLIC}/huge-declared?type=${encodeURIComponent(type)}`);
    const closed = await waitFor(() => streams['/huge-declared']?.closed === true, 2000);
    check(declared.status === 502 && closed,
      `${name}: declared 10 GB refused with 502, upstream socket closed (got ${declared.status}, closed ${closed})`);

    const res = await call(handler, route, `https://${PUBLIC}/huge-stream?type=${encodeURIComponent(type)}`);
    const body = await drain(res);
    const key = '/huge-stream' + type;
    const upClosed = await waitFor(() => streams[key]?.closed === true, 3000);
    check(res.status === 200 && body.error && body.bytes <= cap && upClosed,
      `${name}: endless body stops at ${cap / 1024 / 1024} MB (delivered ${(body.bytes / 1024 / 1024).toFixed(1)} MB, error ${body.error}, upstream closed ${upClosed})`);
  }
  if (dnsVideo) {
    const res = await call(videoGET as Handler, '/api/proxy-video', 'https://op3.dev/huge-playlist.m3u8');
    const upClosed = await waitFor(() => streams['/huge-playlist']?.closed === true, 3000);
    const sent = streams['/huge-playlist']?.written ?? 0;
    // The server writes ahead into socket buffers, so allow a few MB of slack.
    check(res.status === 502 && upClosed && sent <= MEDIA_LIMITS.playlist.maxBytes + 8 * 1024 * 1024,
      `video: endless playlist refused with 502 at ${MEDIA_LIMITS.playlist.maxBytes / 1024 / 1024} MB, upstream closed (got ${res.status}, closed ${upClosed}, sent ${(sent / 1024 / 1024).toFixed(1)} MB)`);
  } else {
    skip('video: no DNS for the allowed hosts');
  }

  // --- 5. media type, and the real-use shapes --------------------------------
  out('== 5. media type and real use');
  {
    const html = await call(imageGET as Handler, '/api/proxy-image', `https://${PUBLIC}/page.html`);
    check(html.status === 415, `image: text/html refused with 415 (got ${html.status})`);
    const img = await call(imageGET as Handler, '/api/proxy-image', `https://${PUBLIC}/img.png`);
    const imgBody = await drain(img);
    check(img.status === 200 && img.headers.get('content-type') === 'image/png'
      && img.headers.get('content-length') === String(PNG.length) && imgBody.bytes === PNG.length
      && img.headers.get('x-content-type-options') === 'nosniff',
      `image: a real image streams whole with its type, length and nosniff (got ${img.status})`);
    check(String(lastHeaders['accept-encoding']) === 'identity',
      `upstream request asks for Accept-Encoding: identity (got ${lastHeaders['accept-encoding']})`);
    const n304 = await call(imageGET as Handler, '/api/proxy-image', `https://${PUBLIC}/etag.png`, { 'if-none-match': '"v1"' });
    check(n304.status === 304, `image: upstream 304 passes through (got ${n304.status})`);
    const a = await call(audioGET as Handler, '/api/proxy-audio', `https://${PUBLIC}/audio.mp3`, { range: 'bytes=0-1023' });
    const aBody = await drain(a);
    check(a.status === 206 && a.headers.get('content-length') === '1024'
      && a.headers.get('content-range') === `bytes 0-1023/${MP3.length}` && aBody.bytes === 1024,
      `audio: Range gives 206 with Content-Length and Content-Range (got ${a.status})`);
    const aHtml = await call(audioGET as Handler, '/api/proxy-audio', `https://${PUBLIC}/page.html`);
    check(aHtml.status === 415, `audio: text/html refused with 415 (got ${aHtml.status})`);
  }
  if (dnsVideo) {
    const viaRedirect = await call(videoGET as Handler, '/api/proxy-video',
      `https://op3.dev/redirect?to=${encodeURIComponent(`https://${PUBLIC}/page.html`)}`);
    check(viaRedirect.status === 415,
      `video: allowed host that redirects to HTML refused with 415 (got ${viaRedirect.status})`);
    const pl = await call(videoGET as Handler, '/api/proxy-video',
      'https://customer-dlnbepb8zpz7h846.cloudflarestream.com/playlist.m3u8');
    const text = await pl.text();
    check(pl.status === 200 && text.includes('/api/proxy-video?url=') && pl.headers.get('x-content-type-options') === 'nosniff',
      `video: playlist is rewritten to proxied segments (got ${pl.status})`);

    // The whole chain the player walks: master, media playlist, init, segment,
    // key, each link fetched the way the player resolves it (root-relative,
    // against the playlist URL on this site), each through the route and its guard.
    const CF = 'https://customer-dlnbepb8zpz7h846.cloudflarestream.com';
    const follow = (link: string) => (videoGET as Handler)(new NextRequest(new URL(link, 'http://localhost/api/proxy-video?url=x').href));
    const linksOf = (t: string) => t.split('\n').flatMap((l) => l.startsWith('#') ? [...(l.match(/URI="[^"]*"/g) || [])].map((a) => a.slice(5, -1)) : l.trim() ? [l.trim()] : []);
    const targetOf = (link: string) => new URL(link, 'http://localhost').searchParams.get('url');
    const master = await call(videoGET as Handler, '/api/proxy-video', `${CF}/0123abcd/manifest/video.m3u8`);
    const masterLinks = linksOf(await master.text());
    check(master.status === 200 && masterLinks.length === 2 && masterLinks.every((l) => l.startsWith('/api/proxy-video?url=')),
      `video chain: master playlist links are root-relative proxy links (${masterLinks.length} links, got ${master.status})`);
    const variant = masterLinks.find((l) => targetOf(l)!.endsWith('/stream_v.m3u8'))!;
    const mediaRes = await follow(variant);
    const mediaLinks = linksOf(await mediaRes.text());
    check(mediaRes.status === 200 && mediaLinks.length === 7 && mediaLinks.every((l) => l.startsWith('/api/proxy-video?url=')),
      `video chain: every link of the media playlist is proxied, ../../ segments too (${mediaLinks.length} links, got ${mediaRes.status})`);
    const byName = (n: string) => mediaLinks.find((l) => targetOf(l)!.includes(n))!;
    const init = await follow(byName('init.mp4'));
    check(init.status === 200 && (await init.text()) === INIT && hits.includes(`/0123abcd/video/240/init.mp4?${HLS_TOKEN}`),
      `video chain: init segment arrives whole, its query (+ / = &) reaches upstream byte for byte (got ${init.status})`);
    const seg = await follow(byName('seg_1.mp4'));
    const segBytes = Buffer.from(await seg.arrayBuffer());
    check(seg.status === 200 && seg.headers.get('content-type') === 'video/mp4' && seg.headers.get('x-content-type-options') === 'nosniff'
      && segBytes.equals(Buffer.from(SEG, 'latin1')),
      `video chain: ../../<id>/video/240/seg_1.mp4 segment arrives byte-identical as video/mp4 (got ${seg.status}, ${segBytes.length} bytes)`);
    const key = await follow(byName('key.bin'));
    check(key.status === 200 && (await key.text()) === '0123456789abcdef', `video chain: EXT-X-KEY key is served through the proxy (got ${key.status})`);
    const audioPl = await follow(masterLinks.find((l) => targetOf(l)!.endsWith('/stream_a.m3u8'))!);
    const audioSeg = await follow(linksOf(await audioPl.text())[0]);
    check(audioSeg.status === 200 && audioSeg.headers.get('content-type') === 'audio/mp4',
      `video chain: the audio rendition's segment plays through the proxy (got ${audioSeg.status})`);
    const evil = await follow(byName('evil.mp4'));
    check(evil.status === 415, `video chain: a playlist link that answers HTML is refused with 415 (got ${evil.status})`);
    const secretSegBefore = hits.filter((h) => h.startsWith('/secret-seg')).length;
    const priv = await follow(byName('127.0.0.1'));
    check(priv.status === 403 && hits.filter((h) => h.startsWith('/secret-seg')).length === secretSegBefore,
      `video chain: a playlist link to a private address is rewritten, then refused with 403, no request made (got ${priv.status})`);
    const foreign = await follow(byName('/foreign.mp4'));
    check(foreign.status === 403, `video chain: a playlist link to a host outside the video allow-list is refused with 403 (got ${foreign.status})`);
    const plain = await follow(byName('/plain.mp4'));
    check(plain.status === 400, `video chain: a plain-http playlist link is refused with 400 (got ${plain.status})`);
    const redir = await call(videoGET as Handler, '/api/proxy-video', `${CF}/a/b/c/d/redir.m3u8`);
    const redirLinks = linksOf(await redir.text());
    check(redir.status === 200 && targetOf(redirLinks[0]) === `${CF}/0123abcd/video/240/init.mp4?${HLS_TOKEN}`,
      `video chain: links of a redirected playlist resolve against the final URL (${targetOf(redirLinks[0] || '/x?url=')})`);
    const secretBefore = hits.filter((h) => h.startsWith('/secret')).length;
    const sk = await call(videoGET as Handler, '/api/proxy-video', 'https://www.thesplitkit.com/live/splitkit');
    check(sk.status === 403 && hits.filter((h) => h.startsWith('/secret')).length === secretBefore,
      `video: a private stream URL found in a SplitKit page is refused with 403 (got ${sk.status})`);
    const skr = await call(videoGET as Handler, '/api/proxy-video',
      `https://www.thesplitkit.com/redirect?to=${encodeURIComponent(`http://127.0.0.1:${port}/secret-page`)}`);
    check(skr.status === 403 && hits.filter((h) => h.startsWith('/secret')).length === secretBefore,
      `video: a SplitKit page that redirects to a private address is not fetched (got ${skr.status})`);
    const huge = await call(videoGET as Handler, '/api/proxy-video', 'https://www.thesplitkit.com/live/huge-page');
    const pageStats = () => Object.entries(streams).filter(([k]) => k.startsWith('/live/huge-page#')).map(([, v]) => v);
    const pagesClosed = await waitFor(() => pageStats().length > 0 && pageStats().every((v) => v.closed), 3000);
    const pageSent = pageStats().reduce((n, v) => n + v.written, 0);
    // Two requests (the page read, then the main fetch that the media-type check stops), each with a few
    // MB of socket-buffer slack.
    check(huge.status === 415 && pagesClosed && pageSent <= MEDIA_LIMITS.page.maxBytes + 16 * 1024 * 1024,
      `video: an endless SplitKit page is read only to ${MEDIA_LIMITS.page.maxBytes / 1024 / 1024} MB (sent ${(pageSent / 1024 / 1024).toFixed(1)} MB, got ${huge.status})`);
    const skp = await call(videoGET as Handler, '/api/proxy-video', 'https://www.thesplitkit.com/live/probe-page');
    const probes = hits.filter((h) => h.startsWith('/live/probe-page/')).length;
    check(probes > 0 && hits.filter((h) => h.startsWith('/secret')).length === secretBefore,
      `video: SplitKit stream probes that redirect to a private address are not followed (${probes} probes, got ${skp.status})`);
  } else {
    skip('video: no DNS for the allowed hosts');
  }

  // --- 6. time limit (slow) --------------------------------------------------
  out('== 6. time limit');
  if (SKIP_SLOW) {
    skip('CHECK_SKIP_SLOW=1: timeout cases not run');
  } else {
    const cases: [string, Handler, string, string, number][] = [
      ['image', imageGET as Handler, '/api/proxy-image', `https://${PUBLIC}`, MEDIA_LIMITS.image.timeoutMs],
      ['audio', audioGET as Handler, '/api/proxy-audio', `https://${PUBLIC}`, MEDIA_LIMITS.audio.timeoutMs],
    ];
    if (dnsVideo) cases.push(['video', videoGET as Handler, '/api/proxy-video', 'https://op3.dev', MEDIA_LIMITS.video.timeoutMs]);
    else skip('video: no DNS for the allowed hosts');
    await Promise.all(cases.flatMap(([name, handler, route, origin, limit]) => [
      (async () => {
        const t0 = Date.now();
        const res = await call(handler, route, `${origin}/hang?${name}`);
        const s = (Date.now() - t0) / 1000;
        const closed = await waitFor(() => streams[`/hang?${name}`]?.closed === true, 2000);
        check(res.status === 504 && s >= limit / 1000 - 1 && s <= limit / 1000 + 5 && closed,
          `${name}: server that never answers gives 504 after ${s.toFixed(1)} s (limit ${limit / 1000} s), socket closed ${closed}`);
      })(),
      (async () => {
        const type = name === 'audio' ? 'audio/mpeg' : name === 'video' ? 'video/mp2t' : 'image/png';
        const t0 = Date.now();
        const res = await call(handler, route, `${origin}/drip?${name}&type=${encodeURIComponent(type)}`);
        const body = await drain(res);
        const s = (Date.now() - t0) / 1000;
        check(res.status === 200 && body.error && s >= limit / 1000 - 1 && s <= limit / 1000 + 5,
          `${name}: a body that drips 2 bytes/s is cut after ${s.toFixed(1)} s (limit ${limit / 1000} s, ${body.bytes} bytes)`);
      })(),
    ]));
  }

  check(stubbed.length === 0, `no request reached a host the guard should have refused (${stubbed.join(', ') || 'none'})`);

  // Every upstream request of the three routes carries the app's User-Agent:
  // redirect hops, playlist links, the SplitKit page and its HEAD probes too.
  {
    const wrong = agents.filter(([, ua]) => ua !== USER_AGENT);
    const seen = (re: RegExp) => agents.some(([req]) => re.test(req));
    check(agents.length > 0 && wrong.length === 0,
      `every upstream request sends User-Agent ${USER_AGENT} (${agents.length} requests, wrong: ${wrong.slice(0, 3).map(([r, ua]) => `${r} ${ua}`).join('; ') || 'none'})`);
    check(seen(/^GET \/redirect$/) && seen(/^GET \/img\.png$/) && seen(/^GET \/live\/splitkit$/) && seen(/^HEAD \/live\/probe-page\//),
      'the User-Agent check covers a redirect hop, an image, a SplitKit page and a HEAD probe');
  }

  server.closeAllConnections();
  server.close();
  console.log = quiet.log; console.warn = quiet.warn; console.error = quiet.error;
  out(`\npassed: ${passed}  failed: ${bad}  skipped: ${skipped}`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error = quiet.error;
  quiet.error(e);
  process.exit(1);
});
