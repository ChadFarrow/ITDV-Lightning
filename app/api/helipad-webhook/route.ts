import { NextRequest, NextResponse } from 'next/server';
import { constantTimeEquals } from '@/lib/admin-auth';
import { addHelipadRecord, StoreUnavailableError } from '@/lib/helipad-storage';
import { getItdvFeedIndex } from '@/lib/itdv-feeds';
import { serverLog } from '@/lib/server-log';
import { normalizeRecord, type HelipadRecord, type RecordSource } from '@/lib/stream-records';

// Helipad webhook: two senders post Helipad records here, and the token says which one.
// - HELIPAD_AUTH_TOKEN: TJ's Helipad (his node gets the album and podcast splits) -> 'tj-helipad'.
// - BOOSTBOT_WEBHOOK_TOKEN: Helipad-to-Nostr-BoostBot, which forwards the streams and auto boosts
//   of Chad's Helipad (the ChadF split) -> 'boostbot'.
// An unset token matches nothing, so with neither set every request is refused.
//
// Only records for an ITDV feed are stored (lib/itdv-feeds.ts); any other show answers 200 so the
// sender does not retry. Each request writes one log line with no part of the body: the records
// carry listener names and messages.

function tokenOf(header: string | null): string {
  if (!header) return '';
  return header.startsWith('Bearer ') ? header.slice(7) : header;
}

function sourceFor(header: string | null): RecordSource | null {
  const token = tokenOf(header);
  if (!token) return null;
  const tj = process.env.HELIPAD_AUTH_TOKEN || '';
  const bot = process.env.BOOSTBOT_WEBHOOK_TOKEN || '';
  // Both compares always run, so the time taken does not say which token was close.
  const isTj = tj !== '' && constantTimeEquals(token, tj);
  const isBot = bot !== '' && constantTimeEquals(token, bot);
  if (isTj) return 'tj-helipad';
  if (isBot) return 'boostbot';
  return null;
}

function logLine(source: RecordSource | 'none', action: unknown, result: string) {
  const a = typeof action === 'number' && isFinite(action) ? String(action) : '-';
  serverLog(`helipad-webhook source=${source} action=${a} result=${result}`);
}

export async function POST(request: NextRequest) {
  const source = sourceFor(request.headers.get('authorization'));
  if (!source) {
    logLine('none', undefined, '401');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let record: HelipadRecord;
  try {
    const parsed: unknown = JSON.parse(await request.text());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    record = parsed as HelipadRecord;
  } catch {
    logLine(source, undefined, '400');
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  if (typeof record.value_msat !== 'number' || !isFinite(record.value_msat)) {
    logLine(source, record.action, '400');
    return NextResponse.json({ error: 'Missing required field: value_msat' }, { status: 400 });
  }

  const normalized = normalizeRecord(record, source, getItdvFeedIndex(), Math.floor(Date.now() / 1000));
  if (!normalized) {
    logLine(source, record.action, 'dropped');
    return NextResponse.json({ success: true, stored: false, reason: 'not itdv' });
  }

  try {
    const result = await addHelipadRecord(normalized);
    logLine(source, record.action, 'stored');
    return NextResponse.json({ success: true, stored: true, kind: normalized.kind, paymentKey: result.paymentKey });
  } catch (error) {
    if (error instanceof StoreUnavailableError) {
      logLine(source, record.action, '503');
      return NextResponse.json({ success: false, error: 'store unavailable' }, { status: 503 });
    }
    throw error;
  }
}

// A GET answers that the endpoint is up, as before; Helipad itself only POSTs.
export async function GET() {
  return NextResponse.json({
    message: 'Helipad webhook endpoint is active',
    note: 'This endpoint expects POST requests from Helipad with boost data',
  });
}
