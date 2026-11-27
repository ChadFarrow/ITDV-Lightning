// Assertions for the server-side feed fetch: the private-address guard, the time
// limit and the size limit (lib/safe-fetch.ts, lib/capped-body.ts,
// lib/feed-fetch.ts), and how lib/rss-parser.ts uses them. Also pins that a
// channel's value block and GUID come from the channel only.
//
//   npx tsx scripts/check-feed-fetch.ts
//
// No network needed. One case asks DNS about 127.0.0.1.nip.io (a public wildcard
// name that answers 127.0.0.1); without DNS it prints SKIP, not ok.
//
// Sections 1-3 are the PC20-Nostr recipe's own tests (safe-feed-fetch,
// tests/ssrf.test.ts), run against the copies in lib/. Sections 4-6 are this
// repo's: they start a real HTTP server on loopback. The guard refuses loopback,
// so to reach it a stub of globalThis.fetch rewrites the public address
// 93.184.215.14 to the local server and passes `init` through unchanged; the real
// AbortSignal and the real socket then do the work. Shipped code has no bypass.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { assertSafeFetchUrl, isPrivateIp, safeFetch } from '../lib/safe-fetch';
import { readCappedText, readBytesUpTo } from '../lib/capped-body';
import { fetchUntrustedText, fetchUntrustedJson, FeedFetchError } from '../lib/feed-fetch';
import { RSSParser } from '../lib/rss-parser';
import { RSSCache } from '../lib/rss-cache';
import { USER_AGENT } from '../lib/user-agent';

let bad = 0;
let passed = 0;
const out = (m: string) => process.stdout.write(m + '\n');
const fail = (m: string) => { out('FAIL   ' + m); bad++; };
const ok = (m: string) => { out('ok     ' + m); passed++; };

// The parser logs every feed it reads. Keep this output to the results.
const quiet = { log: console.log, warn: console.warn, error: console.error, info: console.info };
function hush() { console.log = () => {}; console.warn = () => {}; console.error = () => {}; console.info = () => {}; }
function unhush() { console.log = quiet.log; console.warn = quiet.warn; console.error = quiet.error; console.info = quiet.info; }

function refused(url: string): boolean {
  try { assertSafeFetchUrl(url); return false; } catch { return true; }
}

// --- 1. literal addresses and names (recipe) --------------------------------

const MUST_REFUSE: [string, string][] = [
  ['http://127.0.0.1/', 'loopback'],
  ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
  ['http://10.0.0.1/', 'RFC 1918 10/8'],
  ['http://10.255.255.254/', 'RFC 1918 10/8 upper edge'],
  ['http://172.16.0.1/', 'RFC 1918 172.16/12'],
  ['http://192.168.1.1/', 'RFC 1918 192.168/16'],
  ['http://100.64.0.1/', 'CGNAT / tailnet'],
  ['http://100.127.255.1/', 'CGNAT upper edge'],
  ['http://172.31.255.1/', 'RFC 1918 172.16/12 upper edge'],
  ['http://0.0.0.0/', '0/8'],
  ['http://224.0.0.1/', 'multicast 224/4'],
  ['http://239.255.255.250/', 'multicast SSDP'],
  ['http://240.0.0.1/', 'reserved 240/4'],
  ['http://255.255.255.255/', 'broadcast'],
  ['http://192.0.0.1/', 'IETF protocol assignments 192.0.0/24'],
  ['http://192.0.2.1/', 'TEST-NET-1'],
  ['http://198.51.100.1/', 'TEST-NET-2'],
  ['http://203.0.113.1/', 'TEST-NET-3'],
  ['http://198.18.0.1/', 'benchmarking 198.18/15'],
  ['http://198.19.255.1/', 'benchmarking 198.19'],
  ['http://192.88.99.1/', '6to4 relay anycast'],
  ['http://2130706433/', 'decimal 127.0.0.1'],
  ['http://0177.0.0.1/', 'octal 127.0.0.1'],
  ['http://0x7f.0.0.1/', 'hex 127.0.0.1'],
  ['http://127.1/', 'short 127.0.0.1'],
  ['http://good.example@169.254.169.254/', 'userinfo smuggling'],
  ['http://localhost/', 'localhost'],
  ['http://localhost:3000/api/admin/manage-feeds', 'localhost with a port'],
  ['http://localhost./', 'localhost with trailing dot'],
  ['http://metadata.google.internal./', '.internal with trailing dot'],
  ['http://printer.local/', '.local'],
  ['http://app.localhost/', '*.localhost'],
  ['http://metadata.google.internal/', '.internal'],
  ['http://[::1]/', 'IPv6 loopback'],
  ['http://[::]/', 'IPv6 unspecified'],
  // Node rewrites the embedded IPv4 to hex (::ffff:a9fe:a9fe) before any guard
  // sees the hostname, so a rule for the dotted form alone does not match it.
  ['http://[::ffff:169.254.169.254]/', 'v4-mapped metadata (hex after parsing)'],
  ['http://[::ffff:127.0.0.1]/', 'v4-mapped loopback'],
  ['http://[::ffff:10.0.0.1]/', 'v4-mapped RFC 1918'],
  ['http://[::7f00:1]/', 'v4-compatible loopback'],
  ['http://[64:ff9b::a9fe:a9fe]/', 'NAT64 metadata'],
  ['http://[64:ff9b::7f00:1]/', 'NAT64 loopback'],
  ['http://[2002:7f00:1::]/', '6to4 loopback'],
  ['http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/', 'Teredo'],
  ['http://[fe80::1]/', 'link-local'],
  ['http://[fec0::1]/', 'site-local'],
  ['http://[fd00::1]/', 'unique-local'],
  ['http://[fc00::1]/', 'unique-local fc'],
  ['http://[100::1]/', 'discard-only 100::/64'],
  ['file:///etc/passwd', 'file scheme'],
  ['gopher://example.com/', 'gopher scheme'],
  ['ftp://example.com/feed.xml', 'ftp scheme'],
  ['/api/fetch-rss?url=x', 'relative URL (the old browser proxy path)'],
  ['not a url', 'unparseable'],
];

