// Browser test for the media proxies on real ITDV pages: album art and GIFs through
// /api/proxy-image, audio through /api/proxy-audio (a doerfelverse.com track and an op3.dev
// track, which redirects), and every Cloudflare Stream video through /api/proxy-video, played to
// real playback (currentTime moves on by 2 s).
//
//   node scripts/e2e-media-proxy.mjs <base-url>
//   E2E_ONLY=video node scripts/e2e-media-proxy.mjs <base-url>   # the video cases only
//
// It needs the internet (the media is real) and a running app (`npm run dev` or `next start`), or
// a deployment. The video route writes root-relative playlist links, so any base URL works.
// Chrome runs muted on a throwaway profile at a phone size (device emulation, mobile: true),
// because the phone layout is where non-GIF art goes through the image proxy. It watches every
// /api/proxy-* response over CDP and fails on any status other than 200, 206 or 304, on a failed
// load, on a media request that missed the proxy (a 404 from this site), or when the media does
// not play. It quits with Browser.close, and deletes the profile.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341;
// E2E_ONLY=video runs the video cases only.
const ONLY = process.env.E2E_ONLY || '';
const VIDEO_CASES = [
  { label: 'Cloudflare full video', path: '/album/the-satellite-spotlight', track: 'CityBeach [Raw Set]', id: 'f6e70bb3f1404c6ec68bd0e91970c9fb' },
  { label: 'Cloudflare chapter', path: '/album/the-satellite-spotlight', track: 'CityBeach', id: 'aef771f15a451d680860b185bde17de6', startTime: 5842 },
  { label: 'Cloudflare chapter via op3.dev', path: '/album/autumn-rust', track: 'The Doerfels', id: 'cc4efa9b3ef45d7c0b6688656da87216', startTime: 338 },
];

let checks = 0;
const failures = [];
function check(condition, message) {
  checks++;
  if (!condition) failures.push(message);
  console.log(`${condition ? '  ok  ' : '  FAIL'} ${message}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- CDP ----------
const profile = mkdtempSync(join(tmpdir(), `chrome-${process.env.CLAUDE_CODE_SESSION_ID || 'e2e'}-media-`));
const chrome = spawn(CHROME, [
  '--headless=new', '--mute-audio', '--disable-features=MacAppCodeSignClone', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (page) return { pageWs: page.webSocketDebuggerUrl, browserWs: version.webSocketDebuggerUrl };
    } catch {}
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

function client(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  });
  return {
    ready: new Promise((r) => ws.once('open', r)),
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    }),
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),
  };
}

const { pageWs, browserWs } = await connect();
const cdp = client(pageWs);
await cdp.ready;

// Every proxy response, by request id.
const proxied = new Map();
cdp.on((msg) => {
  const p = msg.params || {};
  if (msg.method === 'Network.responseReceived' && /\/api\/proxy-(image|audio|video)/.test(p.response.url)) {
    proxied.set(p.requestId, { url: p.response.url, status: p.response.status, type: p.response.mimeType, bytes: 0, done: false });
  } else if (msg.method === 'Network.loadingFinished' && proxied.has(p.requestId)) {
    Object.assign(proxied.get(p.requestId), { bytes: p.encodedDataLength, done: true });
  } else if (msg.method === 'Network.loadingFailed' && proxied.has(p.requestId)) {
    // A media element cancels its own range requests while it plays; that is not a proxy failure.
    Object.assign(proxied.get(p.requestId), { failed: p.canceled ? null : p.errorText, done: true });
  }
});

// A playlist line that the route leaves relative resolves against this site: the player then asks
// for /<id>/video/…/seg_N.mp4 here and gets a 404. Collect every such miss.
const siteMisses = [];
cdp.on((msg) => {
  const p = msg.params || {};
  if (msg.method === 'Network.responseReceived' && p.response.url.startsWith(BASE) && p.response.status === 404
      && /\.(mp4|m4s|ts|m3u8|aac|key)(\?|$)/.test(new URL(p.response.url).pathname + '?')) {
    siteMisses.push(new URL(p.response.url).pathname.slice(0, 80));
  }
});

await cdp.send('Network.enable');
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cdp.send('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
// Keep a handle on every media element that plays, so the test can read its state.
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__media = []; const p = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { if (!window.__media.includes(this)) window.__media.push(this); return p.apply(this, arguments); };`,
});

