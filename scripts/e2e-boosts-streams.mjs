// Browser test for the /boosts Boosts and Streams tabs, on a LOCAL database only.
//
//   node scripts/e2e-boosts-streams.mjs <base-url> [--store-down | --empty]
//
// Before it: start the local database and relay (scripts/local-db.md), empty helipad_boosts, and run
// `npm run dev` with POSTGRES_URL and LOCAL_NEON_PROXY pointing at them and with
// HELIPAD_AUTH_TOKEN=$E2E_TJ_TOKEN and BOOSTBOT_WEBHOOK_TOKEN=$E2E_BB_TOKEN (any local test values).
//
// The normal run posts fixture records to the webhook, then drives headless Chrome over CDP at a
// desktop size and at a phone size (device emulation, mobile: true): the tab bar, the boost list
// without stream cards, the Streams rows and their totals, the live badge, the remembered tab, no
// horizontal overflow and 24x24 px touch targets. --store-down expects the relay to be stopped and
// checks the Streams tab's unavailable text; --empty expects an empty table and checks its text. Chrome runs muted on a throwaway profile, quits with
// Browser.close, and the profile is deleted.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const BASE = process.argv[2] || 'http://127.0.0.1:3123';
const STORE_DOWN = process.argv.includes('--store-down');
const EMPTY = process.argv.includes('--empty');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9339;
const ITDV_GUID = '41aace28-8679-5ef1-9958-75cf76c2b5f0';
const ALBUM_GUID = 'b2a87a4c-86f0-5194-9eb3-dcba42ce0695'; // Disco Swag - The Album

let checks = 0;
const failures = [];
function check(condition, message) {
  checks++;
  if (!condition) failures.push(message);
  console.log(`${condition ? '  ok  ' : '  FAIL'} ${message}`);
}

// ---------- seed ----------
const now = Math.floor(Date.now() / 1000);
let index = 9000;
function rec({ time, action = 1, sender, app, total, ts, guid, item, episode, podcast, customValue = null, message = '' }) {
  return {
    index: index++, time, value_msat: Math.floor(total / 10), value_msat_total: total, action, sender, app, message, podcast, episode,
    tlv: JSON.stringify({ action: action === 2 ? 'boost' : 'stream', guid, episode_guid: item, podcast, episode,
      sender_name: sender, app_name: app, value_msat_total: total, ts }),
    custom_key: customValue === null ? null : '696969', custom_value: customValue,
  };
}
const ep83 = { guid: ITDV_GUID, item: 'ep83', episode: 'Ep 83 - Jon Ross', podcast: 'Into The Doerfel-Verse' };
const ep82 = { guid: ITDV_GUID, item: 'ep82', episode: 'Ep 82 - DOERFELMON', podcast: 'Into The Doerfel-Verse' };
const disco = { guid: ALBUM_GUID, item: 'disco-1', episode: 'Disco Swag', podcast: 'Disco Swag - The Album' };

