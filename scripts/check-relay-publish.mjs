// Assertions for lib/relay-publish.ts — the repo's stand-in for unit tests.
//
//   node --experimental-strip-types scripts/check-relay-publish.mjs
//
// /api/nostr/publish waits on publishToRelays before it answers. It used to start the
// publish in the background and answer at once, so on Vercel the function stopped and
// no boost note ever reached a relay (2026-08-04 to 2026-10-30) while the browser was
// told "success". The last check uses a real socket to a host that cannot exist: with
// nostr-tools 2.25.2's relay code that recursed until the stack overflowed on Node 22.

import { publishToRelays } from '../lib/relay-publish.ts';

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}
function check(condition, message) {
  if (!condition) fail(message);
}

const event = { id: 'e'.repeat(64), pubkey: 'p'.repeat(64), kind: 1, created_at: 1, tags: [], content: 'x', sig: 's'.repeat(128) };

// A socket that does what the test script tells it, and records what was done to it.
// `syncErrorOnClose` copies Node 22's WebSocket: close() on a socket that never
// connected fires error again at once, still in CONNECTING.
function fakeRelays(scripts) {
  const sockets = {};
  const open = (url) => {
    const script = scripts[url];
    const ws = {
      url, readyState: 0, sent: [], closed: 0, errorsFired: 0,
      onopen: null, onmessage: null, onerror: null, onclose: null,
      send(data) { ws.sent.push(data); script.onSend?.(ws, JSON.parse(data)); },
      close() {
        ws.closed++;
        if (script.syncErrorOnClose && ws.readyState === 0) {
          ws.errorsFired++;
          if (ws.errorsFired > 50) fail(`${url}: error handler re-entered 50 times (the recursion)`);
          ws.onerror?.({});
        }
      },
    };
    sockets[url] = ws;
    setTimeout(() => script.start(ws), 0);
    return ws;
  };
  return { open, sockets };
}
const opened = (ws) => { ws.readyState = 1; ws.onopen?.({}); };
const reply = (ws, msg) => ws.onmessage?.({ data: JSON.stringify(msg) });

{
  const { open, sockets } = fakeRelays({
    'wss://ok': { start: opened, onSend: (ws, [, ev]) => reply(ws, ['OK', ev.id, true, '']) },
    'wss://no': { start: opened, onSend: (ws, [, ev]) => reply(ws, ['OK', ev.id, false, 'blocked: spam']) },
    'wss://dead': { syncErrorOnClose: true, start: (ws) => ws.onerror?.({}) },
    'wss://drop': { start: (ws) => { opened(ws); ws.readyState = 3; ws.onclose?.({}); } },
    'wss://other-id': { start: opened, onSend: (ws) => reply(ws, ['OK', 'f'.repeat(64), true, '']) },
    'wss://silent': { start: opened },
  });
  const started = Date.now();
  const relays = ['wss://ok', 'wss://no', 'wss://dead', 'wss://drop', 'wss://other-id', 'wss://silent'];
  const r = await publishToRelays(event, relays, { timeoutMs: 300, openSocket: open });
  const took = Date.now() - started;
  const reason = (relay) => r.failed.find((f) => f.relay === relay)?.reason ?? '';

  check(JSON.stringify(r.accepted) === '["wss://ok"]', `only wss://ok accepts, got ${JSON.stringify(r.accepted)}`);
  check(r.failed.length === 5, `five relays fail, got ${r.failed.length}`);
  check(/rejected.*blocked: spam/.test(reason('wss://no')), `a relay's refusal is passed on, got "${reason('wss://no')}"`);
  check(/connection error/.test(reason('wss://dead')), `a dead relay is a connection error, got "${reason('wss://dead')}"`);
  check(sockets['wss://dead'].errorsFired <= 1, 'the dead relay re-entered the error handler');
  check(/closed/.test(reason('wss://drop')), `a relay that hangs up is reported, got "${reason('wss://drop')}"`);
  check(/no OK within 300 ms/.test(reason('wss://other-id')), `an OK for another event is ignored, got "${reason('wss://other-id')}"`);
  check(/no OK within 300 ms/.test(reason('wss://silent')), `a silent relay times out, got "${reason('wss://silent')}"`);
  check(took < 1500, `relays are tried at the same time, took ${took} ms`);
  check(JSON.parse(sockets['wss://ok'].sent[0])[0] === 'EVENT' && JSON.parse(sockets['wss://ok'].sent[0])[1].id === event.id,
    'the relay receives ["EVENT", event]');
  for (const ws of Object.values(sockets)) {
    check(ws.onerror === null && ws.onclose === null && ws.onmessage === null && ws.onopen === null, `${ws.url}: handlers are removed when done`);
    check(ws.closed === 1, `${ws.url}: the socket is closed once, got ${ws.closed}`);
  }
  console.log('✅ fake relays: accept, refuse, dead, hang-up, wrong id and silent are each reported, and every socket is released');
}

{
  const r = await publishToRelays(event, [], { timeoutMs: 300 });
  check(r.accepted.length === 0 && r.failed.length === 0, 'no relays gives an empty result');
}

{
  const r = await publishToRelays(event, ['wss://throws'], { timeoutMs: 300, openSocket: () => { throw new Error('bad url'); } });
  check(r.failed.length === 1 && /bad url/.test(r.failed[0].reason), `a socket that cannot be opened is reported, got ${JSON.stringify(r.failed)}`);
  console.log('✅ no relays, and a socket that cannot be opened, are handled');
}

{
  // A real socket on this Node, to a host that cannot exist (.invalid never resolves).
  const r = await publishToRelays(event, ['wss://relay.nonexistent.invalid/'], { timeoutMs: 8000 });
  check(r.accepted.length === 0 && r.failed.length === 1, `the unreachable relay fails cleanly, got ${JSON.stringify(r)}`);
  console.log(`✅ real socket on Node ${process.version}: unreachable relay reported as "${r.failed[0].reason}", no stack overflow`);
}