async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

async function open(path) {
  proxied.clear();
  await cdp.send('Page.navigate', { url: BASE + path });
  for (let i = 0; i < 100; i++) {
    await sleep(300);
    if ((await evaluate('document.readyState').catch(() => '')) === 'complete') break;
  }
  await sleep(3000);
}

async function waitFor(expression, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expression).catch(() => false)) return true;
    await sleep(500);
  }
  return false;
}

function proxyReport(kind) {
  const list = [...proxied.values()].filter((r) => r.url.includes(`/api/proxy-${kind}`));
  const bad = list.filter((r) => ![200, 206, 304].includes(r.status) || r.failed);
  return { list, bad };
}

// Clicks the first (or, with last = true, the last) matching element.
async function clickByText(selector, text, last = false) {
  return evaluate(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(selector)})]
    .filter((e) => e.textContent.trim().includes(${JSON.stringify(text)}) || (e.title || '').includes(${JSON.stringify(text)}));
    const el = ${last} ? all[all.length - 1] : all[0];
    if (!el) return false; el.scrollIntoView(); el.click(); return true; })()`);
}

const MEDIA_STATE = `(() => { const m = window.__media[window.__media.length - 1];
  return m ? { src: m.currentSrc || m.src, readyState: m.readyState, time: m.currentTime, error: m.error && m.error.code, paused: m.paused } : null; })()`;

async function playAndCheck(label, path, button, srcPart) {
  console.log(`== ${label}`);
  await open(path);
  const clicked = await clickByText('button', button);
  check(clicked, `${label}: found the "${button}" button`);
  const playing = await waitFor(`(() => { const m = window.__media[window.__media.length - 1];
    return !!m && m.currentTime > 1 && !m.error; })()`, 25000);
  const state = await evaluate(MEDIA_STATE);
  check(playing, `${label}: plays past 1 s (${JSON.stringify(state)?.slice(0, 160)})`);
  check(!!state && String(state.src).includes(srcPart), `${label}: the media element loads through ${srcPart}`);
  return state;
}

try {
  if (ONLY !== 'video') {
  // ---------- art ----------
  console.log('== home page art at phone size');
  await open('/');
  await waitFor(`[...document.images].filter((i) => i.src.includes('/api/proxy-image')).length > 0`, 15000);
  await sleep(4000);
  const imgs = await evaluate(`[...document.images].filter((i) => i.src.includes('/api/proxy-image'))
    .map((i) => ({ src: i.src, ok: i.complete && i.naturalWidth > 0, loading: !i.complete }))`);
  const art = proxyReport('image');
  check(art.list.length > 0, `home: ${art.list.length} images loaded through /api/proxy-image`);
  check(art.bad.length === 0, `home: every proxied image answered 200/304 (bad: ${art.bad.map((b) => b.status + ' ' + (b.failed || '')).slice(0, 3).join(', ') || 'none'})`);
  const broken = imgs.filter((i) => !i.ok && !i.loading);
  check(imgs.length > 0 && broken.length === 0, `home: ${imgs.filter((i) => i.ok).length}/${imgs.length} proxied <img> rendered, none broken`);
  const gif = [...proxied.values()].find((r) => r.url.includes('Autumn-Rust-Feed-Art.gif'));
  if (gif) {
    for (let i = 0; i < 60 && !gif.done; i++) await sleep(500);
    check(gif.status === 200 && gif.done && !gif.failed && gif.bytes > 30e6,
      `home: the 41.7 MB Autumn Rust GIF loads whole through the proxy (${gif.status}, ${(gif.bytes / 1e6).toFixed(1)} MB)`);
  } else {
    check(false, 'home: the Autumn Rust GIF preload went through the proxy');
  }

  // ---------- audio ----------
  await playAndCheck('doerfelverse.com track', '/album/them', 'Play Album', '/api/proxy-audio');
  const a1 = proxyReport('audio');
  check(a1.list.length > 0 && a1.bad.length === 0, `doerfelverse.com track: proxy-audio answered ${[...new Set(a1.list.map((r) => r.status))].join('/')} and no load failed`);

  await playAndCheck('op3.dev track (redirect)', '/album/think-of-me-in-color', 'Play Album', 'op3.dev');
  const a2 = proxyReport('audio');
  check(a2.list.length > 0 && a2.bad.length === 0, `op3.dev track: proxy-audio answered ${[...new Set(a2.list.map((r) => r.status))].join('/')} and no load failed`);
  }

  // ---------- video ----------
  // Every Cloudflare Stream track in the catalogue: a full video, a chapter of a long video
  // (hls.js starts at startTime), and a chapter behind an op3.dev prefix. Each must reach real
  // playback: currentTime moves on by 2 s or more while the test watches. On 2026-11-25 the
  // player stopped after the init segment, because the playlist rewrite left Cloudflare's
  // `../../<id>/video/<n>/seg_N.mp4?p=…` lines relative and they resolved against this site.
  for (const v of VIDEO_CASES) {
    console.log(`== HLS video: ${v.label}`);
    await open(v.path);
    // Events of the previous page can arrive after the navigation; start clean here.
    proxied.clear();
    siteMisses.length = 0;
    check(await clickByText('button', 'Video'), `${v.label}: switched to the Video tab`);
    await sleep(1500);
    // The row of a track: the nearest ancestor of its button that holds an <h3> (the title).
    check(await evaluate(`(() => { const b = [...document.querySelectorAll('button[title="Play video"]')].find((x) => {
        let e = x.parentElement; while (e && !e.querySelector('h3')) e = e.parentElement;
        return !!e && e.querySelector('h3').textContent.trim() === ${JSON.stringify(v.track)}; });
      if (!b) return false; b.scrollIntoView(); b.click(); return true; })()`), `${v.label}: found the "Play video" button of "${v.track}"`);
    const VIDEO = `[...document.querySelectorAll('video')].sort((a, b) => b.readyState - a.readyState)[0]`;
    const started = await waitFor(`(() => { const m = ${VIDEO}; return !!m && m.readyState >= 3 && !m.error && !m.paused; })()`, 40000);
    const t0 = await evaluate(`(() => { const m = ${VIDEO}; return m ? m.currentTime : null; })()`);
    const moved = started && await waitFor(`(() => { const m = ${VIDEO}; return !!m && !m.error && m.currentTime > ${Number(t0) + 2}; })()`, 30000);
    const state = await evaluate(`(() => { const m = ${VIDEO}; return m ? { time: m.currentTime, readyState: m.readyState, paused: m.paused, error: m.error && m.error.code, buffered: m.buffered.length } : null; })()`);
    check(moved, `${v.label}: plays, currentTime ${Number(t0).toFixed(1)} -> ${state ? state.time.toFixed(1) : '?'} (${JSON.stringify(state)})`);
    if (v.startTime) check(!!state && state.time >= v.startTime - 1 && state.time < v.startTime + 120, `${v.label}: starts at the chapter start, ${v.startTime} s`);
    const r = proxyReport('video');
    const playlists = r.list.filter((x) => /mpegurl/i.test(x.type));
    const segments = r.list.filter((x) => /^(video|audio)\//.test(x.type) && [200, 206].includes(x.status) && x.done && !x.failed
      && decodeURIComponent(x.url).includes(`/${v.id}/`));
    check(playlists.length >= 3 && segments.length >= 3,
      `${v.label}: ${playlists.length} playlists and ${segments.length} segments of video ${v.id.slice(0, 8)} through /api/proxy-video`);
    check(r.bad.length === 0, `${v.label}: every proxy-video response 200/206 (bad: ${r.bad.map((b) => b.status + ' ' + (b.failed || '')).slice(0, 3).join(', ') || 'none'})`);
    check(siteMisses.length === 0, `${v.label}: no media request missed the proxy (${siteMisses.slice(0, 2).join(', ') || 'none'})`);
  }
} catch (error) {
  check(false, `test error: ${error.message}`);
} finally {
  // Quit with Browser.close (it removes the code-sign clone), wait for exit, then delete the profile.
  try {
    const b = client(browserWs);
    await b.ready;
    await b.send('Browser.close').catch(() => {});
    b.close();
  } catch {}
  await new Promise((r) => { if (chrome.exitCode !== null) r(); else { chrome.once('exit', r); setTimeout(r, 5000); } });
  if (chrome.exitCode === null) chrome.kill('SIGKILL');
  rmSync(profile, { recursive: true, force: true });
}

console.log(`\n${checks - failures.length}/${checks} checks passed`);
process.exit(failures.length ? 1 : 0);
