'use client';

import { useEffect, useState } from 'react';
import type { StreamSummaryRow } from '@/lib/stream-records';
import { formatTimestamp } from '@/lib/relative-time';

// The /boosts Streams tab: one row per listener and episode, from /api/streams. It polls every 30 s
// while it is on screen. A failed poll keeps the rows it already shows; a failed first load says so.

type State =
  | { status: 'loading' }
  | { status: 'ready'; rows: StreamSummaryRow[] }
  | { status: 'unavailable' };

function summaryLine(row: StreamSummaryRow): string {
  const parts = [`${row.totalSats.toLocaleString()} sats`];
  if (row.streams > 0) parts.push(`${row.streams} ${row.streams === 1 ? 'stream' : 'streams'}`);
  if (row.autos > 0) parts.push(`${row.autos} auto`);
  if (row.apps.length > 0) parts.push(row.apps.join(', '));
  parts.push(formatTimestamp(row.lastTime));
  return parts.join(' · ');
}

export default function StreamsTab() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const keepRowsOr = (prev: State): State => (prev.status === 'ready' ? prev : { status: 'unavailable' });
    const load = async () => {
      try {
        const response = await fetch('/api/streams?limit=50', { cache: 'no-store' });
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (response.ok && body && body.success && Array.isArray(body.rows)) {
          setState({ status: 'ready', rows: body.rows });
        } else {
          setState(keepRowsOr);
        }
      } catch {
        if (!cancelled) setState(keepRowsOr);
      }
    };
    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-purple-500 border-t-transparent"></div>
        <p className="mt-4 text-gray-400">Loading streams...</p>
      </div>
    );
  }
  if (state.status === 'unavailable') {
    return <div className="text-center py-12 text-gray-400 text-xl">Streams are unavailable right now</div>;
  }
  if (state.rows.length === 0) {
    return <div className="text-center py-12 text-gray-400 text-xl">No streams yet</div>;
  }
  return (
    <ul className="space-y-3">
      {state.rows.map((row, i) => (
        <li
          key={`${i}-${row.listener}-${row.itemTitle}-${row.showTitle}-${row.viaShow || ''}`}
          data-stream-row
          className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-4 min-w-0"
        >
          <div data-line className="font-semibold text-white break-words">
            {row.listener} · {row.itemTitle}
          </div>
          <div data-line className="text-sm text-gray-400 break-words">
            {row.showTitle}
            {row.viaShow ? ` · in ${row.viaShow}` : ''}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span data-line className="text-sm text-gray-300 break-words">
              {summaryLine(row)}
            </span>
            {row.live && (
              <span data-live className="bg-green-500/20 text-green-400 px-2 py-0.5 rounded text-xs font-medium">
                live
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