async function postRecord(record, token) {
  const res = await fetch(`${BASE}/api/helipad-webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(record),
  });
  if (res.status !== 200) throw new Error(`seed: webhook answered ${res.status}`);
}

async function seed() {
  const tj = process.env.E2E_TJ_TOKEN;
  const bb = process.env.E2E_BB_TOKEN;
  if (!tj || !bb) throw new Error('set E2E_TJ_TOKEN and E2E_BB_TOKEN (the dev server tokens)');
  // Alice: three streams on Ep 83, each split to TJ and to Chad, and one auto boost.
  for (const [i, ago] of [150, 90, 30].entries()) {
    await postRecord(rec({ time: now - ago, sender: 'Alice', app: 'Fountain', total: 100000, ts: 60 * (i + 1), customValue: '1', ...ep83 }), tj);
    await postRecord(rec({ time: now - ago + 3, sender: 'Alice', app: 'Fountain', total: 100000, ts: 60 * (i + 1), ...ep83 }), bb);
  }
  await postRecord(rec({ time: now - 60, action: 4, sender: 'Alice', app: 'v4vmusic', total: 21000, ts: 200, customValue: '1', ...ep83 }), tj);
  // Bob: two streams on an album track, each as four TJ splits.
  for (const [i, ts] of [10, 70].entries()) {
    for (const cv of ['4', '3', '13', null]) {
      await postRecord(rec({ time: now - 7260 + i * 60, sender: 'Bob', app: 'Fountain', total: 50000, ts, customValue: cv, ...disco }), tj);
    }
  }
  // No name: one stream on Ep 82 a day ago.
  await postRecord(rec({ time: now - 86500, sender: '', app: 'Castamatic', total: 10500, ts: 30, ...ep82 }), bb);
  // Two boosts.
  await postRecord(rec({ time: now - 600, action: 2, sender: 'Dan', app: 'Fountain', total: 7000, ts: 0, customValue: '1', message: 'Great show from Dan', ...ep82 }), tj);
  await postRecord(rec({ time: now - 500, action: 2, sender: 'Eve', app: 'Fountain', total: 8000, ts: 0, customValue: '1', message: 'Eve says hi', ...ep83 }), tj);
}

// ---------- CDP ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
let nextId = 0;
const pending = new Map();
function send(method, params = {}, sessionId) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
let session;
const page = (method, params) => send(method, params, session);
async function evaluate(expression) {
  const r = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.text} ${expression.slice(0, 80)}`);
  return r.result.value;
}
async function waitFor(expression, label, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(expression).catch(() => false)) return true;
    await sleep(250);
  }
  const body = await evaluate('document.body ? document.body.innerText.slice(0, 400) : ""').catch(() => '');
  check(false, `timed out waiting for ${label}; page text: ${JSON.stringify(body)}`);
  return false;
}
async function navigate(url) {
  await page('Page.navigate', { url });
  await waitFor('document.readyState === "complete"', `load ${url}`);
}
async function setViewport(width, height, mobile) {
  await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile });
}

const tabState = `(() => [...document.querySelectorAll('[data-tab]')].map(b => {
  const r = b.getBoundingClientRect();
  return { tab: b.dataset.tab, pressed: b.getAttribute('aria-pressed'), w: r.width, h: r.height };
}))()`;
const overflow = '({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })';
const rowsText = `[...document.querySelectorAll('[data-stream-row]')].map(r => ({
  lines: [...r.querySelectorAll('[data-line]')].map(l => l.textContent.trim()),
  live: !!r.querySelector('[data-live]'),
}))`;

async function checkLayout(label) {
  const o = await evaluate(overflow);
  check(o.scroll <= o.client, `${label}: no horizontal overflow (${o.scroll} <= ${o.client})`);
  const tabs = await evaluate(tabState);
  check(tabs.length === 2 && tabs.every(t => t.w >= 24 && t.h >= 24), `${label}: both tab buttons are at least 24x24 (${JSON.stringify(tabs.map(t => [Math.round(t.w), Math.round(t.h)]))})`);
}

