// Assertions for the HLS playlist rewrite (lib/hls-rewrite.ts): every link in a
// master or media playlist goes to /api/proxy-video, whatever its name or form.
//
//   npx tsx scripts/check-hls-rewrite.ts
//
// No network. The playlists are synthetic copies of the real shapes; the tokens
// in them are made up. The route-level chain (master, media, segment, through
// the guard) is in scripts/check-media-proxy.ts.

import { rewriteHlsPlaylist, proxiedVideoUrl, PROXY_VIDEO_PATH } from '../lib/hls-rewrite';

let bad = 0;
let passed = 0;
const check = (cond: boolean, m: string) => {
  if (cond) { passed++; console.log('ok     ' + m); } else { bad++; console.log('FAIL   ' + m); }
};

/** The upstream URL a rewritten link names, read back the way the route reads it. */
function target(link: string): string | null {
  if (!link.startsWith(PROXY_VIDEO_PATH + '?url=')) return null;
  return new URL(link, 'https://site.example').searchParams.get('url');
}
/** Every link of a rewritten playlist: the URI lines and the URI="…" attributes. */
function links(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const re = /(?:^|[:,])URI="([^"]*)"/g; // es5 target: no matchAll
      for (let m = re.exec(line); m; m = re.exec(line)) out.push(m[1]);
    } else {
      out.push(line);
    }
  }
  return out;
}

const CF = 'https://customer-abc.cloudflarestream.com';
const MASTER_URL = `${CF}/0123abcd/manifest/video.m3u8`;
const MEDIA_URL = `${CF}/0123abcd/manifest/stream_t1_r240.m3u8`;
const P = 'eyJ0eXBlIjoic2VnbWVudCJ9'; // made-up token

// --- 1. Cloudflare Stream master playlist ------------------------------------
console.log('== 1. master playlist (Cloudflare Stream shape)');
const master = [
  '#EXTM3U',
  '#EXT-X-VERSION:6',
  '#EXT-X-INDEPENDENT-SEGMENTS',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="group_audio",NAME="original",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="stream_t9_r131.m3u8"',
  '#EXT-X-STREAM-INF:RESOLUTION=426x240,CODECS="avc1.42c015,mp4a.40.2",BANDWIDTH=1029326,AUDIO="group_audio"',
  'stream_t1_r240.m3u8',
  '#EXT-X-STREAM-INF:RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",BANDWIDTH=4341330,AUDIO="group_audio"',
  'stream_t1_r720.m3u8',
  '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=86000,URI="iframes_240.m3u8"',
  '',
].join('\n');
const m1 = rewriteHlsPlaylist(master, MASTER_URL);
const m1links = links(m1);
check(m1links.length === 4 && m1links.every((l) => target(l) !== null), `every master link is proxied (${m1links.length} links)`);
check(m1links.map(target).join(' ') === [
  `${CF}/0123abcd/manifest/stream_t9_r131.m3u8`,
  `${CF}/0123abcd/manifest/stream_t1_r240.m3u8`,
  `${CF}/0123abcd/manifest/stream_t1_r720.m3u8`,
  `${CF}/0123abcd/manifest/iframes_240.m3u8`,
].join(' '), 'audio rendition, two variants and the I-frame playlist resolve against the master URL');
check(m1.includes('CODECS="avc1.42c015,mp4a.40.2"') && m1.includes('GROUP-ID="group_audio"'),
  'other quoted attributes are untouched');
check(m1.split('\n').length === master.split('\n').length, 'line count is kept');

// --- 2. Cloudflare Stream media playlist: the shape that failed --------------
console.log('== 2. media playlist (Cloudflare Stream shape)');
const media = [
  '#EXTM3U',
  '#EXT-X-VERSION:6',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXT-X-TARGETDURATION:5',
  `#EXT-X-MAP:URI="../../0123abcd/video/240/init.mp4?p=${P}&s=AbC-d_e"`,
  '#EXT-X-INDEPENDENT-SEGMENTS',
  '#EXTINF:4.00000,',
  `../../0123abcd/video/240/seg_1.mp4?p=${P}&s=AbC-d_e`,
  '#EXTINF:4.00000,',
  `../../0123abcd/video/240/seg_2.mp4?p=${P}&s=AbC-d_e`,
  '#EXT-X-ENDLIST',
].join('\n');
const m2 = rewriteHlsPlaylist(media, MEDIA_URL);
const m2links = links(m2);
check(m2links.length === 3 && m2links.every((l) => target(l) !== null),
  `init segment and both ../../<id>/video/240/seg_N.mp4?p=… segments are proxied (${m2links.length} links)`);
check(target(m2links[1]) === `${CF}/0123abcd/video/240/seg_1.mp4?p=${P}&s=AbC-d_e`,
  'a ../../ segment resolves to the right absolute URL, query kept');
check(target(m2links[0]) === `${CF}/0123abcd/video/240/init.mp4?p=${P}&s=AbC-d_e`, 'EXT-X-MAP init segment resolves the same way');
check(!m2.split('\n').some((l) => l.startsWith('../')), 'no relative line is left');