const MUST_ALLOW: [string, string][] = [
  ['https://www.doerfelverse.com/feeds/them.xml', 'a real ITDV feed'],
  ['https://wavlake.com/feed/music/6bece1b8-5385-4a33-9224-09e7f3ee6965', 'a real Wavlake feed'],
  ['http://feeds.example.org/rss', 'plain http feed (a long tail of real feeds)'],
  ['https://1.1.1.1/', 'public IPv4 literal'],
  ['https://[2606:4700:4700::1111]/', 'public IPv6 literal'],
  ['https://fdrecords.com/feed.xml', 'public name starting fd'],
  ['https://fcc.gov/', 'public name starting fc'],
  ['https://fe80.example.com/', 'public name starting fe80'],
  ['http://172.32.0.1/', 'just above 172.16/12'],
  ['http://100.128.0.1/', 'just above 100.64/10'],
  ['http://223.255.255.1/', 'just below multicast'],
  ['http://198.20.0.1/', 'just above 198.18/15'],
];

function section1() {
  for (const [url, why] of MUST_REFUSE) {
    refused(url) ? ok(`refused ${why}: ${url}`) : fail(`ALLOWED ${why}: ${url}`);
  }
  for (const [url, why] of MUST_ALLOW) {
    refused(url) ? fail(`refused ${why}: ${url}`) : ok(`allowed ${why}: ${url}`);
  }
  for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '169.254.169.254', '10.1.2.3', 'fe80::1%en0']) {
    isPrivateIp(addr) ? ok(`resolved address ${addr} counts as private`)
                      : fail(`resolved address ${addr} counts as public`);
  }
}

// --- 2. redirects and DNS, with a stubbed fetch (recipe) --------------------

type Call = { url: string; init?: RequestInit };
const realFetch = globalThis.fetch;
function stubFetch(answer: (url: string, n: number, init?: RequestInit) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return answer(url, calls.length, init);
  }) as typeof fetch;
  return calls;
}
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

// A public IP literal skips DNS, so these run offline.
const PUBLIC = 'http://93.184.215.14';