async function run() {
  if (!STORE_DOWN && !EMPTY) await seed();

  const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), `chrome-${process.env.CLAUDE_CODE_SESSION_ID || 'e2e'}-`));
  const chrome = spawn(CHROME, [
    '--headless=new', '--mute-audio', '--disable-features=MacAppCodeSignClone', `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore' });
  const exited = new Promise(r => chrome.on('exit', r));
  try {
    let version;
    for (let i = 0; i < 50 && !version; i++) {
      version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then(r => r.json()).catch(() => null);
      if (!version) await sleep(200);
    }
    if (!version) throw new Error('Chrome did not start');
    ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      const p = msg.id && pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
      }
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }));
    await page('Page.enable');
    await page('Runtime.enable');

    if (STORE_DOWN || EMPTY) {
      const text = STORE_DOWN ? 'Streams are unavailable right now' : 'No streams yet';
      await setViewport(1280, 800, false);
      await navigate(`${BASE}/boosts`);
      await evaluate(`localStorage.setItem('boosts_tab_v1', 'streams')`);
      await navigate(`${BASE}/boosts`);
      await waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, `the text ${text}`);
      check(await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`), `${STORE_DOWN ? 'storeDown' : 'empty'}: Streams tab says ${text}`);
      return;
    }

    // Desktop, fresh storage: the Boosts tab is open.
    await setViewport(1280, 800, false);
    await navigate(`${BASE}/boosts`);
    await evaluate('localStorage.clear()');
    await navigate(`${BASE}/boosts`);
    await waitFor(`document.querySelectorAll('[data-tab]').length === 2`, 'the tab bar');
    const tabs = await evaluate(tabState);
    check(JSON.stringify(tabs.map(t => [t.tab, t.pressed])) === JSON.stringify([['boosts', 'true'], ['streams', 'false']]), `desktop: Boosts tab is open by default (${JSON.stringify(tabs.map(t => [t.tab, t.pressed]))})`);
    await waitFor(`document.body.innerText.includes('Great show from Dan')`, "Dan's boost");
    const boostsText = await evaluate('document.body.innerText');
    check(boostsText.includes('Great show from Dan') && boostsText.includes('Eve says hi'), 'boosts: both seeded boosts are listed');
    // The old card badge was a span reading exactly "🌊 Stream" (the tab button reads "🌊 Streams").
    const badges = await evaluate(`[...document.querySelectorAll('span')].filter(s => s.textContent.trim() === '🌊 Stream').length`);
    check(badges === 0, `boosts: no stream badge (${badges})`);
    check(!/\bAlice\b/.test(boostsText) && !/\bBob\b/.test(boostsText), 'boosts: no stream or auto boost card (Alice, Bob)');
    await checkLayout('desktop boosts');

    // Streams tab.
    await evaluate(`document.querySelector('[data-tab="streams"]').click()`);
    await waitFor(`document.querySelectorAll('[data-stream-row]').length === 3`, 'three stream rows');
    const rows = await evaluate(rowsText);
    const expected = [
      ['Alice · Ep 83 - Jon Ross', 'Into The Doerfel-Verse', '321 sats · 3 streams · 1 auto · Fountain, v4vmusic · <recent>'],
      ['Bob · Disco Swag', 'Disco Swag - The Album', '100 sats · 2 streams · Fountain · 2h ago'],
      ['Anonymous · Ep 82 - DOERFELMON', 'Into The Doerfel-Verse', '10 sats · 1 stream · Castamatic · 1d ago'],
    ];
    // The newest row's age depends on how long the page took to load: "just now" or a few minutes.
    const recent = text => text.replace(/ · (just now|[1-3]m ago)$/, ' · <recent>');
    expected.forEach((want, i) => {
      const got = (rows[i]?.lines || []).map(recent);
      check(JSON.stringify(got) === JSON.stringify(want), `streams row ${i + 1}: ${JSON.stringify(rows[i]?.lines)}`);
    });
    check(JSON.stringify(rows.map(r => r.live)) === JSON.stringify([true, false, false]), 'streams: only the newest row is live');
    const afterClick = await evaluate(tabState);
    check(afterClick.find(t => t.tab === 'streams')?.pressed === 'true', 'streams: the Streams button is pressed');
    await checkLayout('desktop streams');

    // Reload keeps the open tab.
    await navigate(`${BASE}/boosts`);
    await waitFor(`document.querySelectorAll('[data-stream-row]').length === 3`, 'stream rows after reload');
    check((await evaluate(tabState)).find(t => t.tab === 'streams')?.pressed === 'true', 'reload: the Streams tab stays open');

    // Phone.
    await setViewport(390, 844, true);
    await navigate(`${BASE}/boosts`);
    await waitFor(`document.querySelectorAll('[data-stream-row]').length === 3`, 'stream rows on a phone');
    await checkLayout('phone streams');
    await evaluate(`document.querySelector('[data-tab="boosts"]').click()`);
    await waitFor(`document.body.innerText.includes('Great show from Dan')`, "Dan's boost on a phone");
    await checkLayout('phone boosts');
  } finally {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) await send('Browser.close');
    } catch { /* already closing */ }
    await Promise.race([exited, sleep(10000)]);
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
    rmSync(profile, { recursive: true, force: true });
    if (ws) ws.close();
  }
}

run()
  .catch(error => { failures.push(`unexpected error: ${error.message}`); console.error(error); })
  .finally(() => {
    console.log(failures.length ? `❌ ${failures.length} of ${checks} checks failed` : `✅ ${checks} checks passed`);
    process.exit(failures.length ? 1 : 0);
  });