// --- 3. keys, absolute, root-relative, other schemes ------------------------
console.log('== 3. keys, absolute and root-relative links, other schemes');
const mixed = [
  '#EXTM3U',
  '#EXT-X-KEY:METHOD=AES-128,URI="key.bin?k=1",IV=0x0123456789abcdef0123456789abcdef',
  '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="https://keys.example/k2"',
  '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://drm-key-id",KEYFORMAT="com.apple.streamingkeydelivery"',
  '#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain;base64,AAAA"',
  '#EXTINF:6,',
  'https://cdn.example/abs/seg.ts',
  '#EXTINF:6,',
  '/root/seg.ts',
  '#EXTINF:6,',
  '//other.example/proto-relative.ts',
  '#EXTINF:6,',
  'segment_7.ts',
  '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="part_8.mp4"',
  '# a plain comment with URI="x.m3u8" in it',
].join('\n');
const m3 = rewriteHlsPlaylist(mixed, `${CF}/a/b/media.m3u8`);
const m3lines = m3.split('\n');
check(target(/URI="([^"]*)"/.exec(m3lines[1])![1]) === `${CF}/a/b/key.bin?k=1` && m3lines[1].endsWith(',IV=0x0123456789abcdef0123456789abcdef'),
  'EXT-X-KEY URI is proxied, IV kept');
check(target(/URI="([^"]*)"/.exec(m3lines[2])![1]) === 'https://keys.example/k2', 'EXT-X-SESSION-KEY absolute URI is proxied');
check(m3lines[3] === mixed.split('\n')[3], 'skd:// key is left alone');
check(m3lines[4] === mixed.split('\n')[4], 'data: key is left alone');
check(target(m3lines[6]) === 'https://cdn.example/abs/seg.ts', 'absolute segment is proxied as written');
check(target(m3lines[8]) === `${CF}/root/seg.ts`, 'root-relative segment resolves against the upstream host, not this site');
check(target(m3lines[10]) === 'https://other.example/proto-relative.ts', 'protocol-relative segment takes the playlist scheme');
check(target(m3lines[12]) === `${CF}/a/b/segment_7.ts`, 'old name pattern segment_N.ts still works');
check(target(/URI="([^"]*)"/.exec(m3lines[13])![1]) === `${CF}/a/b/part_8.mp4`, 'EXT-X-PRELOAD-HINT URI is proxied');
check(m3lines[14] === mixed.split('\n')[14], 'a plain comment is not touched');

// --- 4. exact round trip of the query ---------------------------------------
console.log('== 4. round trip of awkward queries');
const awkward = 'seg_1.mp4?p=ab+c/d==&s=x%2By&t=a b#frag';
const m4 = rewriteHlsPlaylist(`#EXTM3U\n${awkward}\n`, `${CF}/v/m.m3u8`);
const want = new URL(awkward, `${CF}/v/m.m3u8`).href;
check(target(m4.split('\n')[1]) === want, `+ / = & %2B and a space come back byte for byte (${want.slice(-36)})`);
check(proxiedVideoUrl('https://h.example/a?b=1&c=2') === '/api/proxy-video?url=https%3A%2F%2Fh.example%2Fa%3Fb%3D1%26c%3D2',
  'proxiedVideoUrl encodes the whole URL as one parameter');

// --- 5. line endings and odd lines -------------------------------------------
console.log('== 5. CRLF, blank lines, our own path');
const crlf = '#EXTM3U\r\n#EXT-X-MAP:URI="init.mp4"\r\n\r\n#EXTINF:4,\r\nseg_1.mp4\r\n';
const m5 = rewriteHlsPlaylist(crlf, `${CF}/v/m.m3u8`);
check(m5.split('\r\n').length === crlf.split('\r\n').length && !/(^|[^\r])\n/.test(m5),
  'CRLF line endings are kept');
check(target(m5.split('\r\n')[4]) === `${CF}/v/seg_1.mp4` && target(/URI="([^"]*)"/.exec(m5)![1]) === `${CF}/v/init.mp4`,
  'CRLF lines are proxied without a stray \\r in the link');
const own = rewriteHlsPlaylist('#EXTM3U\n/api/proxy-video?url=https%3A%2F%2Fevil.example%2Fx.ts\n', `${CF}/v/m.m3u8`);
check(target(own.split('\n')[1]) === `${CF}/api/proxy-video?url=https%3A%2F%2Fevil.example%2Fx.ts`,
  'a line naming our proxy path is an upstream link like any other (no pass-through)');
const indented = rewriteHlsPlaylist('#EXTM3U\n   seg_1.mp4  \n', `${CF}/v/m.m3u8`);
check(target(indented.split('\n')[1]) === `${CF}/v/seg_1.mp4`, 'whitespace around a URI line is dropped');
check(rewriteHlsPlaylist('', MEDIA_URL) === '', 'an empty playlist stays empty');

console.log(`\npassed: ${passed}  failed: ${bad}`);
process.exit(bad === 0 ? 0 : 1);