async function section2() {
  {
    const calls = stubFetch(() => redirect('http://169.254.169.254/latest/meta-data/'));
    try { await safeFetch(`${PUBLIC}/feed.xml`, { redirect: 'follow' }); fail('redirect to metadata was followed'); }
    catch { calls.length === 1 ? ok('redirect to metadata refused before the second request')
                               : fail(`redirect to metadata made ${calls.length} requests`); }
    calls[0]?.init?.redirect === 'manual'
      ? ok("caller's redirect: 'follow' overridden to 'manual'")
      : fail(`redirect mode reached fetch as ${String(calls[0]?.init?.redirect)}`);
    calls[0]?.init?.cache === 'no-store'
      ? ok("cache forced to 'no-store'")
      : fail(`cache reached fetch as ${String(calls[0]?.init?.cache)}`);
  }
  for (const target of ['http://[::ffff:127.0.0.1]/', 'http://localhost/', 'http://10.0.0.1/', 'http://[::1]/']) {
    const calls = stubFetch(() => redirect(target));
    try { await safeFetch(`${PUBLIC}/feed.xml`); fail(`redirect to ${target} was followed`); }
    catch { calls.length === 1 ? ok(`redirect to ${target} refused`) : fail(`redirect to ${target}: second request made`); }
  }
  {
    const calls = stubFetch((_u, n) => n === 1 ? redirect('/moved.xml') : new Response('<rss/>'));
    try {
      const res = await safeFetch(`${PUBLIC}/feed.xml`);
      calls.length === 2 && calls[1].url === `${PUBLIC}/moved.xml` && res.status === 200
        ? ok('relative redirect resolved against the current hop and followed')
        : fail(`relative redirect went to ${calls[1]?.url}`);
    } catch (e) { fail(`relative public redirect refused: ${(e as Error).message}`); }
  }
  {
    const calls = stubFetch((_u, n) => n > 20 ? new Response('gave up') : redirect(`${PUBLIC}/feed.xml`));
    try { await safeFetch(`${PUBLIC}/feed.xml`); fail(`redirect loop not capped (${calls.length} requests)`); }
    catch { calls.length === 6 ? ok('redirect chain capped (1 request + 5 redirects)')
                               : fail(`redirect cap made ${calls.length} requests, expected 6`); }
  }
  {
    const calls = stubFetch((_u, n) => n === 1 ? redirect('gopher://93.184.215.14/') : new Response('reached'));
    try { await safeFetch(`${PUBLIC}/feed.xml`); fail('redirect to gopher: was followed'); }
    catch { calls.length === 1 ? ok('redirect to another scheme refused before the second request')
                               : fail('redirect to gopher: reached fetch'); }
  }
  {
    const calls = stubFetch(() => new Response('never'));
    try { await safeFetch('http://does-not-exist.invalid/feed.xml'); fail('unresolvable host was fetched'); }
    catch { calls.length === 0 ? ok('unresolvable host refused without a request (fails closed)')
                               : fail('unresolvable host reached fetch'); }
  }
  {
    const calls = stubFetch(() => new Response('never'));
    try { await safeFetch('http://127.0.0.1.nip.io/feed.xml'); fail('nip.io name resolving to loopback was fetched'); }
    catch (e) {
      const m = (e as Error).message;
      if (calls.length) fail('nip.io name reached fetch');
      else if (m.includes('resolves to a private address')) ok('public name resolving to 127.0.0.1 refused after DNS');
      else out('SKIP   nip.io case: no DNS here (' + m + ')');
    }
  }
  globalThis.fetch = realFetch;
}

// --- 3. the body cap counts bytes, it does not trust headers (recipe) -------

async function section3() {
  const stream = (chunks: number, size: number) => new Response(new ReadableStream({
    start(c) { for (let i = 0; i < chunks; i++) c.enqueue(new Uint8Array(size).fill(65)); c.close(); },
  }));
  try { await readCappedText(stream(3, 4), 10); fail('12 streamed bytes passed a 10-byte cap'); }
  catch (e) {
    String((e as Error).message).startsWith('response too large')
      ? ok('streamed body over the cap refused (message prefix that lib/feed-fetch.ts reads)')
      : fail(`cap error message changed: ${(e as Error).message}`);
  }
  try { (await readCappedText(stream(3, 4), 12)).length === 12 ? ok('body at the cap read whole') : fail('body at cap misread'); }
  catch { fail('body exactly at the cap refused'); }
  try {
    await readCappedText(new Response('x', { headers: { 'content-length': String(1e12) } }), 1024);
    fail('declared 1 TB body was read');
  } catch { ok('declared length over the cap refused before reading'); }
  const unstreamed = { headers: new Headers(), body: null, arrayBuffer: async () => new ArrayBuffer(20) };
  try { await readCappedText(unstreamed, 10); fail('20-byte unstreamed body passed a 10-byte cap'); }
  catch { ok('unstreamed body over the cap refused'); }
  const prefix = await readBytesUpTo(stream(3, 4), 5);
  prefix.bytes.length === 5 && prefix.truncated
    ? ok('readBytesUpTo stops at the cap and reports truncated')
    : fail(`readBytesUpTo gave ${prefix.bytes.length} bytes, truncated=${prefix.truncated}`);
  try { assertSafeFetchUrl('http://127.0.0.1/'); fail('loopback passed'); }
  catch (e) {
    String((e as Error).message).startsWith('unsafe fetch url')
      ? ok('refusal message keeps the prefix that lib/feed-fetch.ts reads')
      : fail(`refusal message changed: ${(e as Error).message}`);
  }
}

