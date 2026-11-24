// Server only (reads a file with fs): the ITDV feeds a Helipad record must belong to before
// /api/helipad-webhook stores it. That is the Into The Doerfel-Verse podcast feed and every album
// in public/static-albums.json, by feed GUID, plus their exact titles for records with no GUID.

import fs from 'fs';
import path from 'path';
import { ITDV_PODCAST_GUID } from './boostr-note';
import { buildItdvFeedIndex, type ItdvFeedIndex } from './stream-records';
import { serverError } from './server-log';

export const ITDV_PODCAST_TITLE = 'Into The Doerfel-Verse';

let cached: ItdvFeedIndex | null = null;

/** Built once per server instance. Without the album file, the podcast feed alone still matches. */
export function getItdvFeedIndex(): ItdvFeedIndex {
  if (cached) return cached;
  let albums: { feedGuid?: string; title?: string }[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'static-albums.json'), 'utf-8'));
    const list = Array.isArray(raw) ? raw : raw.albums;
    if (Array.isArray(list)) albums = list.map((a: { feedGuid?: string; title?: string }) => ({ feedGuid: a.feedGuid, title: a.title }));
  } catch (error) {
    serverError(`itdv-feeds: static-albums.json unreadable, matching the podcast feed only: ${error instanceof Error ? error.message : String(error)}`);
  }
  cached = buildItdvFeedIndex(albums, ITDV_PODCAST_GUID, ITDV_PODCAST_TITLE);
  return cached;
}
