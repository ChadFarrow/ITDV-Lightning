import type { Event } from 'nostr-tools';

/**
 * Publish one signed event to each relay and wait for the relay's OK, within a
 * time limit. For server-side callers that must know the outcome before they
 * answer — `/api/nostr/publish` runs as a Vercel function, which stops once the
 * response is sent, so a publish left running in the background never finishes.
 *
 * nostr-tools' relay code is deliberately not used here. Since 2.25.2 its
 * `onerror` handler calls `ws.close()`, and Node's built-in WebSocket answers
 * `close()` on a socket that never connected by firing `error` again at once, so
 * one unreachable relay recursed until the stack overflowed (reproduced on Node
 * 22.16; nbd-wtf/nostr-tools#557 is the same shape with the `ws` package). Here
 * every handler is removed before the socket is closed, so nothing re-enters.
 *
 * Assertions: `node --experimental-strip-types scripts/check-relay-publish.mjs`
 */

export interface RelayPublishResult {
  accepted: string[];
  failed: { relay: string; reason: string }[];
}

/** The part of a WebSocket this needs, so tests can pass a fake. */
export interface RelaySocket {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface RelayPublishOptions {
  /** How long to wait for each relay's OK. The relays are tried at the same time. */
  timeoutMs?: number;
  openSocket?: (url: string) => RelaySocket;
}

const DEFAULT_TIMEOUT_MS = 5000;

const openWebSocket = (url: string): RelaySocket => new WebSocket(url) as unknown as RelaySocket;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function publishToRelay(
  event: Event,
  relay: string,
  timeoutMs: number,
  openSocket: (url: string) => RelaySocket
): Promise<{ relay: string; reason: string | null }> {
  return new Promise((resolve) => {
    let ws: RelaySocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    // Runs once. Handlers go first, so a close() that fires error again finds nothing.
    const finish = (reason: string | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          // already closed, or never opened
        }
      }
      resolve({ relay, reason });
    };

    try {
      ws = openSocket(relay);
    } catch (error) {
      finish(`could not open: ${messageOf(error)}`);
      return;
    }
    const socket = ws;

    timer = setTimeout(() => finish(`no OK within ${timeoutMs} ms`), timeoutMs);

    socket.onopen = () => {
      try {
        socket.send(JSON.stringify(['EVENT', event]));
      } catch (error) {
        finish(`send failed: ${messageOf(error)}`);
      }
    };
    socket.onmessage = (message) => {
      let data: unknown;
      try {
        data = JSON.parse(String(message.data));
      } catch {
        return;
      }
      // ["OK", <event id>, <accepted>, <message>] — NIP-01. Anything else is not our answer.
      if (!Array.isArray(data) || data[0] !== 'OK' || data[1] !== event.id) return;
      finish(data[2] === true ? null : `rejected: ${String(data[3] ?? '')}`);
    };
    socket.onerror = () => finish('connection error');
    socket.onclose = () => finish('closed before OK');
  });
}

export async function publishToRelays(
  event: Event,
  relays: string[],
  options: RelayPublishOptions = {}
): Promise<RelayPublishResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const openSocket = options.openSocket ?? openWebSocket;
  const outcomes = await Promise.all(relays.map((relay) => publishToRelay(event, relay, timeoutMs, openSocket)));

  const result: RelayPublishResult = { accepted: [], failed: [] };
  outcomes.forEach(({ relay, reason }) => {
    if (reason === null) result.accepted.push(relay);
    else result.failed.push({ relay, reason });
  });
  return result;
}