// --- a real HTTP server on loopback, for sections 4-6 -----------------------

const hits: Record<string, number> = {};
let hugeBytesSent = 0;
const openTimers: ReturnType<typeof setInterval>[] = [];
const FEEDS: Record<string, string> = {};
/** The User-Agent of the last request to each path. */
const agentOf: Record<string, string> = {};

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  hits[path] = (hits[path] || 0) + 1;
  agentOf[path] = String(req.headers['user-agent']);
  if (path === '/redirect-public') { res.writeHead(302, { location: `${PUBLIC}/ok` }); res.end(); return; }
  if (path === '/chapters.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"chapters":[]}'); return; }
  if (path === '/ok') { res.writeHead(200, { 'content-type': 'application/rss+xml' }); res.end('<rss>ok</rss>'); return; }
  if (path === '/hang') return; // headers never come
  if (path === '/drip') {
    res.writeHead(200, { 'content-type': 'application/rss+xml' });
    const t = setInterval(() => res.write('<'), 100);
    openTimers.push(t);
    res.on('close', () => clearInterval(t));
    return;
  }
  if (path === '/huge' || path === '/huge-feed') {
    // Chunked, no Content-Length: only the byte count while reading can stop it.
    res.writeHead(200, { 'content-type': 'application/rss+xml' });
    const chunk = Buffer.alloc(64 * 1024, 0x3c);
    let sent = 0;
    const pump = () => {
      while (sent < 64 * 1024 * 1024 && !res.destroyed) {
        sent += chunk.length; hugeBytesSent += chunk.length;
        if (!res.write(chunk)) { res.once('drain', pump); return; }
      }
      res.end();
    };
    pump();
    return;
  }
  if (path === '/declared-huge') {
    res.writeHead(200, { 'content-type': 'application/rss+xml', 'content-length': String(10 * 1024 * 1024 * 1024) });
    res.write('<rss>');
    return;
  }
  if (path === '/404') { res.writeHead(404); res.end('not here'); return; }
  if (path === '/redirect-private') {
    const port = (server.address() as AddressInfo).port;
    res.writeHead(302, { location: `http://127.0.0.1:${port}/ok` });
    res.end();
    return;
  }
  if (path === '/redirect-feed-private') {
    const port = (server.address() as AddressInfo).port;
    res.writeHead(302, { location: `http://[::ffff:127.0.0.1]:${port}/feed.xml` });
    res.end();
    return;
  }
  if (path === '/chapters.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ version: '1.2.0', chapters: [{ startTime: 0, title: 'CityBeach - Intro' }] }));
    return;
  }
  if (FEEDS[path]) { res.writeHead(200, { 'content-type': 'application/rss+xml' }); res.end(FEEDS[path]); return; }
  res.writeHead(404); res.end();
});

let PORT = 0;
const LOCAL = () => `http://127.0.0.1:${PORT}`;

/** Route the public literal to the local server; everything else goes out for real. */
function viaLocal(): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return realFetch(url.replace(PUBLIC, LOCAL()), init);
  }) as typeof fetch;
  return calls;
}

async function expectFailure(label: string, run: () => Promise<unknown>, reason: string, maxMs: number) {
  const t0 = Date.now();
  // A missing limit shows up as a hang; turn it into a failure.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer after ${maxMs + 3000} ms (hung)`)), maxMs + 3000);
  });
  try {
    await Promise.race([run(), watchdog]);
    fail(`${label}: succeeded, expected ${reason}`);
  } catch (e) {
    const ms = Date.now() - t0;
    const got = e instanceof FeedFetchError ? e.reason : `${(e as Error).name}: ${(e as Error).message}`;
    if (got !== reason) fail(`${label}: failed as ${got}, expected ${reason}`);
    else if (ms > maxMs) fail(`${label}: ${reason} after ${ms} ms, limit ${maxMs} ms`);
    else ok(`${label}: ${reason} after ${ms} ms`);
  } finally {
    clearTimeout(timer);
  }
}

// --- 4. lib/feed-fetch.ts: time and size limits on a real socket -------------

async function section4() {
  viaLocal();
  try {
    const text = await fetchUntrustedText(`${PUBLIC}/ok`);
    text === '<rss>ok</rss>' ? ok('a normal feed is read') : fail(`normal feed read as ${text}`);
  } catch (e) { fail(`normal feed failed: ${(e as Error).message}`); }

  // The app's own User-Agent (lib/user-agent.js), on a feed, on each redirect hop and on a chapters file.
  agentOf['/ok'] = agentOf['/redirect-public'] = agentOf['/chapters.json'] = '';
  try {
    await fetchUntrustedText(`${PUBLIC}/redirect-public`);
    await fetchUntrustedJson(`${PUBLIC}/chapters.json`);
  } catch (e) { fail(`User-Agent case failed: ${(e as Error).message}`); }
  for (const p of ['/redirect-public', '/ok', '/chapters.json']) {
    agentOf[p] === USER_AGENT
      ? ok(`${p} got User-Agent ${USER_AGENT}`)
      : fail(`${p} got User-Agent ${agentOf[p] || '(none)'}, expected ${USER_AGENT}`);
  }

  await expectFailure('slow server, headers never come', () => fetchUntrustedText(`${PUBLIC}/hang`, { timeoutMs: 500 }), 'timeout', 2000);
  await expectFailure('slow server, body drips one byte per 100 ms', () => fetchUntrustedText(`${PUBLIC}/drip`, { timeoutMs: 500 }), 'timeout', 2000);

  hugeBytesSent = 0;
  await expectFailure('huge body, chunked with no Content-Length', () => fetchUntrustedText(`${PUBLIC}/huge`, { maxBytes: 1024 * 1024 }), 'too-large', 5000);
  await new Promise((r) => setTimeout(r, 200));
  hugeBytesSent < 16 * 1024 * 1024
    ? ok(`huge body: the reader stopped early (server wrote ${(hugeBytesSent / 1048576).toFixed(1)} MB of 64 MB)`)
    : fail(`huge body: server wrote ${hugeBytesSent} bytes, the read did not stop`);
  await expectFailure('huge body, default 8 MB feed cap', () => fetchUntrustedText(`${PUBLIC}/huge`), 'too-large', 5000);
  await expectFailure('declared 10 GB Content-Length', () => fetchUntrustedText(`${PUBLIC}/declared-huge`), 'too-large', 2000);
  await expectFailure('chapters file over its 1 MB cap', () => fetchUntrustedJson(`${PUBLIC}/huge`), 'too-large', 5000);
  await expectFailure('404 answer', () => fetchUntrustedText(`${PUBLIC}/404`), 'http', 2000);

  hits['/ok'] = 0;
  await expectFailure('redirect from a public host to 127.0.0.1', () => fetchUntrustedText(`${PUBLIC}/redirect-private`), 'refused', 2000);
  hits['/ok'] === 0 ? ok('redirect target on loopback got no request') : fail(`redirect target got ${hits['/ok']} requests`);
  globalThis.fetch = realFetch;
}

// --- 5. lib/rss-parser.ts end to end -----------------------------------------

const feedXml = (channelExtra: string, items: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Test Album</title>
    <description>Test</description>
    <itunes:author>Test Artist</itunes:author>
    <itunes:image href="https://example.com/a.jpg"/>
${channelExtra}
${items}
  </channel>
</rss>`;

const valueBlock = (name: string, address: string) => `
      <podcast:value type="lightning" method="keysend" suggested="0.00000005000">
        <podcast:valueRecipient name="${name}" type="node" address="${address}" split="100"/>
      </podcast:value>`;

const ITEM_NODE = '03' + 'a'.repeat(64);
const CHANNEL_NODE = '02' + 'b'.repeat(64);

const item = (title: string, extra = '', enclosure = '<enclosure url="https://example.com/t.mp3" type="audio/mpeg" length="1"/>') => `
    <item>
      <title>${title}</title>
      <guid>${title}</guid>
      ${enclosure}
      <itunes:duration>120</itunes:duration>
      ${extra}
    </item>`;

async function parse(url: string) {
  hush();
  try { return await RSSParser.parseAlbumFeed(url); } finally { unhush(); }
}

async function section5() {
  FEEDS['/feed.xml'] = feedXml(valueBlock('Channel', CHANNEL_NODE), item('One'));

  // Positive control: the local server answers a plain fetch, so a zero hit count
  // below means the guard stopped the request, not that nothing was listening.
  hits['/feed.xml'] = 0;
  await realFetch(`${LOCAL()}/feed.xml`).then((r) => r.text());
  hits['/feed.xml'] === 1 ? ok('control: the local feed server answers a direct fetch') : fail('control: local server not reached');

  const attacks: [string, string][] = [
    [`http://127.0.0.1:${PORT}/feed.xml`, '127.0.0.1'],
    [`http://localhost:${PORT}/feed.xml`, 'localhost'],
    [`http://[::1]:${PORT}/feed.xml`, '[::1]'],
    [`http://[::ffff:127.0.0.1]:${PORT}/feed.xml`, '::ffff:127.0.0.1'],
    [`http://2130706433:${PORT}/feed.xml`, 'decimal 127.0.0.1'],
    ['http://10.0.0.1/feed.xml', '10/8'],
    ['http://169.254.169.254/latest/meta-data/', '169.254.169.254 (cloud metadata)'],
    ['http://metadata.google.internal/computeMetadata/v1/', 'metadata.google.internal'],
  ];
  for (const [url, why] of attacks) {
    hits['/feed.xml'] = 0;
    const t0 = Date.now();
    const album = await parse(url);
    const ms = Date.now() - t0;
    // withRetry waits 1000 ms before a second attempt, so under 900 ms is one attempt.
    if (album !== null) fail(`parser read a feed from ${why}`);
    else if (hits['/feed.xml'] !== 0) fail(`parser refused ${why} but the server got ${hits['/feed.xml']} requests`);
    else if (ms >= 900) fail(`parser refused ${why} after ${ms} ms (retried?)`);
    else ok(`parser refused ${why} in ${ms} ms, no request, no retry`);
  }

  // A public feed host that redirects to loopback.
  viaLocal();
  hits['/feed.xml'] = 0;
  const redirected = await parse(`${PUBLIC}/redirect-feed-private`);
  redirected === null && hits['/feed.xml'] === 0
    ? ok('parser refused a public feed that redirects to ::ffff:127.0.0.1')
    : fail(`redirect to loopback: album=${redirected !== null} hits=${hits['/feed.xml']}`);

  // An oversized feed fails once; it is not fetched again by the retry loop.
  hits['/huge-feed'] = 0;
  const t0 = Date.now();
  const huge = await parse(`${PUBLIC}/huge-feed`);
  huge === null && hits['/huge-feed'] === 1
    ? ok(`parser refused a feed over 8 MB after one request (${Date.now() - t0} ms)`)
    : fail(`oversized feed: album=${huge !== null} requests=${hits['/huge-feed']}`);

  // A public feed whose chapters URL points at cloud metadata: the feed parses,
  // the chapters request is never made. The control feed shows that a public
  // chapters URL is fetched, so the missing call is the guard's doing.
  const videoItem = (chaptersUrl: string) => item('CityBeach Set',
    `<podcast:chapters url="${chaptersUrl}" type="application/json"/>`,
    '<enclosure url="https://example.com/v.mp4" type="video/mp4" length="1"/>');
  FEEDS['/chapters-control.xml'] = feedXml(valueBlock('Channel', CHANNEL_NODE), videoItem(`${PUBLIC}/chapters.json`));
  FEEDS['/chapters-metadata.xml'] = feedXml(valueBlock('Channel', CHANNEL_NODE), videoItem('http://169.254.169.254/latest/meta-data/'));
  let calls = viaLocal();
  const control = await parse(`${PUBLIC}/chapters-control.xml`);
  control && calls.some((c) => c.url.endsWith('/chapters.json'))
    ? ok('control: a public chapters URL in a feed is fetched')
    : fail(`control: chapters not fetched (album=${!!control})`);
  calls = viaLocal();
  const meta = await parse(`${PUBLIC}/chapters-metadata.xml`);
  if (!meta) fail('feed with a metadata chapters URL did not parse');
  else if (calls.some((c) => c.url.includes('169.254.169.254'))) fail('chapters URL 169.254.169.254 was fetched');
  else ok('chapters URL 169.254.169.254 refused; the feed itself still parses');
  globalThis.fetch = realFetch;
}

// --- 6. channel-level tags come from the channel only ------------------------

async function section6() {
  viaLocal();
  FEEDS['/no-channel-value.xml'] = feedXml('', item('One', valueBlock('Item', ITEM_NODE)) + item('Two', valueBlock('Item', ITEM_NODE)));
  const a = await parse(`${PUBLIC}/no-channel-value.xml`);
  if (!a) fail('feed with item values only did not parse');
  else {
    a.value === undefined && a.paymentRecipients === undefined
      ? ok('channel with no value block: album has no value (not the first item\'s)')
      : fail(`channel with no value block took ${JSON.stringify(a.value?.recipients)}`);
    a.tracks[0]?.value?.recipients[0]?.address === ITEM_NODE
      ? ok('its tracks keep their own value block')
      : fail('track lost its own value block');
  }

  // Channel value written after the items: still the channel's, not the first item's.
  FEEDS['/channel-value-last.xml'] = feedXml('', item('One', valueBlock('Item', ITEM_NODE)) + valueBlock('Channel', CHANNEL_NODE));
  const b = await parse(`${PUBLIC}/channel-value-last.xml`);
  b?.value?.recipients.length === 1 && b.value.recipients[0].address === CHANNEL_NODE
    && b.paymentRecipients?.[0]?.address === CHANNEL_NODE && b.tracks[0]?.value?.recipients[0]?.address === ITEM_NODE
    ? ok('channel value after the items: album uses the channel split, track its own')
    : fail(`channel value after items: album=${JSON.stringify(b?.value?.recipients)}`);

  // Unprefixed <value> on the channel is still read, as before.
  FEEDS['/unprefixed.xml'] = feedXml(`<value type="lightning" method="keysend"><valueRecipient name="C" type="node" address="${CHANNEL_NODE}" split="100"/></value>`, item('One'));
  const c = await parse(`${PUBLIC}/unprefixed.xml`);
  c?.value?.recipients[0]?.address === CHANNEL_NODE
    ? ok('unprefixed channel <value> is still read')
    : fail('unprefixed channel <value> lost');

  // The channel GUID: an item's podcast:guid is not the feed's.
  FEEDS['/item-guid.xml'] = feedXml('', item('One', '<podcast:guid>item-guid-not-the-feed</podcast:guid>'));
  const d = await parse(`${PUBLIC}/item-guid.xml`);
  d && d.feedGuid !== 'item-guid-not-the-feed'
    ? ok('channel with no podcast:guid: album does not take an item\'s')
    : fail(`album feedGuid = ${d?.feedGuid}`);
  FEEDS['/channel-guid.xml'] = feedXml('<podcast:guid>channel-guid</podcast:guid>', item('One'));
  const e = await parse(`${PUBLIC}/channel-guid.xml`);
  e?.feedGuid === 'channel-guid' ? ok('channel podcast:guid is read') : fail(`channel guid read as ${e?.feedGuid}`);
  globalThis.fetch = realFetch;
}

async function main() {
  // RSSCache keeps parsed feeds for 30 min in data/rss-cache/. Use a throwaway
  // folder, or a second run reads the first run's albums and tests nothing.
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'itdv-check-feed-fetch-'));
  (RSSCache as unknown as { CACHE_DIR: string }).CACHE_DIR = cacheDir;
  section1();
  await section2();
  await section3();
  await new Promise<void>((r) => server.listen(0, '::', () => r()));
  PORT = (server.address() as AddressInfo).port;
  try {
    await section4();
    await section5();
    await section6();
  } finally {
    globalThis.fetch = realFetch;
    openTimers.forEach((t) => clearInterval(t));
    server.closeAllConnections();
    server.close();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  out(bad ? `\n${bad} FAILED, ${passed} passed` : `\nall ${passed} passed`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { unhush(); console.error(e); process.exit(1); });
